"""
bot_2.py — KU Timetable Scraper (Fixed: ดึงจาก TABLE จริง ไม่ใช่ myBox)
"""

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import Select, WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager
from bs4 import BeautifulSoup
import time, json, re, os, traceback

# ──────────────────────────────────────────────
#  CONFIG
# ──────────────────────────────────────────────
URL         = "https://misreg.csc.ku.ac.th/misreg/schedule_v2/index.php?flag=FM"
STD_YEAR    = "68"
WAIT_SECS   = 30
OUTPUT_PATH = "public/all_timetables.json"

# ดึงทุกสาขา (ตัด _A = กลุ่ม, เอาเฉพาะ _B = สาขาจริง)
# จะถูก populate อัตโนมัติจากหน้าเว็บ

DAY_EN = {
    "sunday":"SUN","monday":"MON","tuesday":"TUE",
    "wednesday":"WED","thursday":"THU","friday":"FRI","saturday":"SAT",
    "วันอาทิตย์":"SUN","วันจันทร์":"MON","วันอังคาร":"TUE",
    "วันพุธ":"WED","วันพฤหัสบดี":"THU","วันศุกร์":"FRI","วันเสาร์":"SAT",
    "อาทิตย์":"SUN","จันทร์":"MON","อังคาร":"TUE",
    "พุธ":"WED","พฤหัสบดี":"THU","พฤหัส":"THU","ศุกร์":"FRI","เสาร์":"SAT",
}

# ──────────────────────────────────────────────
#  PARSE HELPERS
# ──────────────────────────────────────────────
def to_hhmm(raw):
    s = str(raw).strip()
    sep = "." if "." in s else (":" if ":" in s else None)
    if not sep:
        n = int(s) if s.isdigit() else None
        if n:
            return f"{n:02d}:00"
        return s
    h_s, m_s = s.split(sep, 1)
    try:
        h = int(h_s)
        m = 30 if str(m_s).strip().startswith("3") else 0
        return f"{h:02d}:{m:02d}"
    except:
        return s

def parse_time_range(text):
    m = re.search(r"(\d{1,2}[.:]\d{1,2})\s*[-–]\s*(\d{1,2}[.:]\d{1,2})", str(text))
    return (to_hhmm(m.group(1)), to_hhmm(m.group(2))) if m else (None, None)

# ──────────────────────────────────────────────
#  PARSE TABLE HTML
# ──────────────────────────────────────────────
def parse_timetable_html(html, major_value="", major_label="", std_year=""):
    """
    Parse ตาราง HTML จากหน้า schedule_v2
    คืนค่า list ของ course dict
    """
    results, seen = [], set()
    soup = BeautifulSoup(html, "html.parser")

    # หา table ที่มี header "เวลา" หรือ "8.00"
    target_table = None
    for tbl in soup.find_all("table"):
        text = tbl.get_text()
        if "8.00" in text or "เวลา" in text:
            target_table = tbl
            break

    if not target_table:
        # fallback: table ที่ใหญ่ที่สุด
        tables = soup.find_all("table")
        if tables:
            target_table = max(tables, key=lambda t: len(t.get_text()))

    if not target_table:
        print("  ❌ ไม่พบ table")
        return results

    rows = target_table.find_all("tr")
    print(f"  พบ {len(rows)} rows ใน table")

    current_day = ""

    for row in rows:
        cells = row.find_all(["td", "th"])
        if not cells:
            continue

        first_text = cells[0].get_text(strip=True).lower()

        # ── ตรวจว่าเป็นแถว header เวลา ──
        if "เวลา" in first_text or "8.00" in first_text:
            continue

        # ── ตรวจว่าเป็นแถววัน ──
        day_found = DAY_EN.get(first_text, "")
        if not day_found:
            # ลอง partial match
            for k, v in DAY_EN.items():
                if k in first_text:
                    day_found = v
                    break

        if day_found:
            current_day = day_found
            print(f"\n  ── {current_day} ──")
            data_cells = cells[1:]
        else:
            data_cells = cells

        if not current_day:
            continue

        for cell in data_cells:
            # รวม text ทุก element ใน cell
            raw = cell.get_text("\n", strip=True).strip()
            if len(raw) < 5:
                continue

            # ตรวจว่ามีรหัสวิชา (pattern: ตัวอักษร+ตัวเลข เช่น 04252211)
            if not re.search(r"[A-Za-z]?\d{6,}", raw):
                continue

            # แยกหลายวิชาใน cell เดียวด้วย === หรือ ---
            blocks = re.split(r"[=\-]{3,}", raw)
            for block in blocks:
                block = block.strip()
                if len(block) < 5:
                    continue

                lines = [l.strip() for l in block.split("\n") if l.strip()]
                if len(lines) < 2:
                    continue

                # ── รหัสวิชา ──
                code_line = lines[0]
                m_code = re.match(
                    r"([A-Za-z]?\d{6,}(?:-\d+)?)\s*(?:หมู่|sec(?:tion)?\.?)\s*(\d+)",
                    code_line, re.IGNORECASE
                )
                if m_code:
                    code_full, sec = m_code.group(1), m_code.group(2)
                else:
                    parts = code_line.split()
                    code_full = parts[0] if parts else ""
                    sec = ""
                    for p in parts[1:]:
                        if p.isdigit():
                            sec = p
                            break
                    if not sec:
                        sec = "1"

                code = re.sub(r"-\d{2,4}$", "", code_full).strip()
                if not code or not re.search(r"\d{4}", code):
                    continue

                # ── เวลา ──
                time_line = ""
                for l in lines[1:3]:
                    if re.search(r"\d+[.:]\d+", l):
                        time_line = l
                        break
                start, end = parse_time_range(time_line)

                # ── ชื่อวิชา ──
                name = ""
                for l in lines[1:]:
                    if not re.search(r"\d+[.:]\d+", l) and not re.match(r"^\d+$", l) and "ห้อง" not in l:
                        name = re.sub(r"\s*\(\d{2,4}\)\s*$", "", l).strip()
                        if len(name) > 3:
                            break

                # ── อาจารย์ ──
                instructor = "-"
                for l in reversed(lines):
                    if (("อ." in l or "ผศ." in l or "รศ." in l or "ศ." in l or "ดร." in l)
                            and len(l) > 2):
                        instructor = l.strip()
                        break

                key = f"{code}_{sec}_{current_day}"
                if key in seen:
                    continue
                seen.add(key)

                course = {
                    "code": code,
                    "name": name or "(ไม่มีชื่อ)",
                    "sec": sec,
                    "day": current_day,
                    "start": start or "",
                    "end": end or "",
                    "instructor": instructor,
                    "credit": 3,
                    "year": std_year,
                    "major_value": major_value,
                    "major_label": major_label,
                }
                results.append(course)
                print(f"    ✓ {code} sec{sec} {start}-{end}  {name[:20]}")

    return results

# ──────────────────────────────────────────────
#  SCRAPE 1 สาขา
# ──────────────────────────────────────────────
def scrape_major(driver, wait, major_value, major_label, std_year):
    print(f"\n{'='*50}")
    print(f"  สาขา: {major_label} ({major_value})")
    print(f"{'='*50}")

    try:
        # เลือกสาขา
        sel_el = wait.until(EC.presence_of_element_located((By.NAME, "major_id")))
        Select(sel_el).select_by_value(major_value)

        # กรอก std_year
        yr_input = driver.find_element(By.NAME, "std_year")
        yr_input.clear()
        yr_input.send_keys(std_year)

        # Submit
        btn = driver.find_element(By.NAME, "btnMajor")
        btn.click()
        time.sleep(3)

        # ── รอให้ content เปลี่ยน ──
        deadline = time.time() + 20
        page_html = ""
        while time.time() < deadline:
            page_html = driver.page_source
            # ตรวจว่ามีข้อมูลตาราง (มีชื่อสาขาและ row วัน)
            if major_label[:5] in page_html and any(
                day in page_html for day in ["จันทร์","อังคาร","พุธ","พฤหัส","ศุกร์"]
            ):
                print(f"  ✓ โหลดแล้ว")
                break
            time.sleep(0.5)
        else:
            print(f"  ⚠ timeout — ลอง parse สิ่งที่มี")

        return parse_timetable_html(page_html, major_value, major_label, std_year)

    except Exception as e:
        print(f"  ❌ Error: {e}")
        traceback.print_exc()
        return []

# ──────────────────────────────────────────────
#  MAIN
# ──────────────────────────────────────────────
def run():
    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()))
    wait   = WebDriverWait(driver, 30)

    try:
        print(f"[1] เปิดหน้าเว็บ...")
        driver.get(URL)
        time.sleep(3)

        # ── ดึง options ทั้งหมด ──
        sel_el = wait.until(EC.presence_of_element_located((By.NAME, "major_id")))
        all_opts = [
            (o.get_attribute("value"), o.text.strip())
            for o in sel_el.find_elements(By.TAG_NAME, "option")
        ]

        # เอาเฉพาะสาขาจริง (value ลงท้าย _B) ไม่เอากลุ่ม (_A)
        major_opts = [(v, t) for v, t in all_opts if v.endswith("_B")]
        print(f"[2] พบ {len(major_opts)} สาขา (เฉพาะ _B)")
        for v, t in major_opts:
            print(f"    {v}  {t}")

        all_courses = []

        for major_value, major_label in major_opts:
            courses = scrape_major(driver, wait, major_value, major_label, STD_YEAR)
            all_courses.extend(courses)
            time.sleep(1)  #礼貌 delay

        # ── บันทึก JSON ──
        os.makedirs("public", exist_ok=True)

        output = {
            "courses": all_courses,
            "majors": [
                {"value": v, "label": t}
                for v, t in major_opts
            ],
            "std_year": STD_YEAR,
            "total": len(all_courses),
        }

        with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, indent=2)

        print(f"\n{'='*50}")
        print(f"✅ รวมทั้งหมด {len(all_courses)} รายการ → {OUTPUT_PATH}")
        print(f"{'='*50}")

        # preview
        valid = [c for c in all_courses if c["start"]]
        print(f"   มีเวลา: {len(valid)}, ไม่มีเวลา: {len(all_courses)-len(valid)}")
        for c in all_courses[:3]:
            print(" ", json.dumps(c, ensure_ascii=False))

    except Exception:
        traceback.print_exc()
        driver.save_screenshot("debug_error.png")
    finally:
        input("\nกด Enter ปิด browser...")
        driver.quit()

if __name__ == "__main__":
    try:
        import bs4
    except ImportError:
        print("pip install beautifulsoup4")
        exit(1)
    run()
    