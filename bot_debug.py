"""
bot.py — KU Timetable Scraper (ฉกส.)
รองรับโครงสร้างตารางใหม่: misreg/schedule_v2/index.php
- ดึงหน่วยกิตจากคอลัมน์ "หน่วยกิต" เช่น "3 (3-0)", "1 (0-3-0)"
- ดึงห้องเรียนจากคอลัมน์ "ห้อง"
- ดึงวันเวลาจากคอลัมน์ "บรรยาย / วัน-เวลา"
- บันทึก → public/all_timetables.json (App.jsx โหลดอัตโนมัติ)
"""

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import Select, WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager
from bs4 import BeautifulSoup, Tag
import time, json, re, os, traceback
from datetime import datetime

# ──────────────────────────────────────────────
#  CONFIG
# ──────────────────────────────────────────────
URL         = "https://misreg.csc.ku.ac.th/misreg/schedule_v2/index.php?flag=FM"
OUTPUT_PATH = "public/all_timetables.json"
WAIT_SECS   = 30
YEAR_START  = 65

def get_latest_year():
    thai_year = datetime.now().year + 543
    return int(str(thai_year)[-2:])

DAY_EN = {
    "อาทิตย์": "SUN", "จันทร์": "MON", "อังคาร": "TUE",
    "พุธ": "WED", "พฤหัสบดี": "THU", "พฤหัส": "THU",
    "ศุกร์": "FRI", "เสาร์": "SAT",
    "sunday": "SUN", "monday": "MON", "tuesday": "TUE",
    "wednesday": "WED", "thursday": "THU", "friday": "FRI", "saturday": "SAT",
}

# ──────────────────────────────────────────────
#  HELPERS
# ──────────────────────────────────────────────
def to_hhmm(raw):
    """แปลง raw time string → "HH:MM" """
    s = str(raw).strip()
    sep = "." if "." in s else (":" if ":" in s else None)
    if sep:
        parts = s.split(sep, 1)
        try:
            h = int(parts[0])
            m_str = parts[1].strip()
            if m_str.startswith("3"):
                m = 30
            elif m_str == "" or m_str.startswith("0"):
                m = 0
            else:
                m = int(m_str) if m_str.isdigit() else 0
            return f"{h:02d}:{m:02d}"
        except:
            return s
    if s.isdigit():
        n = int(s)
        if n >= 100:
            return f"{n // 100:02d}:{n % 100:02d}"
        return f"{n:02d}:00"
    return s


def parse_time_range(text):
    """ดึง (start, end) จาก text เช่น "พ.(9.3-12.3)" หรือ "จ.09:30-12:30" """
    t = str(text)
    # dot/colon format: 9.3-12.3, 09:30-12:30
    m = re.search(r"(\d{1,2}[.:]\d{1,2})\s*[-–]\s*(\d{1,2}[.:]\d{1,2})", t)
    if m:
        return to_hhmm(m.group(1)), to_hhmm(m.group(2))
    # compact: 800-1200, 1330-1630
    m = re.search(r"\b(\d{3,4})\s*[-–]\s*(\d{3,4})\b", t)
    if m:
        return to_hhmm(m.group(1)), to_hhmm(m.group(2))
    # hour only: 8-11, 13-16
    m = re.search(r"\b(\d{1,2})\s*[-–]\s*(\d{1,2})\b", t)
    if m:
        s_h, e_h = int(m.group(1)), int(m.group(2))
        if 0 <= s_h <= 23 and 0 <= e_h <= 23:
            return to_hhmm(m.group(1)), to_hhmm(m.group(2))
    return None, None


def parse_day(text):
    """ดึงชื่อวันจาก text เช่น "พ.(9.3-12.3)" → "WED" """
    t = str(text).strip()
    # ตัดตัวย่อวันภาษาไทย: จ อ พ พฤ ศ ส อา
    abbr_map = {
        "อา": "SUN", "จ": "MON", "อ": "TUE",
        "พฤ": "THU", "พ": "WED", "ศ": "FRI", "ส": "SAT",
    }
    # ลอง full name ก่อน
    for k, v in DAY_EN.items():
        if k in t:
            return v
    # ลอง abbreviation (เรียงจากยาวไปสั้น เพื่อกัน "พ" match ก่อน "พฤ")
    for k in sorted(abbr_map.keys(), key=len, reverse=True):
        if t.startswith(k) or f" {k}" in t or f"\n{k}" in t:
            return abbr_map[k]
    return None


def extract_credit(text):
    """
    ดึงหน่วยกิตจาก text เช่น
      "3 (3-0)"   → 3
      "1 (0-3-0)" → 1
      "3(2-2-5)"  → 3
    """
    m = re.match(r"^\s*(\d+)\s*[\(\[]?", str(text).strip())
    if m:
        val = int(m.group(1))
        if 1 <= val <= 15:
            return val
    return 3


# ──────────────────────────────────────────────
#  PARSE ตาราง HTML โครงสร้างใหม่
# ──────────────────────────────────────────────
def parse_new_table(html, major_value="", major_label="", std_year=""):
    """
    โครงสร้างตาราง:
    ที่ | รหัสวิชา | ชื่อวิชา | หน่วยกิต | บรรยาย(หมู่/วัน-เวลา/ห้อง) | ปฏิบัติ | สาขา-ชั้นปี

    หน่วยกิตอยู่คอลัมน์ที่ 3 (index 2) มี rowspan=2
    แต่ละหมู่เรียนอยู่ใน sub-row ของคอลัมน์ บรรยาย
    """
    results = []
    seen    = set()
    soup    = BeautifulSoup(html, "html.parser")

    # หา table หลัก — มักเป็น table ใหญ่สุดที่มี "รหัสวิชา" หรือ "หน่วยกิต"
    target = None
    for tbl in soup.find_all("table"):
        txt = tbl.get_text()
        if "รหัสวิชา" in txt or "หน่วยกิต" in txt:
            target = tbl
            break
    if not target:
        tables = soup.find_all("table")
        target = max(tables, key=lambda t: len(t.get_text())) if tables else None
    if not target:
        print(f"  ❌ ไม่พบ table: {major_label} ปี {std_year}")
        return results

    rows = target.find_all("tr")
    print(f"  พบ {len(rows)} rows")

    i = 0
    while i < len(rows):
        row = rows[i]
        cells = row.find_all(["td", "th"])

        # ── ข้ามแถว header ──
        if any("รหัสวิชา" in c.get_text() or "หน่วยกิต" in c.get_text() for c in cells):
            i += 1
            continue

        # ── แถวข้อมูลวิชา: ต้องมี cell ที่มีรหัสวิชา (8 หลัก) ──
        row_text = row.get_text(" ", strip=True)
        code_match = re.search(r"\b([A-Za-z]?\d{8}(?:-\d+)?)\b", row_text)
        if not code_match:
            i += 1
            continue

        # ── ดึงข้อมูลจาก cells ──
        # โครงสร้าง td: [ที่, รหัสวิชา, ชื่อวิชา, หน่วยกิต, หมู่, วัน-เวลา, ห้อง, ...]
        # หน่วยกิต = td ที่มี rowspan=2 และ pattern "N (N-N)"
        code_raw  = ""
        name_raw  = ""
        credit    = 3
        sec_row   = ""
        day_time  = ""
        room      = ""

        # วนหา td ที่เป็นรหัสวิชา (8+ หลัก)
        for ci, cell in enumerate(cells):
            ct = cell.get_text(" ", strip=True)
            if re.match(r"^[A-Za-z]?\d{8}", ct):
                code_raw = ct.strip()
                # ชื่อวิชามักอยู่ถัดไป
                if ci + 1 < len(cells):
                    name_raw = cells[ci + 1].get_text(" ", strip=True).strip()
                # หน่วยกิต: หา td ที่มีรูปแบบ "N (N-N)" ในแถวเดียวกัน
                for cj, c2 in enumerate(cells):
                    ct2 = c2.get_text(" ", strip=True)
                    if re.match(r"^\d+\s*[\(\[]", ct2):
                        credit = extract_credit(ct2)
                        break
                break

        # ดึง code และ normalize
        code = re.sub(r"-\d{2,4}$", "", code_raw).strip()
        if not code:
            i += 1
            continue

        # ── แถวปัจจุบัน + แถวถัดไป (rowspan=2 logic) ──
        # แถวหมู่เรียน/เวลา/ห้อง มักอยู่ในแถว i และ i+1
        # เราดึงจากทุก td ที่มีข้อมูลวัน-เวลา

        section_rows = [row]
        # เช็คแถวถัดไป — ถ้าไม่มี code ใหม่ถือว่าเป็น continuation
        if i + 1 < len(rows):
            next_row = rows[i + 1]
            next_text = next_row.get_text(" ", strip=True)
            if not re.search(r"\b[A-Za-z]?\d{8}\b", next_text):
                section_rows.append(next_row)

        # รวม text จากทุก section_row เพื่อดึงหมู่/วัน/เวลา/ห้อง
        for srow in section_rows:
            scells = srow.find_all(["td", "th"])
            for scell in scells:
                ct = scell.get_text("\n", strip=True)
                lines = [l.strip() for l in ct.split("\n") if l.strip()]

                for line in lines:
                    # หา หมู่เรียน เช่น "1", "102", "A-0"
                    if re.match(r"^[A-Za-z0-9]{1,5}$", line) and not re.search(r"\d{6}", line):
                        if not sec_row:
                            sec_row = line

                    # หาวัน-เวลา
                    if not day_time:
                        s, e = parse_time_range(line)
                        if s and e:
                            day_time = line

                    # หาห้อง เช่น "2-207", "9-301/1", "SC1-101"
                    if not room:
                        m_room = re.search(r"\b([A-Za-z]{0,4}\d{1,2}[-/]\d{2,4}(?:/\d+)?)\b", line)
                        if m_room:
                            candidate = m_room.group(1)
                            # ไม่เอา code วิชา
                            if not re.search(r"\d{6}", candidate):
                                room = candidate

        # ── parse วัน + เวลา ──
        day   = parse_day(day_time) if day_time else None
        start, end = parse_time_range(day_time) if day_time else (None, None)

        # ── ใช้ sec จาก cells โดยตรงถ้ายังไม่มี ──
        if not sec_row:
            sec_row = "1"

        if not (code and day and start and end):
            i += 1
            continue

        key = f"{code}_{sec_row}_{day}_{std_year}"
        if key in seen:
            i += 1
            continue
        seen.add(key)

        course = {
            "code":        code,
            "name":        name_raw or "(ไม่มีชื่อ)",
            "sec":         sec_row,
            "day":         day,
            "start":       start,
            "end":         end,
            "instructor":  "-",
            "room":        room,
            "credit":      credit,
            "year":        std_year,
            "major_value": major_value,
            "major_label": major_label,
        }
        results.append(course)
        print(f"    ✓ {code} sec{sec_row} {start}-{end}  {credit}u  ห้อง:{room or '-'}  {name_raw[:20]}")

        i += 2 if len(section_rows) > 1 else 1

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

        # รอให้ข้อมูลโหลด
        deadline = time.time() + 20
        page_html = ""
        while time.time() < deadline:
            page_html = driver.page_source
            if "รหัสวิชา" in page_html and "หน่วยกิต" in page_html:
                print(f"    ✓ โหลดแล้ว")
                break
            time.sleep(0.5)
        else:
            print(f"    ⚠ timeout — parse สิ่งที่มี")

        return parse_new_table(page_html, major_value, major_label, std_year)

    except Exception as e:
        print(f"    ❌ Error: {e}")
        traceback.print_exc()
        return []


# ──────────────────────────────────────────────
#  MAIN
# ──────────────────────────────────────────────
def run():
    latest_year = get_latest_year()
    year_strs   = [str(y) for y in range(YEAR_START, latest_year + 1)]
    print(f"[CONFIG] ปีรหัส: {', '.join(year_strs)}  (ล่าสุด = {latest_year})")

    opts = webdriver.ChromeOptions()
    # opts.add_argument("--headless")  # เปิด comment นี้ถ้าไม่ต้องการเห็น browser
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    driver = webdriver.Chrome(
        service=Service(ChromeDriverManager().install()),
        options=opts,
    )
    wait = WebDriverWait(driver, WAIT_SECS)

    try:
        print(f"\n[1] เปิดหน้าเว็บ...")
        driver.get(URL)
        time.sleep(3)

        sel_el = wait.until(EC.presence_of_element_located((By.NAME, "major_id")))
        all_opts = [
            (o.get_attribute("value"), o.text.strip())
            for o in sel_el.find_elements(By.TAG_NAME, "option")
        ]
        major_opts = [(v, t) for v, t in all_opts if v and v.endswith("_B")]
        print(f"[2] พบ {len(major_opts)} สาขา")
        for v, t in major_opts:
            print(f"    {v}  {t}")

        all_courses    = []
        total_by_year  = {}

        print(f"\n[3] เริ่มดึง {len(major_opts)} สาขา × {len(year_strs)} ปี")
        print("=" * 60)

        for std_year in year_strs:
            print(f"\n{'─'*60}\n  ปีรหัส {std_year}\n{'─'*60}")
            year_count = 0
            for major_value, major_label in major_opts:
                courses = scrape_major_year(driver, wait, major_value, major_label, std_year)
                all_courses.extend(courses)
                year_count += len(courses)
                time.sleep(1)
            total_by_year[std_year] = year_count
            print(f"  รวมปี {std_year}: {year_count} รายวิชา")

        # ── บันทึก JSON ──────────────────────────────────
        os.makedirs("public", exist_ok=True)
        output = {
            "courses": all_courses,
            "majors":  [{"value": v, "label": t} for v, t in major_opts],
            "year_range":    year_strs,
            "total_by_year": total_by_year,
            "total":         len(all_courses),
            "updated_at":    datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }
        with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, indent=2)

        # ── สรุปผล ────────────────────────────────────────
        print(f"\n{'='*60}")
        print(f"✅ บันทึกแล้ว → {OUTPUT_PATH}")
        print(f"   รวม: {len(all_courses)} รายวิชา")
        for yr, cnt in total_by_year.items():
            print(f"   ปี {yr}: {cnt} รายการ")

        valid   = [c for c in all_courses if c["start"]]
        no_cred = [c for c in all_courses if c["credit"] == 3]
        print(f"\n   มีเวลา:  {len(valid)}/{len(all_courses)}")
        print(f"   หน่วยกิต fallback(3): {len(no_cred)}")
        print(f"\nตัวอย่าง 3 รายการแรก:")
        for c in all_courses[:3]:
            print(" ", json.dumps(c, ensure_ascii=False))
        print(f"{'='*60}")

    except Exception:
        traceback.print_exc()
        driver.save_screenshot("debug_error.png")
        print("📸 screenshot → debug_error.png")
    finally:
        input("\nกด Enter ปิด browser...")
        driver.quit()


# ──────────────────────────────────────────────
#  SELF-TEST
# ──────────────────────────────────────────────
if __name__ == "__main__":
    try:
        import bs4
    except ImportError:
        print("pip install beautifulsoup4 selenium webdriver-manager")
        exit(1)

    print("=== Self-test: parse helpers ===")
    time_tests = [
        ("พ.(9.3-12.3 น.)",  ("09:30", "12:30")),
        ("จ.09:30-12:30",    ("09:30", "12:30")),
        ("800-1200",         ("08:00", "12:00")),
        ("13.3-16.3",        ("13:30", "16:30")),
        ("16.3-19.3",        ("16:30", "19:30")),
        ("1330-1630",        ("13:30", "16:30")),
        ("8-11 น.",          ("08:00", "11:00")),
    ]
    all_pass = True
    for inp, expected in time_tests:
        result = parse_time_range(inp)
        ok = result == expected
        if not ok: all_pass = False
        print(f"  {'✓' if ok else '✗'} '{inp}' → {result}  (expected {expected})")

    credit_tests = [
        ("3 (3-0)",   3),
        ("1 (0-3-0)", 1),
        ("3(2-2-5)",  3),
        ("2",         2),
    ]
    for inp, expected in credit_tests:
        result = extract_credit(inp)
        ok = result == expected
        if not ok: all_pass = False
        print(f"  {'✓' if ok else '✗'} credit('{inp}') → {result}  (expected {expected})")

    print(f"\n{'All PASSED ✅' if all_pass else 'Some FAILED ❌'}\n")

    run()