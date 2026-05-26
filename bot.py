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

def build_grid(rows):
    """Expand rowspan/colspan into a 2D list of text values."""
    rowspan_map = {}
    grid = []
    for row in rows:
        cells = row.find_all(["td", "th"])
        row_data = {}
        new_map = {}
        for c_idx, (rem, txt) in rowspan_map.items():
            row_data[c_idx] = txt
            if rem > 1:
                new_map[c_idx] = (rem - 1, txt)
        rowspan_map = new_map
        col_cursor = 0
        for cell in cells:
            while col_cursor in row_data:
                col_cursor += 1
            rs  = int(cell.get("rowspan", 1))
            cs  = int(cell.get("colspan", 1))
            txt = cell.get_text(" ", strip=True)
            for c in range(col_cursor, col_cursor + cs):
                row_data[c] = txt
                if rs > 1:
                    rowspan_map[c] = (rs - 1, txt)  # carry rs-1 MORE rows
            col_cursor += cs
        if row_data:
            max_c = max(row_data.keys())
            grid.append([row_data.get(i, "") for i in range(max_c + 1)])
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

    all_rows = target.find_all("tr")
    print(f"  [parse_main] total rows: {len(all_rows)}")

    col = detect_main_page_cols(all_rows)

    data_rows = [r for r in all_rows
                 if not all(c.name == "th" for c in r.find_all(["td","th"]))]
    grid = build_grid(data_rows)
    print(f"  [parse_main] data grid rows: {len(grid)}")

    def g(row, key):
        c = col[key]
        return row[c].strip() if c < len(row) else ""

    seen_key = None
    current  = None

    for row in grid:
        if len(row) <= col["code"]:
            continue
        code_raw = g(row, "code")
        m = re.match(r"(\d{8})(?:[- ]\d+)?", code_raw.replace(" ", ""))
        if not m:
            continue
        code = m.group(1)

        sec   = g(row, "lect_sec")
        ltime = g(row, "lect_daytime")
        key   = (code, sec, ltime)

        if key != seen_key:
            if current:
                results.append(current)

            lday, lstart, lend = parse_daytime(ltime)
            pday, pstart, pend = parse_daytime(g(row, "lab_daytime"))
            tot, enr = parse_seats(g(row, "lect_seats"))

            current = {
                "code":           code,
                "name":           g(row, "name"),
                "credit":         extract_credit(g(row, "credit")),
                "sec":            sec,
                "day":            lday   or "",
                "start":          lstart or "",
                "end":            lend   or "",
                "room":           clean_room(g(row, "lect_room")),
                "lab_day":        pday   or "",
                "lab_start":      pstart or "",
                "lab_end":        pend   or "",
                "lab_room":       clean_room(g(row, "lab_room")),
                "seats_total":    tot,
                "seats_enrolled": enr,
                "branches":       [],
                "instructor":     g(row, "instructor"),
                "semester":       semester_label,
                "year":           "",
                "major_label":    "",
                "major_value":    "",
            }
            seen_key = key

        for br in [g(row, "lect_branch"), g(row, "lab_branch")]:
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
    """
    print(f"  Navigating to {URL_MAIN}")
    driver.get(URL_MAIN)
    time.sleep(4)

    all_courses = []
    semesters   = []

    # Detect year/semester selectors
    try:
        year_sel  = Select(driver.find_element(By.NAME, "acadyear"))
        year_opts = [(o.get_attribute("value"), o.text.strip())
                     for o in year_sel.options if o.get_attribute("value")]
    except Exception:
        year_opts = []

    try:
        sem_sel  = Select(driver.find_element(By.NAME, "semester"))
        sem_opts = [(o.get_attribute("value"), o.text.strip())
                    for o in sem_sel.options if o.get_attribute("value")]
    except Exception:
        sem_opts = []

    print(f"  years={[y for y,_ in year_opts]}  sems={[s for s,_ in sem_opts]}")

    combos = [(yv, yt, sv, st)
              for yv, yt in (year_opts or [("", "")])
              for sv, st in (sem_opts  or [("", "")])]

    if not combos:
        combos = [("", "", "", "")]

    for yv, yt, sv, st in combos:
        sem_label = f"{yt}/{st}".strip("/").strip()
        print(f"  [scrape_main] {sem_label or 'current'}")
        try:
            if yv:
                Select(driver.find_element(By.NAME, "acadyear")).select_by_value(yv)
                time.sleep(1)
            if sv:
                Select(driver.find_element(By.NAME, "semester")).select_by_value(sv)
                time.sleep(1)
            # Submit
            for sel in ["input[type='submit']", "button[type='submit']", "input[name='Submit']"]:
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


def scrape_major_year(driver, wait, major_value, major_label, std_year):
    """
    Scrape FM page for one major × year combination.
    Returns list of course dicts.
    """
    try:
        driver.get(URL_FM)
        time.sleep(2)

        sel = Select(wait.until(EC.presence_of_element_located((By.NAME, "major_id"))))
        sel.select_by_value(major_value)
        time.sleep(1)

        try:
            Select(driver.find_element(By.NAME, "std_year")).select_by_value(std_year)
            time.sleep(1)
        except Exception:
            pass

        for s in ["input[type='submit']", "button[type='submit']", "input[name='Submit']"]:
            try:
                driver.find_element(By.CSS_SELECTOR, s).click()
                break
            except Exception:
                pass
        time.sleep(3)

        page_html = driver.page_source
        soup = BeautifulSoup(page_html, "html.parser")
        n_rows = len(soup.find_all("tr"))
        print(f"    {major_label} yr{std_year}: rows={n_rows}", end="")

        if n_rows <= 4:
            print(" [skip]")
            return []

        sem_label = f"FM/{major_label}/{std_year}"
        courses   = parse_main_html(page_html, sem_label)
        for c in courses:
            c["major_label"] = major_label
            c["major_value"] = major_value
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

            driver.get(URL_FM)
            time.sleep(3)
            sel_el = wait.until(EC.presence_of_element_located((By.NAME, "major_id")))
            all_opts  = [
                (o.get_attribute("value"), o.text.strip())
                for o in sel_el.find_elements(By.TAG_NAME, "option")
            ]
            major_opts = [(v, t) for v, t in all_opts if v and v.endswith("_B")]
            print(f"  majors: {len(major_opts)}")

            fm_courses = []
            for std_year in year_strs:
                print(f"\n--- year {std_year} ---")
                for mv, ml in major_opts:
                    courses = scrape_major_year(driver, wait, mv, ml, std_year)
                    fm_courses.extend(courses)
                    time.sleep(1)

            if mode == "fm":
                all_courses = fm_courses
            else:
                # mode="both": merge FM into main (FM has better instructor/time data per-section)
                fm_lookup = {f"{c['code']}_{c['sec']}": c for c in fm_courses}
                for c in all_courses:
                    key = f"{c['code']}_{c['sec']}"
                    if key in fm_lookup:
                        fm = fm_lookup[key]
                        # Fill missing fields from FM data
                        if not c["start"] and fm["start"]:
                            c["start"] = fm["start"]
                            c["end"]   = fm["end"]
                        if not c["instructor"] or c["instructor"] == "-":
                            c["instructor"] = fm["instructor"]
                        if not c["year"]:
                            c["year"] = fm["year"]
                        if not c["major_value"]:
                            c["major_value"] = fm["major_value"]
                        if not c["major_label"]:
                            c["major_label"] = fm["major_label"]
                all_courses.extend([c for k, c in fm_lookup.items()
                                     if not any(f"{x['code']}_{x['sec']}" == k for x in all_courses)])

        # ── Save output ──────────────────────────────────────────────────────
        os.makedirs("public", exist_ok=True)

        # Build majors list from unique branch/major_label values
        majors = []
        seen_labels = set()
        for c in all_courses:
            lbl = c.get("major_label", "")
            val = c.get("major_value", "")
            if lbl and lbl not in seen_labels:
                majors.append({"value": val or lbl, "label": lbl})
                seen_labels.add(lbl)

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
