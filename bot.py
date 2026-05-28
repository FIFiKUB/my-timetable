"""
bot.py -- KU Timetable Scraper (fgks.)
Scrapes index.php (main page) for ALL courses across all majors.
Data includes: lecture time/room, lab time/room, seat counts, credits, branch, instructor.
Also supports FM page (flag=FM) as fallback if main page fails.
"""

import sys
sys.stdout.reconfigure(encoding="utf-8")

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import Select, WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager
from bs4 import BeautifulSoup
import time, json, re, os, traceback
from collections import defaultdict
from datetime import datetime

URL_MAIN      = "https://misreg.csc.ku.ac.th/schedule_v2/index.php"
URL_FM        = "https://misreg.csc.ku.ac.th/schedule_v2/index.php?flag=FM"
OUTPUT_STAGING = "data/all_timetables.staging.json"   # bot เขียนที่นี่ก่อน
OUTPUT_LIVE    = "public/all_timetables.json"          # เว็บอ่านจากที่นี่
WAIT_SECS     = 30
YEAR_START    = 65  # used only in FM fallback mode

def get_latest_year():
    thai_year = datetime.now().year + 543
    return int(str(thai_year)[-2:])

DAY_EN = {
    "sunday": "SUN", "monday": "MON", "tuesday": "TUE",
    "wednesday": "WED", "thursday": "THU", "friday": "FRI", "saturday": "SAT",
}

THAI_DAYS = [
    ("SUN", ["อาทิตย์", "อา"]),
    ("MON", ["จันทร์", "จ"]),
    ("TUE", ["อังคาร", "อ"]),
    ("WED", ["พุธ", "พ"]),
    ("THU", ["พฤหัสบดี", "พฤหัส", "พฤ"]),
    ("FRI", ["ศุกร์", "ศ"]),
    ("SAT", ["เสาร์", "ส"]),
]

# ── Utility ──────────────────────────────────────────────────────────────────

def to_hhmm(raw):
    s = str(raw).strip()
    sep = "." if "." in s else (":" if ":" in s else None)
    if sep:
        parts = s.split(sep, 1)
        try:
            h = int(parts[0])
            m_str = parts[1].strip()
            if m_str == "" or m_str == "0":
                m = 0
            elif len(m_str) == 1 and m_str.isdigit():
                m = int(m_str) * 10    # KU shorthand: "9.3" → 9:30
            elif m_str.startswith("0"):
                m = 0                  # "9.00" → :00
            elif m_str.isdigit():
                m = int(m_str)         # "9.30", "9.45"
            else:
                m = 0
            return f"{h:02d}:{m:02d}"
        except Exception:
            return s
    if s.isdigit():
        n = int(s)
        if n >= 100:
            return f"{n // 100:02d}:{n % 100:02d}"
        return f"{n:02d}:00"
    return s


def parse_time_range(text):
    t = str(text)
    m = re.search(r"(\d{1,2}[.:]\d{1,2})\s*[-–]\s*(\d{1,2}[.:]\d{1,2})", t)
    if m:
        return to_hhmm(m.group(1)), to_hhmm(m.group(2))
    m = re.search(r"\b(\d{3,4})\s*[-–]\s*(\d{3,4})\b", t)
    if m:
        return to_hhmm(m.group(1)), to_hhmm(m.group(2))
    m = re.search(r"\b(\d{1,2})\s*[-–]\s*(\d{1,2})\b", t)
    if m:
        s_h, e_h = int(m.group(1)), int(m.group(2))
        if 0 <= s_h <= 23 and 0 <= e_h <= 23:
            return to_hhmm(m.group(1)), to_hhmm(m.group(2))
    return None, None


def parse_day(text):
    t = str(text).strip()
    tl = t.lower()
    for k, v in DAY_EN.items():
        if k in tl:
            return v
    for day_en, patterns in THAI_DAYS:
        for p in patterns:
            if t.startswith(p) or p in t:
                return day_en
    return None


def extract_credit(text):
    m = re.match(r"^\s*(\d+)\s*[\(\[]?", str(text).strip())
    if m:
        val = int(m.group(1))
        if 1 <= val <= 15:
            return val
    return 3


def parse_seats(text):
    """
    Extract seat count from text like "30", "25/30", "รับ30 นั่ง25", "30(25)".
    Returns (total, enrolled) ints. -1 = unknown.
    """
    t = str(text).strip()
    # "รับ/นั่ง" → "capacity/used" → first number = total, second = enrolled
    m = re.search(r"(\d+)\s*/\s*(\d+)", t)
    if m:
        return int(m.group(1)), int(m.group(2))   # total, enrolled
    # "30(25)" format
    m = re.search(r"(\d+)\s*\((\d+)\)", t)
    if m:
        return int(m.group(1)), int(m.group(2))
    # Two separate numbers like "30  25" (total then enrolled on same line)
    nums = re.findall(r"\d+", t)
    if len(nums) >= 2:
        return int(nums[0]), int(nums[1])
    if len(nums) == 1:
        return int(nums[0]), -1
    return -1, -1


def clean_room(raw):
    return re.sub(r"[^\w\-/()]", "", str(raw)).strip()


# ── Main-page parser ─────────────────────────────────────────────────────────

def get_top_rows(tbl):
    """Return only top-level <tr> elements — skip nested table rows."""
    rows = []
    for child in tbl.children:
        n = getattr(child, "name", None)
        if n == "tr":
            rows.append(child)
        elif n in ("thead", "tbody", "tfoot"):
            for r in child.children:
                if getattr(r, "name", None) == "tr":
                    rows.append(r)
    return rows


def extract_branches_from_td(td):
    """
    Extract list of branch codes from a สาขา-ชั้นปี cell.
    The real KU page stores branches in a nested <table> inside the cell.
    Falls back to plain text if no nested table.
    """
    if td is None:
        return []
    nested = td.find("table")
    if nested:
        branches = []
        for tr in nested.find_all("tr"):
            # Use direct children only so we don't recurse further
            tds = tr.find_all(["td", "th"], recursive=False)
            if tds:
                txt = tds[0].get_text(strip=True)
                if txt and txt not in branches:
                    branches.append(txt)
        return branches
    # No nested table — plain text (e.g. self-test HTML)
    txt = td.get_text(strip=True)
    return [txt] if txt else []


def sum_seats_from_td(td):
    """
    Sum seat counts from a จำนวน(ต่อกลุ่ม) cell.
    Format in nested table: '20 (1)', '26 (2)', ...
    Returns total int, or -1 if unparseable.
    """
    if td is None:
        return -1
    nested = td.find("table")
    raw = ""
    if nested:
        raw = nested.get_text(" ", strip=True)
    else:
        raw = td.get_text(" ", strip=True)
    nums = [int(m.group(1)) for m in re.finditer(r"(\d+)\s*\(\d+\)", raw)]
    if nums:
        return sum(nums)
    # Fallback: try plain parse_seats on the whole text
    tot, _ = parse_seats(raw)
    return tot


def build_cell_map(rows):
    """
    Like build_grid but stores original BeautifulSoup Tag objects
    instead of plain text.  Uses recursive=False when finding cells
    so nested <table> cells are not counted separately.
    Returns list of {col_idx: Tag} dicts.
    """
    rowspan_map = {}   # {col_idx: (remaining_rows, Tag)}
    result = []
    for row in rows:
        cells = row.find_all(["td", "th"], recursive=False)
        row_data = {}
        new_map = {}
        for c_idx, (rem, el) in rowspan_map.items():
            row_data[c_idx] = el
            if rem > 1:
                new_map[c_idx] = (rem - 1, el)
        rowspan_map = new_map
        col_cursor = 0
        for cell in cells:
            while col_cursor in row_data:
                col_cursor += 1
            rs = int(cell.get("rowspan", 1))
            cs = int(cell.get("colspan", 1))
            for c in range(col_cursor, col_cursor + cs):
                row_data[c] = cell
                if rs > 1:
                    rowspan_map[c] = (rs - 1, cell)
            col_cursor += cs
        if row_data:
            result.append(row_data)
    return result


def build_grid(rows):
    """Expand rowspan/colspan into a 2D list of text values (text version of build_cell_map)."""
    cell_maps = build_cell_map(rows)
    grid = []
    for cm in cell_maps:
        if not cm:
            continue
        max_c = max(cm.keys())
        grid.append([cm[i].get_text(" ", strip=True) if i in cm else "" for i in range(max_c + 1)])
    return grid


def parse_daytime(text):
    """Parse 'พ.(9.3-12.3)' -> (day_en, start_hhmm, end_hhmm)."""
    t = str(text).strip()
    if not t:
        return None, None, None
    return parse_day(t), *parse_time_range(t)


def detect_main_page_cols(rows):
    """
    Real 15-col structure:
      0:ที่  1:รหัสวิชา  2:ชื่อวิชา  3:หน่วยกิต
      [บรรยาย cs=3]  4:หมู่  5:วัน-เวลา  6:ห้อง
      7:สาขา-ชั้นปี  8:จำนวน(คน)
      [ปฏิบัติ cs=3]  9:หมู่  10:วัน-เวลา  11:ห้อง
      12:สาขา-ชั้นปี  13:จำนวน(คน)
      14:อาจารย์
    """
    col = {
        "no": 0, "code": 1, "name": 2, "credit": 3,
        "lect_sec": 4, "lect_daytime": 5, "lect_room": 6,
        "lect_branch": 7, "lect_seats": 8,
        "lab_sec": 9, "lab_daytime": 10, "lab_room": 11,
        "lab_branch": 12, "lab_seats": 13,
        "instructor": 14,
    }
    lect_flat = None; lect_cs = 3
    lab_flat  = None; lab_cs  = 3

    for row in rows[:4]:
        ths = row.find_all(["th", "td"])
        if len(ths) < 4:
            continue
        flat = 0
        for cell in ths:
            txt = cell.get_text(strip=True)
            cs  = int(cell.get("colspan", 1))
            if "บรรยาย" in txt and cs >= 2:
                lect_flat = flat; lect_cs = cs
                col["lect_sec"]     = flat
                col["lect_daytime"] = flat + 1
                col["lect_room"]    = flat + 2
                if cs >= 5:
                    col["lect_branch"] = flat + 3
                    col["lect_seats"]  = flat + 4
                print(f"  [col-detect] บรรยาย at flat={flat} cs={cs}")
            elif "ปฏิบัติ" in txt and cs >= 2:
                lab_flat = flat; lab_cs = cs
                col["lab_sec"]     = flat
                col["lab_daytime"] = flat + 1
                col["lab_room"]    = flat + 2
                if cs >= 5:
                    col["lab_branch"] = flat + 3
                    col["lab_seats"]  = flat + 4
                print(f"  [col-detect] ปฏิบัติ at flat={flat} cs={cs}")
            elif "อาจารย์" in txt:
                col["instructor"] = flat
                print(f"  [col-detect] อาจารย์ at flat={flat}")
            flat += cs

    # สาขา/จำนวน outside group spans
    # cs=2: group=[หมู่,วัน-เวลา], standalone=ห้อง|สาขา|จำนวน after group
    # cs=3: group=[หมู่,วัน-เวลา,ห้อง], standalone=สาขา|จำนวน after group
    if lect_flat is not None and lab_flat is not None:
        after_lect = lect_flat + lect_cs   # first col after บรรยาย group
        if lect_cs < 5 and after_lect < lab_flat:
            if lect_cs <= 2:
                col["lect_room"]   = after_lect        # ห้อง standalone
                col["lect_branch"] = after_lect + 1    # สาขา-ชั้นปี
                col["lect_seats"]  = after_lect + 2    # จำนวน
            else:                                       # cs=3: ห้อง inside group
                col["lect_branch"] = after_lect        # สาขา-ชั้นปี
                col["lect_seats"]  = after_lect + 1    # จำนวน
        after_lab = lab_flat + lab_cs      # first col after ปฏิบัติ group
        if lab_cs < 5 and after_lab < col["instructor"]:
            if lab_cs <= 2:
                col["lab_room"]   = after_lab           # ห้อง standalone
                col["lab_branch"] = after_lab + 1       # สาขา-ชั้นปี
                col["lab_seats"]  = after_lab + 2       # จำนวน
            else:
                col["lab_branch"] = after_lab
                col["lab_seats"]  = after_lab + 1

    print(f"  [col-detect] map={col}")
    return col


def parse_main_html(html, semester_label=""):
    """
    Parse index.php (main page) — ALL courses, all majors.

    Returns one dict per (course_code, section) with keys:
      code, name, credit, sec,
      day/start/end/room,
      lab_day/lab_start/lab_end/lab_room,
      seats_total/seats_enrolled,
      branches (list of สาขา-ชั้นปี),
      instructor, semester
    """
    results = []
    soup    = BeautifulSoup(html, "html.parser")

    target = None
    for tbl in soup.find_all("table"):
        if "หน่วยกิต" in tbl.get_text():
            target = tbl
            break
    if not target:
        tables = soup.find_all("table")
        if tables:
            target = max(tables, key=lambda t: len(t.get_text()))
    if not target:
        print("  [parse_main] no table found")
        return results

    # Use get_top_rows to avoid recursing into nested tables
    all_rows = get_top_rows(target)
    print(f"  [parse_main] total rows: {len(all_rows)}")

    col = detect_main_page_cols(all_rows)

    data_rows = [r for r in all_rows
                 if not all(c.name == "th" for c in r.find_all(["td","th"], recursive=False))]
    cell_maps = build_cell_map(data_rows)
    print(f"  [parse_main] data grid rows: {len(cell_maps)}")

    def g(cm, key):
        c = col.get(key, -1)
        el = cm.get(c)
        return el.get_text(" ", strip=True) if el else ""

    seen_key = None
    current  = None

    for cm in cell_maps:
        if col["code"] not in cm:
            continue
        code_raw = g(cm, "code")
        m = re.match(r"(\d{8})(?:[- ]\d+)?", code_raw.replace(" ", ""))
        if not m:
            continue
        code = m.group(1)

        lect_sec   = g(cm, "lect_sec")
        lect_time  = g(cm, "lect_daytime")
        lab_sec    = g(cm, "lab_sec")
        lab_time   = g(cm, "lab_daytime")

        # ถ้า lect ว่าง (เป็น row lab-only) ใช้ lab_sec+lab_time เป็น key
        # ป้องกัน lab section หลายอัน (เช่น หมู่ 101,102,103) ถูก merge เป็น entry เดียว
        if lect_sec or lect_time:
            sec   = lect_sec
            ltime = lect_time
        else:
            sec   = lab_sec
            ltime = lab_time
        key = (code, sec, ltime)

        if key != seen_key:
            if current:
                results.append(current)

            lday, lstart, lend = parse_daytime(lect_time)
            pday, pstart, pend = parse_daytime(lab_time)
            tot  = sum_seats_from_td(cm.get(col.get("lect_seats", -1)))
            ptot = sum_seats_from_td(cm.get(col.get("lab_seats",  -1)))

            current = {
                "code":           code,
                "name":           g(cm, "name"),
                "credit":         extract_credit(g(cm, "credit")),
                "sec":            sec,
                "day":            lday   or "",
                "start":          lstart or "",
                "end":            lend   or "",
                "room":           clean_room(g(cm, "lect_room")),
                "lab_day":        pday   or "",
                "lab_start":      pstart or "",
                "lab_end":        pend   or "",
                "lab_room":       clean_room(g(cm, "lab_room")),
                "seats_total":    tot,
                "seats_enrolled": -1,
                "branches":       extract_branches_from_td(cm.get(col.get("lect_branch", -1))),
                "instructor":     g(cm, "instructor"),
                "semester":       semester_label,
                "year":           "",
                "major_label":    "",
                "major_value":    "",
            }
            seen_key = key

        # Merge additional branches from this row (handles both nested-table and
        # plain-text sub-row styles).  extract_branches_from_td already dedupes
        # via nested table; for plain-text cells on sub-rows we add manually.
        for br_key in ("lect_branch", "lab_branch"):
            br_td = cm.get(col.get(br_key, -1))
            if br_td is None:
                continue
            if br_td.find("table"):
                # Nested table already captured in current["branches"] at creation;
                # skip to avoid duplicates.
                continue
            for br in extract_branches_from_td(br_td):
                if br and br not in current["branches"]:
                    current["branches"].append(br)

    if current:
        results.append(current)

    for c in results[:3]:
        print(f"    + {c['code']} s{c['sec']} {c['credit']}u "
              f"{c['day']} {c['start']}-{c['end']} {c['room']} "
              f"lab={c['lab_day']} {c['lab_start']}-{c['lab_end']} "
              f"branches={c['branches'][:2]}")
    print(f"  [parse_main] parsed {len(results)} sections")
    return results


# ── Scraper functions ────────────────────────────────────────────────────────

def scrape_main_page(driver, wait):
    """
    Navigate to URL_MAIN and scrape all semesters.
    Returns (courses_list, semesters_list).

    KU เปลี่ยน form schema (พ.ย. 2025):
      - year: <input type="number" name="year"> (เคยเป็น <select name="acadyear">)
      - sem: <select name="sem">  (เคยเป็น <select name="semester">)
      - flag_status: <select name="flag_status">  (R=ป.ตรี ปกติ)
      - submit: <input name="btnSub">
    """
    print(f"  Navigating to {URL_MAIN}")
    driver.get(URL_MAIN)
    time.sleep(4)

    all_courses = []
    semesters   = []

    # Iterate Thai years backward from current → 2566 (oldest reasonable)
    current_thai = datetime.now().year + 543
    year_opts = [(str(y), str(y)) for y in range(current_thai, 2565, -1)]
    # Semester options: ต้น=1, ปลาย=2, ฤดูร้อน=0
    sem_opts = [("1", "ต้น"), ("2", "ปลาย"), ("0", "ฤดูร้อน")]

    print(f"  years={[y for y,_ in year_opts]}  sems={[s for s,_ in sem_opts]}")

    combos = [(yv, yt, sv, st) for yv, yt in year_opts for sv, st in sem_opts]

    for yv, yt, sv, st in combos:
        sem_label = f"{yt}/{st}".strip("/").strip()
        print(f"  [scrape_main] {sem_label or 'current'}")
        try:
            driver.get(URL_MAIN)
            time.sleep(2)
            # year — เป็น text input ตอนนี้
            year_el = driver.find_element(By.NAME, "year")
            year_el.clear()
            year_el.send_keys(yv)
            # semester — เป็น select
            Select(driver.find_element(By.NAME, "sem")).select_by_value(sv)
            # program type — R = ป.ตรี ภาคปกติ
            try:
                Select(driver.find_element(By.NAME, "flag_status")).select_by_value("R")
            except Exception:
                pass
            # Submit
            for sel in ["input[name='btnSub']", "input[type='submit']", "button[type='submit']"]:
                try:
                    driver.find_element(By.CSS_SELECTOR, sel).click()
                    break
                except Exception:
                    pass
            time.sleep(4)

            page_html = driver.page_source
            soup = BeautifulSoup(page_html, "html.parser")
            n_rows = len(soup.find_all("tr"))
            print(f"    rows={n_rows}")
            if n_rows <= 4:
                print(f"    [skip] too few rows")
                continue

            courses = parse_main_html(page_html, sem_label)
            if courses:
                all_courses.extend(courses)
                semesters.append(sem_label)
                print(f"    → {len(courses)} sections")
        except Exception as e:
            print(f"    ERROR: {e}")
            traceback.print_exc()

    return all_courses, semesters


def parse_fm_timetable_html(html, sem_label):
    """Parse FM timetable result page — visual day×time grid format.

    Returns list of course entries. Each block in grid = 1 entry.
    Sec number heuristic:
      - sec=1..99   → lecture
      - sec=101..999 → lab
    """
    soup = BeautifulSoup(html, "html.parser")
    day_map = {
        "sunday": "SUN", "monday": "MON", "tuesday": "TUE",
        "wednesday": "WED", "thursday": "THU", "friday": "FRI", "saturday": "SAT",
    }
    timetable = None
    for table in soup.find_all("table"):
        tbody = table.find("tbody") or table
        trows = tbody.find_all("tr", recursive=False)
        if len(trows) >= 4:
            fth = trows[0].find(["th", "td"])
            if fth and "เวลา" in fth.get_text():
                timetable = table
                break
    if not timetable:
        return []
    tbody = timetable.find("tbody") or timetable
    rows = tbody.find_all("tr", recursive=False)
    courses = []
    for row in rows[2:]:
        cells = row.find_all(["td", "th"], recursive=False)
        if not cells:
            continue
        day = day_map.get(cells[0].get_text(strip=True).lower())
        if not day:
            continue
        for cell in cells[1:]:
            ct = cell.get_text(strip=True)
            if not ct or ct in (" ", "\xa0"):
                continue
            for entry_html in re.split(r"={5,}", str(cell)):
                es = BeautifulSoup(entry_html, "html.parser")
                b = es.find("b")
                if not b:
                    continue
                hdr = b.get_text(strip=True)
                hm = re.match(
                    r"(\d{8})(?:[-\s]\d+)?\s*(?:หมู่|Section|Sec\.?)\s*(\S+)",
                    hdr, re.IGNORECASE
                ) or re.match(r"(\d{8})", hdr)
                if not hm:
                    continue
                code = hm.group(1)
                sec  = hm.group(2).strip() if len(hm.groups()) >= 2 else "1"
                start_t = end_t = room = name = instructor = ""
                credit = 0
                for ln in es.get_text("\n", strip=True).splitlines():
                    ln = ln.strip()
                    if not ln or ln == hdr or re.match(r"=+$", ln):
                        continue
                    tm = re.match(
                        r"([\d.]+)\s*[-–]\s*([\d.]+)\s*น\.?\s*(?:ห้อง\s*(\S+))?", ln
                    )
                    if tm and not start_t:
                        start_t = to_hhmm(tm.group(1))
                        end_t   = to_hhmm(tm.group(2))
                        room    = (tm.group(3) or "").strip()
                        continue
                    if ln.startswith("อ.") and not instructor:
                        instructor = ln[2:].strip(); continue
                    if not name and len(ln) > 2 and not re.match(r"^\d", ln):
                        # เก็บ credit จาก suffix "(N)" ก่อน strip
                        cm = re.search(r"\((\d+)\)\s*$", ln)
                        if cm and 1 <= int(cm.group(1)) <= 15:
                            credit = int(cm.group(1))
                        name = re.sub(r"\s*\(\d+\)\s*$", "", ln).strip()
                if not start_t:
                    continue
                # เดา lec/lab จาก sec number
                sec_clean = re.sub(r"\(.*\)", "", sec).strip()
                is_lab = sec_clean.isdigit() and int(sec_clean) >= 100
                entry = {
                    "code": code, "name": name, "sec": sec,
                    "day": "" if is_lab else day,
                    "start": "" if is_lab else start_t,
                    "end": "" if is_lab else end_t,
                    "room": "" if is_lab else room,
                    "lab_day": day if is_lab else "",
                    "lab_start": start_t if is_lab else "",
                    "lab_end": end_t if is_lab else "",
                    "lab_room": room if is_lab else "",
                    "instructor": instructor,
                    "credit": credit, "semester": sem_label, "year": "",
                    "major_label": "", "major_value": "", "branches": [],
                    "seats_total": -1, "seats_enrolled": -1,
                }
                courses.append(entry)
    return courses


def scrape_major_year(driver, wait, major_value, major_label, std_year, acad_year=None, sem="1"):
    """
    Scrape FM page for one major × year combination.
    Returns list of course dicts.

    KU เปลี่ยน form schema (พ.ย. 2025):
      - year: <input type=number name=year>  (เคย acadyear)
      - sem:  <select name=sem>  (เคย semester)
      - major_id: <select name=major_id> (เหมือนเดิม)
      - std_year: <input type=number name=std_year>  (เคย select)
      - flag_status: <input type=radio name=flag_status>  R/E
      - submit: <input name=btnMajor>  (เคย Submit)
    """
    try:
        driver.get(URL_FM)
        time.sleep(2)

        # 1) ปีการศึกษา (year text input)
        if acad_year:
            try:
                yel = driver.find_element(By.NAME, "year")
                yel.clear()
                yel.send_keys(str(acad_year))
            except Exception:
                pass
        # 2) ภาค (sem select)
        try:
            Select(driver.find_element(By.NAME, "sem")).select_by_value(sem)
        except Exception:
            pass
        # 3) major_id (select)
        sel = Select(wait.until(EC.presence_of_element_located((By.NAME, "major_id"))))
        sel.select_by_value(major_value)
        time.sleep(0.5)
        # 4) std_year — เป็น text input ตอนนี้ (เคย select)
        try:
            ynel = driver.find_element(By.NAME, "std_year")
            ynel.clear()
            ynel.send_keys(str(std_year))
        except Exception:
            pass
        # 5) flag_status R (ป.ตรี ปกติ) — radio button
        try:
            radio = driver.find_element(By.CSS_SELECTOR, "input[name='flag_status'][value='R']")
            if not radio.is_selected():
                radio.click()
        except Exception:
            pass
        time.sleep(0.3)
        # Submit — เปลี่ยนเป็น btnMajor
        for s in ["input[name='btnMajor']", "input[type='submit']", "button[type='submit']"]:
            try:
                driver.find_element(By.CSS_SELECTOR, s).click()
                break
            except Exception:
                pass
        time.sleep(3)

        page_html = driver.page_source
        soup = BeautifulSoup(page_html, "html.parser")
        n_rows = len(soup.find_all("tr"))
        print(f"    {major_label} yr{std_year} ({acad_year}/{sem}): rows={n_rows}", end="")

        if n_rows <= 4:
            print(" [skip]")
            return []

        sem_label = f"FM/{major_label}/{std_year}/{acad_year}/{sem}"
        # FM page เป็น day×time grid (ไม่ใช่ list table) ใช้ parser แยก
        courses   = parse_fm_timetable_html(page_html, sem_label)
        clean_mv  = re.sub(r"_[BMD]$", "", major_value)   # strip _B suffix
        for c in courses:
            c["major_label"] = major_label
            c["major_value"] = clean_mv
            c["year"]        = std_year

        print(f" → {len(courses)} sections")
        return courses

    except Exception as e:
        print(f" ERROR: {e}")
        traceback.print_exc()
        return []


# ── Publish helper ────────────────────────────────────────────────────────────

def publish_staging():
    """
    Copy staging → live after a quick sanity check.
    Called automatically by run() if checks pass,
    or manually via  python bot.py --publish
    """
    import shutil, json as _json

    if not os.path.exists(OUTPUT_STAGING):
        print(f"[publish] ERROR: staging file not found: {OUTPUT_STAGING}")
        return False

    try:
        data = _json.loads(open(OUTPUT_STAGING, encoding="utf-8").read())
    except Exception as e:
        print(f"[publish] ERROR: staging file invalid JSON: {e}")
        return False

    courses = data.get("courses", [])
    semesters = data.get("semesters", [])
    issues = []
    if len(courses) == 0:
        issues.append("no courses")
    if len(semesters) == 0:
        issues.append("no semesters")
    if issues:
        print(f"[publish] BLOCKED — {', '.join(issues)}. Fix staging file first.")
        return False

    os.makedirs("public", exist_ok=True)
    shutil.copy2(OUTPUT_STAGING, OUTPUT_LIVE)
    print(f"[publish] ✓ {OUTPUT_STAGING} → {OUTPUT_LIVE}  (courses={len(courses)}, semesters={len(semesters)})")
    return True


# ── Main runner ───────────────────────────────────────────────────────────────

def run(mode="main"):
    """
    mode="main"  → scrape index.php (all courses, all majors, with lab+seats)
    mode="fm"    → scrape index.php?flag=FM (per-major/year, no lab/seats) [fallback]
    mode="both"  → scrape main page first, then FM page, merge by code+sec
    """
    opts = webdriver.ChromeOptions()
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--ignore-certificate-errors")
    opts.add_argument("--ignore-ssl-errors")
    opts.set_capability("acceptInsecureCerts", True)

    # Anti-detection: hide Selenium/automation fingerprint
    opts.add_argument("--disable-blink-features=AutomationControlled")
    opts.add_experimental_option("excludeSwitches", ["enable-automation"])
    opts.add_experimental_option("useAutomationExtension", False)
    opts.add_argument(
        "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )

    driver = webdriver.Chrome(
        service=Service(ChromeDriverManager().install()),
        options=opts,
    )
    # Patch navigator.webdriver = undefined so site JS can't detect headless
    driver.execute_cdp_cmd(
        "Page.addScriptToEvaluateOnNewDocument",
        {"source": "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"},
    )
    wait = WebDriverWait(driver, WAIT_SECS)

    try:
        all_courses = []
        semesters   = []

        # ── Mode: main page ──────────────────────────────────────────────────
        if mode in ("main", "both"):
            print("[MODE] scraping main page (all courses)")
            courses, sems = scrape_main_page(driver, wait)
            all_courses.extend(courses)
            semesters.extend(sems)
            print(f"  main page total: {len(courses)} courses")

        # ── Mode: FM page (supplement / fallback) ────────────────────────────
        if mode in ("fm", "both") or (mode == "main" and not all_courses):
            if mode == "main" and not all_courses:
                print("[WARN] main page returned 0 courses, falling back to FM mode")
            else:
                print("[MODE] scraping FM page (per-major/year)")

            latest_year = get_latest_year()
            year_strs   = [str(y) for y in range(YEAR_START, latest_year + 1)]
            # ปีการศึกษา (acad_year) — ลองจาก current Thai year ย้อนกลับไป 2566
            current_thai = datetime.now().year + 543
            acad_years = [str(y) for y in range(current_thai, 2565, -1)]
            # ภาคการศึกษา — เอา ต้น เป็นหลัก (1) ก็พอ (FM page = "currently registering")
            sem_strs = ["1"]   # หรือ ["1", "2", "0"] ถ้าอยากครบแต่ ช้ามาก

            driver.get(URL_FM)
            time.sleep(3)
            sel_el = wait.until(EC.presence_of_element_located((By.NAME, "major_id")))
            all_opts  = [
                (o.get_attribute("value"), o.text.strip())
                for o in sel_el.find_elements(By.TAG_NAME, "option")
            ]
            major_opts = [(v, t) for v, t in all_opts if v and v.endswith("_B")]
            print(f"  majors: {len(major_opts)}, acad_years: {acad_years}, sems: {sem_strs}")

            fm_courses = []
            for acad_year in acad_years:
                for sem in sem_strs:
                    for std_year in year_strs:
                        print(f"\n--- acad={acad_year}/{sem} std_year={std_year} ---")
                        for mv, ml in major_opts:
                            courses = scrape_major_year(driver, wait, mv, ml, std_year, acad_year, sem)
                            fm_courses.extend(courses)
                            time.sleep(0.5)

            # Build FM lookup as dict[course_key] → list[fm_entry] (multi-major support)
            fm_multi = defaultdict(list)
            for c in fm_courses:
                fm_multi[f"{c['code']}_{c['sec']}"].append(c)

            if mode == "fm":
                # ใน mode fm — สร้าง 1 entry ต่อ course key + รวม (major,year) tuples
                deduped = []
                for key, group in fm_multi.items():
                    c = dict(group[0])    # copy
                    tuples = set(c.get("branches", []))
                    for g in group:
                        mv, yr = g.get("major_value", ""), g.get("year", "")
                        if mv and yr:
                            tuples.add(f"{mv}-{yr}")
                    c["branches"] = sorted(tuples)
                    c["major_value"] = ""   # ให้ frontend ดึงจาก branches เอง
                    c["major_label"] = ""
                    deduped.append(c)
                all_courses = deduped
            else:
                # mode="both" — FM tuples เป็น authoritative (KU แสดงจริง ๆ ตรง major-year ไหน)
                # main เก็บไว้แค่ lab+seats+credit ที่ FM ไม่มี
                main_keys = set()
                for c in all_courses:
                    key = f"{c['code']}_{c['sec']}"
                    main_keys.add(key)
                    if key in fm_multi:
                        # ใช้ FM tuples แทน main branches (กำจัด wildcards B-0 ที่ over-include)
                        fm_tuples = set()
                        for g in fm_multi[key]:
                            mv, yr = g.get("major_value", ""), g.get("year", "")
                            if mv and yr:
                                fm_tuples.add(f"{mv}-{yr}")
                        if fm_tuples:
                            c["branches"] = sorted(fm_tuples)
                        # เติมข้อมูลที่ขาด
                        fm = fm_multi[key][0]
                        if not c["start"] and fm["start"]:
                            c["start"] = fm["start"]
                            c["end"]   = fm["end"]
                        if (not c["instructor"] or c["instructor"] == "-") and fm.get("instructor"):
                            c["instructor"] = fm["instructor"]
                # courses ที่อยู่ใน FM แต่ไม่อยู่ใน main → เพิ่มเข้า all_courses
                for key, group in fm_multi.items():
                    if key in main_keys:
                        continue
                    c = dict(group[0])
                    tuples = set(c.get("branches", []))
                    for g in group:
                        mv, yr = g.get("major_value", ""), g.get("year", "")
                        if mv and yr:
                            tuples.add(f"{mv}-{yr}")
                    c["branches"] = sorted(tuples)
                    c["major_value"] = ""
                    c["major_label"] = ""
                    all_courses.append(c)

        # ── Save output ──────────────────────────────────────────────────────
        os.makedirs("public", exist_ok=True)

        # ── Fetch FM dropdown for full major name mapping (always) ──
        # mapping code → ชื่อไทยเต็ม (ใช้สร้าง majors list + เติม major_label)
        fm_major_map = {}    # {"A5201": "เทคโนโลยีและการจัดการสิ่งแวดล้อม"}
        try:
            print("\n[FETCH] FM major dropdown (for full names)")
            driver.get(URL_FM)
            time.sleep(2)
            sel_el = wait.until(EC.presence_of_element_located((By.NAME, "major_id")))
            for o in sel_el.find_elements(By.TAG_NAME, "option"):
                v = o.get_attribute("value")
                t = o.text.strip()
                if v and v.endswith("_B") and t:
                    fm_major_map[v[:-2]] = t   # strip "_B"
            print(f"  → got {len(fm_major_map)} major names")
        except Exception as e:
            print(f"  WARN: failed to fetch FM majors: {e}")

        # Enrich each course's major_value/major_label จาก branches[0]
        for c in all_courses:
            if c.get("major_label") and c.get("major_value"):
                continue  # already has (จาก FM scrape ใน mode both/fm)
            brs = c.get("branches", [])
            if not brs:
                continue
            m = re.match(r"([A-Z]\d+)", str(brs[0]))
            if not m:
                continue
            code = m.group(1)
            if not c.get("major_value"):
                c["major_value"] = code
            if not c.get("major_label"):
                c["major_label"] = fm_major_map.get(code, code)

        # Build majors list — เอาเฉพาะที่มีวิชาจริง + ใช้ชื่อเต็มถ้ามี
        used = {}   # code → label
        for c in all_courses:
            v = c.get("major_value", "")
            l = c.get("major_label", "")
            if v and v not in used:
                used[v] = l or fm_major_map.get(v, v)
        majors = sorted(
            [{"value": v, "label": l} for v, l in used.items()],
            key=lambda m: m["label"]
        )

        output = {
            "courses":    all_courses,
            "majors":     majors,
            "semesters":  semesters,
            "total":      len(all_courses),
            "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "mode":       mode,
        }
        # ── Write to staging first ───────────────────────────────────────────
        os.makedirs("data", exist_ok=True)
        with open(OUTPUT_STAGING, "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, indent=2)

        valid   = [c for c in all_courses if c["start"]]
        has_lab = [c for c in all_courses if c.get("lab_start")]
        has_cr  = [c for c in all_courses if c.get("credit", 0) != 3]
        print(f"\nSTAGING saved → {OUTPUT_STAGING}")
        print(f"  total={len(all_courses)}  has_time={len(valid)}  has_lab={len(has_lab)}  non-default-credit={len(has_cr)}")
        for c in all_courses[:3]:
            print(" ", json.dumps(c, ensure_ascii=False))

        # ── Sanity check before publishing ──────────────────────────────────
        issues = []
        if len(all_courses) == 0:
            issues.append("no courses scraped")
        if len(valid) < len(all_courses) * 0.5:
            issues.append(f"too many courses missing time ({len(valid)}/{len(all_courses)})")
        if len(output.get("semesters", [])) == 0:
            issues.append("no semesters found")

        if issues:
            print(f"\n[WARN] Staging NOT published — failed checks: {', '.join(issues)}")
            print(f"       Review {OUTPUT_STAGING} manually, then run --publish to deploy.")
        else:
            publish_staging()

    except Exception:
        traceback.print_exc()
        driver.save_screenshot("debug_error.png")
    finally:
        driver.quit()
        print("[DONE]")


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="KU Timetable Scraper")
    parser.add_argument(
        "--mode", choices=["main", "fm", "both"], default="main",
        help="main=index.php (all courses), fm=FM page (per-major), both=merge"
    )
    parser.add_argument("--test",    action="store_true", help="run self-test only, no browser")
    parser.add_argument("--publish", action="store_true", help="publish staging → live without re-scraping")
    args = parser.parse_args()

    try:
        import bs4
    except ImportError:
        print("pip install beautifulsoup4 selenium webdriver-manager")
        exit(1)

    # ── Self-test ────────────────────────────────────────────────────────────
    print("=== self-test ===")
    all_pass = True

    time_tests = [
        ("9.3-12.3",    ("09:30", "12:30")),
        ("09:30-12:30", ("09:30", "12:30")),
        ("800-1200",    ("08:00", "12:00")),
        ("1330-1630",   ("13:30", "16:30")),
        ("8-11",        ("08:00", "11:00")),
    ]
    for inp, exp in time_tests:
        got = parse_time_range(inp)
        ok = got == exp
        if not ok: all_pass = False
        print(f"  {'OK' if ok else 'FAIL'} time({inp!r}) -> {got}")

    credit_tests = [("3 (3-0)", 3), ("1 (0-3-0)", 1), ("3(2-2-5)", 3), ("2", 2)]
    for inp, exp in credit_tests:
        got = extract_credit(inp)
        ok = got == exp
        if not ok: all_pass = False
        print(f"  {'OK' if ok else 'FAIL'} credit({inp!r}) -> {got}")

    seat_tests = [
        ("30/25",    (30, 25)),
        ("30(25)",   (30, 25)),
        ("30  25",   (30, 25)),
        ("40",       (40, -1)),
        ("รับ30 นั่ง25", (30, 25)),
    ]
    for inp, exp in seat_tests:
        got = parse_seats(inp)
        ok = got == exp
        if not ok: all_pass = False
        print(f"  {'OK' if ok else 'FAIL'} seats({inp!r}) -> {got}")

    # Rowspan test (main-page structure)
    # ── Main page parser test (real 15-col structure) ───────────────────────
    # Header row 1: ที่(rs2)|รหัสวิชา(rs2)|ชื่อวิชา(rs2)|หน่วยกิต(rs2)|บรรยาย(cs3)|สาขา(rs2)|จำนวน(rs2)|ปฏิบัติ(cs3)|สาขา(rs2)|จำนวน(rs2)|อาจารย์(rs2)
    # Header row 2: หมู่|วัน-เวลา|ห้อง | | | หมู่|วัน-เวลา|ห้อง
    # Data row 1a: course 01355101 sec1, branch EE-1
    # Data row 1b: course 01355101 sec1, branch EE-2 (rowspan sub-row)
    # Data row 2:  course 01355102 sec1, branch EE-1
    test_html_main = (
        "<table>"
        "<tr>"
        "<th rowspan='2'>ที่</th>"
        "<th rowspan='2'>รหัสวิชา</th>"
        "<th rowspan='2'>ชื่อวิชา</th>"
        "<th rowspan='2'>หน่วยกิต</th>"
        "<th colspan='3'>บรรยาย</th>"
        "<th rowspan='2'>สาขา-ชั้นปี</th>"
        "<th rowspan='2'>จำนวน(คน)</th>"
        "<th colspan='3'>ปฏิบัติ</th>"
        "<th rowspan='2'>สาขา-ชั้นปี</th>"
        "<th rowspan='2'>จำนวน(คน)</th>"
        "<th rowspan='2'>อาจารย์</th>"
        "</tr>"
        "<tr>"
        "<th>หมู่</th><th>วัน-เวลา</th><th>ห้อง</th>"
        "<th>หมู่</th><th>วัน-เวลา</th><th>ห้อง</th>"
        "</tr>"
        # course 01355101-67, sec 1, branch EE-1
        "<tr>"
        "<td rowspan='2'>1</td>"
        "<td rowspan='2'>01355101-67</td>"
        "<td rowspan='2'>วิศวกรรมไฟฟ้า</td>"
        "<td rowspan='2'>3(3-0-6)</td>"
        "<td rowspan='2'>1</td>"
        "<td rowspan='2'>จ.09.00-12.00</td>"
        "<td rowspan='2'>A101</td>"
        "<td>EE-1</td>"
        "<td>30/20</td>"
        "<td rowspan='2'>1</td>"
        "<td rowspan='2'>พ.13.00-16.00</td>"
        "<td rowspan='2'>L201</td>"
        "<td></td><td></td>"
        "<td rowspan='2'>อ.สมชาย</td>"
        "</tr>"
        # sub-row: branch EE-2
        "<tr>"
        "<td>EE-2</td><td>25/10</td>"
        "<td></td><td></td>"
        "</tr>"
        # course 01355102-67, sec 1, branch EE-1
        "<tr>"
        "<td>2</td>"
        "<td>01355102-67</td>"
        "<td>วงจรไฟฟ้า</td>"
        "<td>2(2-0-4)</td>"
        "<td>1</td>"
        "<td>จ.13.00-15.00</td>"
        "<td>A102</td>"
        "<td>EE-1</td>"
        "<td>25/15</td>"
        "<td></td><td></td><td></td>"
        "<td></td><td></td>"
        "<td>อ.สมหญิง</td>"
        "</tr>"
        "</table>"
    )
    r = parse_main_html(test_html_main, "2567/1")
    main_checks = {
        "codes":     sorted([c["code"] for c in r]) == ["01355101", "01355102"],
        "sec":       any(c["sec"] == "1" for c in r),
        "lab_time":  any(c.get("lab_start") == "13:00" for c in r),
        "branches":  any(len(c.get("branches", [])) == 2 for c in r),
    }
    for name, chk in main_checks.items():
        if not chk: all_pass = False
        print(f"  {'OK' if chk else 'FAIL'} main_parse/{name}")
    if r:
        for c in r:
            lec   = f"{c['day']} {c['start']}-{c['end']} {c['room']}"
            lab   = f"{c['lab_day']} {c['lab_start']}-{c['lab_end']} {c['lab_room']}"
            seats = str(c['seats_total']) + '/' + str(c['seats_enrolled'])
            print(f"    {c['code']} s{c['sec']} lec={lec} lab={lab} seats={seats} br={c['branches']}")

    print(f"\n{'ALL PASSED' if all_pass else 'SOME FAILED'}")
    if not all_pass:
        exit(1)

    if args.test:
        exit(0)   # --test: stop here, don't open browser

    if args.publish:
        ok = publish_staging()
        exit(0 if ok else 1)

    # ── Run scraper ──────────────────────────────────────────────────────────
    run(mode=args.mode)

