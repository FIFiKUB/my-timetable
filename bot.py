"""
bot.py — KU Timetable Scraper  (แก้ไข regex เวลา + ดึงห้องเรียน)
- ค้นหาหลายปีรหัส: เริ่มจากปี 65 → ปีล่าสุดอัตโนมัติ
- ข้อมูลใหม่แทนที่ข้อมูลเดิมทั้งหมด (ไม่ merge)
"""

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import Select, WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager
from bs4 import BeautifulSoup
import time, json, re, os, traceback
from datetime import datetime

# ──────────────────────────────────────────────
#  CONFIG
# ──────────────────────────────────────────────
URL         = "https://misreg.csc.ku.ac.th/misreg/schedule_v2/index.php?flag=FM"
OUTPUT_PATH = "public/all_timetables.json"
WAIT_SECS   = 30

YEAR_START  = 65   # ปีรหัสเริ่มต้น (พ.ศ. 2 หลัก)

def get_latest_year():
    now = datetime.now()
    thai_year = now.year + 543
    return int(str(thai_year)[-2:])

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
    """
    แปลง raw string → "HH:MM"
    รองรับรูปแบบ:
      "9.3"   → "09:30"   (Thai .3 = 30 min)
      "09:30" → "09:30"
      "8"     → "08:00"   (hour only)
      "800"   → "08:00"   (HHMM compact)
      "1330"  → "13:30"
    """
    s = str(raw).strip()

    # มี . หรือ :
    sep = "." if "." in s else (":" if ":" in s else None)
    if sep:
        h_s, m_s = s.split(sep, 1)
        try:
            h = int(h_s)
            m_str = str(m_s).strip()
            # Thai convention: .3 = :30, .00 = :00
            if m_str.startswith("3"):
                m = 30
            elif m_str.startswith("0") or m_str == "":
                m = 0
            else:
                m = int(m_str) if m_str.isdigit() else 0
            return f"{h:02d}:{m:02d}"
        except:
            return s

    # ไม่มี separator — เป็นตัวเลขล้วน
    if s.isdigit():
        n = int(s)
        if n >= 100:
            # รูปแบบ HHMM เช่น 800 → 8:00, 1330 → 13:30
            h = n // 100
            m = n % 100
            return f"{h:02d}:{m:02d}"
        else:
            # hour เดียว เช่น 8, 13
            return f"{n:02d}:00"

    return s


def parse_time_range(text):
    """
    ดึง start/end time จาก text
    รองรับรูปแบบ:
      "9.3-12.3 น."       → ("09:30", "12:30")
      "08:00-11:00"        → ("08:00", "11:00")
      "8-11 น."            → ("08:00", "11:00")
      "800-1200"           → ("08:00", "12:00")
      "16.3-19.3 น."       → ("16:30", "19:30")
    """
    t = str(text)

    # 1) รูปแบบที่มี dot/colon เช่น 9.3-12.3 หรือ 09:30-12:30
    m = re.search(
        r"(\d{1,2}[.:]\d{1,2})\s*[-–]\s*(\d{1,2}[.:]\d{1,2})",
        t
    )
    if m:
        return (to_hhmm(m.group(1)), to_hhmm(m.group(2)))

    # 2) รูปแบบ HHMM compact เช่น 800-1200, 1330-1630
    m = re.search(r"\b(\d{3,4})\s*[-–]\s*(\d{3,4})\b", t)
    if m:
        return (to_hhmm(m.group(1)), to_hhmm(m.group(2)))

    # 3) รูปแบบ hour เดียว เช่น 8-11, 13-16
    m = re.search(r"\b(\d{1,2})\s*[-–]\s*(\d{1,2})\b", t)
    if m:
        s_hr, e_hr = int(m.group(1)), int(m.group(2))
        # ตรวจสอบให้สมเหตุสมผล (ชั่วโมง 0-23)
        if 0 <= s_hr <= 23 and 0 <= e_hr <= 23:
            return (to_hhmm(m.group(1)), to_hhmm(m.group(2)))

    return (None, None)


def extract_room(lines, code_line_idx=0):
    """
    พยายามดึงข้อมูลห้องเรียนจาก lines
    คืนค่า string ของห้อง หรือ "" ถ้าไม่พบ
    """
    room = ""
    for i, line in enumerate(lines):
        if i == code_line_idx:
            continue  # ข้ามบรรทัดรหัสวิชา

        # pattern 1: "ห้อง X-XXX" หรือ "ห้อง XXXX"
        m = re.search(r"ห้อง\s*([^\s,\n]+)", line)
        if m:
            room = m.group(1).strip()
            # ลบ trailing ที่ไม่ใช่ room code
            room = re.sub(r"[^\w\-/()]", "", room)
            if room:
                break

        # pattern 2: room code รูปแบบ "7-224", "9-301/1", "SC1-101"
        if not room and i != code_line_idx:
            m = re.search(
                r"\b([A-Za-z]{0,4}\d{1,2}[-/]\d{2,4}(?:/\d+)?)\b",
                line
            )
            if m:
                candidate = m.group(1)
                # ห้ามเอาบรรทัดแรก (รหัสวิชา) ไปตีความเป็นห้อง
                room = candidate
                break

        # pattern 3: ห้องแบบตัวอักษรตัวเลขล้วน เช่น "8/2", "21-215"
        if not room and i != code_line_idx:
            m = re.search(r"\b(\d{1,2}[-/]\d{1,3}(?:/\d+)?)\b", line)
            if m and i > 0:
                room = m.group(1)
                break

    return room


# ──────────────────────────────────────────────
#  PARSE TABLE HTML
# ──────────────────────────────────────────────
def parse_timetable_html(html, major_value="", major_label="", std_year=""):
    results, seen = [], set()
    soup = BeautifulSoup(html, "html.parser")

    # หา table หลัก
    target_table = None
    for tbl in soup.find_all("table"):
        text = tbl.get_text()
        if "8.00" in text or "เวลา" in text or "เวลา" in text:
            target_table = tbl
            break

    if not target_table:
        tables = soup.find_all("table")
        if tables:
            target_table = max(tables, key=lambda t: len(t.get_text()))

    if not target_table:
        print(f"  ❌ ไม่พบ table สำหรับ {major_label} ปี {std_year}")
        return results

    rows = target_table.find_all("tr")
    print(f"  พบ {len(rows)} rows")

    current_day = ""

    for row in rows:
        cells = row.find_all(["td", "th"])
        if not cells:
            continue

        first_text = cells[0].get_text(strip=True).lower()

        if "เวลา" in first_text or "8.00" in first_text or "วัน" in first_text:
            continue

        # ตรวจวัน
        day_found = DAY_EN.get(first_text, "")
        if not day_found:
            for k, v in DAY_EN.items():
                if k in first_text:
                    day_found = v
                    break

        if day_found:
            current_day = day_found
            data_cells = cells[1:]
        else:
            data_cells = cells

        if not current_day:
            continue

        for cell in data_cells:
            raw = cell.get_text("\n", strip=True).strip()
            if len(raw) < 5:
                continue

            if not re.search(r"[A-Za-z]?\d{6,}", raw):
                continue

            blocks = re.split(r"[=\-]{3,}", raw)
            for block in blocks:
                block = block.strip()
                if len(block) < 5:
                    continue

                lines = [l.strip() for l in block.split("\n") if l.strip()]
                if len(lines) < 2:
                    continue

                # ── รหัสวิชา + หมู่ ──
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

                # ── เวลา: ค้นหาจากทุก line ──
                start, end = None, None
                for l in lines[1:4]:
                    s, e = parse_time_range(l)
                    if s and e:
                        start, end = s, e
                        break

                # ── ชื่อวิชา ──
                name = ""
                for l in lines[1:]:
                    if (not re.search(r"\d+[.:]\d+", l)
                            and not re.match(r"^\d+[-–]\d+$", l)
                            and not re.match(r"^\d+$", l)
                            and "ห้อง" not in l
                            and len(l) > 3):
                        name = re.sub(r"\s*\(\d{2,4}\)\s*$", "", l).strip()
                        if len(name) > 3:
                            break

                # ── อาจารย์ ──
                instructor = "-"
                for l in reversed(lines):
                    if (("อ." in l or "ผศ." in l or "รศ." in l
                         or "ศ." in l or "ดร." in l)
                            and len(l) > 2):
                        instructor = l.strip()
                        break

                # ── ห้องเรียน (FIX ส่วน 2) ──
                room = extract_room(lines, code_line_idx=0)

                # fallback: ดึงจาก HTML cell โดยตรง (มักอยู่ใน <br> แรก)
                if not room:
                    cell_html = str(cell)
                    m_room_html = re.search(
                        r"ห้อง\s*([^\s<,]+)", cell_html
                    )
                    if m_room_html:
                        room = re.sub(r"[^\w\-/()]", "", m_room_html.group(1))

                # key รวม std_year เพื่อแยก section ที่เหมือนกันแต่ต่างปี
                key = f"{code}_{sec}_{current_day}_{std_year}"
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
                    "room": room,
                    "credit": 3,
                    "year": std_year,
                    "major_value": major_value,
                    "major_label": major_label,
                }
                results.append(course)
                print(f"    ✓ {code} sec{sec} {start}-{end}  {name[:20]}  ห้อง:{room or '-'}")

    return results


# ──────────────────────────────────────────────
#  SCRAPE 1 สาขา + 1 ปี
# ──────────────────────────────────────────────
def scrape_major_year(driver, wait, major_value, major_label, std_year):
    print(f"\n  ► {major_label} ({major_value})  ปีรหัส {std_year}")
    try:
        sel_el = wait.until(EC.presence_of_element_located((By.NAME, "major_id")))
        Select(sel_el).select_by_value(major_value)

        yr_input = driver.find_element(By.NAME, "std_year")
        yr_input.clear()
        yr_input.send_keys(std_year)

        btn = driver.find_element(By.NAME, "btnMajor")
        btn.click()
        time.sleep(3)

        deadline = time.time() + 20
        page_html = ""
        while time.time() < deadline:
            page_html = driver.page_source
            if major_label[:5] in page_html and any(
                day in page_html for day in ["จันทร์","อังคาร","พุธ","พฤหัส","ศุกร์","อาทิตย์","เสาร์"]
            ):
                print(f"    ✓ โหลดแล้ว")
                break
            time.sleep(0.5)
        else:
            print(f"    ⚠ timeout — ลอง parse สิ่งที่มี")

        return parse_timetable_html(page_html, major_value, major_label, std_year)

    except Exception as e:
        print(f"    ❌ Error: {e}")
        traceback.print_exc()
        return []


# ──────────────────────────────────────────────
#  MAIN
# ──────────────────────────────────────────────
def run():
    latest_year = get_latest_year()
    year_range = list(range(YEAR_START, latest_year + 1))
    year_strs = [str(y) for y in year_range]

    print(f"[CONFIG] ปีรหัสที่จะค้นหา: {', '.join(year_strs)} (ปีล่าสุด = {latest_year})")

    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()))
    wait   = WebDriverWait(driver, WAIT_SECS)

    try:
        print(f"\n[1] เปิดหน้าเว็บ...")
        driver.get(URL)
        time.sleep(3)

        sel_el = wait.until(EC.presence_of_element_located((By.NAME, "major_id")))
        all_opts = [
            (o.get_attribute("value"), o.text.strip())
            for o in sel_el.find_elements(By.TAG_NAME, "option")
        ]

        major_opts = [(v, t) for v, t in all_opts if v.endswith("_B")]
        print(f"[2] พบ {len(major_opts)} สาขา (เฉพาะ _B)")
        for v, t in major_opts:
            print(f"    {v}  {t}")

        all_courses = []
        total_by_year = {}

        print(f"\n[3] เริ่มดึงข้อมูล {len(major_opts)} สาขา × {len(year_strs)} ปี = {len(major_opts)*len(year_strs)} รอบ")
        print("=" * 60)

        for std_year in year_strs:
            print(f"\n{'─'*60}")
            print(f"  ปีรหัส {std_year}")
            print(f"{'─'*60}")
            year_count = 0

            for major_value, major_label in major_opts:
                courses = scrape_major_year(driver, wait, major_value, major_label, std_year)
                all_courses.extend(courses)
                year_count += len(courses)
                time.sleep(1)

            total_by_year[std_year] = year_count
            print(f"  รวมปี {std_year}: {year_count} รายวิชา")

        # บันทึก JSON
        os.makedirs("public", exist_ok=True)

        output = {
            "courses": all_courses,
            "majors": [{"value": v, "label": t} for v, t in major_opts],
            "year_range": year_strs,
            "total_by_year": total_by_year,
            "total": len(all_courses),
            "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }

        with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, indent=2)

        print(f"\n{'='*60}")
        print(f"✅ บันทึกแล้ว → {OUTPUT_PATH}")
        print(f"   รวมทั้งหมด: {len(all_courses)} รายวิชา")
        for yr, cnt in total_by_year.items():
            print(f"   ปี {yr}: {cnt} รายการ")
        print(f"{'='*60}")

        valid = [c for c in all_courses if c["start"]]
        print(f"\n   มีเวลา: {len(valid)}, ไม่มีเวลา: {len(all_courses)-len(valid)}")
        print("\nตัวอย่าง 3 รายการแรก:")
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
        print("กรุณาติดตั้ง: pip install beautifulsoup4 selenium webdriver-manager")
        exit(1)

    # ── Quick test parse_time_range ──────────────────────
    print("=== Test parse_time_range ===")
    tests = [
        ("9.3-12.3 น.", ("09:30", "12:30")),
        ("8-11 น.",     ("08:00", "11:00")),
        ("800-1200",    ("08:00", "12:00")),
        ("13.3-16.3",   ("13:30", "16:30")),
        ("16.3-19.3",   ("16:30", "19:30")),
        ("08:00-11:00", ("08:00", "11:00")),
        ("1330-1630",   ("13:30", "16:30")),
    ]
    all_pass = True
    for inp, expected in tests:
        result = parse_time_range(inp)
        status = "✓" if result == expected else "✗"
        if result != expected:
            all_pass = False
        print(f"  {status} '{inp}' → {result}  (expected {expected})")
    print(f"\n{'All tests PASSED ✅' if all_pass else 'Some tests FAILED ❌'}\n")
    # ───────────────────────────────────────────────────────

    run()