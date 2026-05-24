"""
bot.py — KU Timetable Scraper
เว็บใช้ JavaScript showTimetable() render ตาราง
ต้องรอ div#myBox มีข้อมูลก่อน parse

รัน: python bot.py
"""

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import Select, WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException
from webdriver_manager.chrome import ChromeDriverManager
import time, json, re, os, traceback
from bs4 import BeautifulSoup

# ──────────────────────────────────────────────
#  CONFIG
# ──────────────────────────────────────────────
URL         = "https://misreg.csc.ku.ac.th/misreg/schedule_v2/index.php?flag=FM"
MAJOR_TEXT  = "วิศวกรรมไฟฟ้า (B5602) -ป.ตรี"
OUTPUT_PATH = "public/all_timetables.json"
WAIT        = 20

DAY_MAP = {
    "จ":"MON","อ":"TUE","พ":"WED","พฤ":"THU","ศ":"FRI","ส":"SAT","อา":"SUN",
    "MON":"MON","TUE":"TUE","WED":"WED","THU":"THU",
    "FRI":"FRI","SAT":"SAT","SUN":"SUN",
    "MONDAY":"MON","TUESDAY":"TUE","WEDNESDAY":"WED",
    "THURSDAY":"THU","FRIDAY":"FRI","SATURDAY":"SAT","SUNDAY":"SUN",
}

def to_hhmm(raw):
    s = str(raw).strip()
    if "." in s:   h, m = s.split(".", 1)
    elif ":" in s: h, m = s.split(":", 1)
    else: return s
    try: return f"{int(h):02d}:{int(m):02d}"
    except: return s

def parse_time_range(text):
    m = re.search(r"(\d{1,2}[.:]\d{2})\s*[-–]\s*(\d{1,2}[.:]\d{2})", str(text))
    return (to_hhmm(m.group(1)), to_hhmm(m.group(2))) if m else (None, None)

def map_day(token):
    t = str(token).strip()
    return DAY_MAP.get(t.upper(), DAY_MAP.get(t, ""))

# ──────────────────────────────────────────────
#  PARSE div#myBox  (ตารางหลักหลัง JS โหลด)
# ──────────────────────────────────────────────
def parse_mybox(html_content):
    """
    รับ innerHTML ของ div#myBox แล้ว parse ตาราง
    
    โครงสร้างที่คาด (จาก DevTools):
    <table border="1" style="width:100%;font-size:0.8em;">
      <tr>  ← header row: วัน / เวลา / ...
      <tr>  ← แต่ละแถวคือวิชา
        <td>รหัส</td>
        <td>ชื่อวิชา</td>
        <td>หมู่</td>
        <td>วัน เวลา</td>  หรือแยกคอลัมน์
        <td>ห้อง</td>
        <td>นก.</td>
        <td>อาจารย์</td>
    """
    results = []
    seen    = set()
    soup    = BeautifulSoup(html_content, "html.parser")

    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        if len(rows) < 2:
            continue

        # ── detect column mapping ─────────────────────
        col = {}
        header_cells = rows[0].find_all(["th", "td"])
        headers = [c.get_text(strip=True).lower() for c in header_cells]
        print(f"  headers: {headers}")

        ALIAS = {
            "code":       ["รหัส","code","subject_code","รหัสวิชา"],
            "name":       ["ชื่อวิชา","name","subject","วิชา"],
            "sec":        ["หมู่","sec","section","กลุ่ม"],
            "day":        ["วัน","day"],
            "time":       ["เวลา","time","ช่วงเวลา"],
            "day_time":   ["วันเวลา","วัน/เวลา","day/time","day_time"],
            "credit":     ["หน่วยกิต","credit","unit","นก","นก."],
            "instructor": ["อาจารย์","instructor","teacher","ผู้สอน"],
            "room":       ["ห้อง","room","ห้องเรียน"],
        }
        for field, aliases in ALIAS.items():
            for i, h in enumerate(headers):
                if any(a == h or a in h for a in aliases):
                    col[field] = i
                    break

        # ถ้าไม่มี header ที่รู้จัก ลอง guess จากตำแหน่ง
        # pattern ทั่วไปของ KU: รหัส|ชื่อ|หมู่|วัน|เวลา|ห้อง|นก.|อาจารย์
        if "code" not in col and len(headers) >= 4:
            col = {"code":0, "name":1, "sec":2, "day_time":3}
            if len(headers) >= 6: col["credit"] = 5
            if len(headers) >= 7: col["instructor"] = 6
            if len(headers) >= 5: col["room"] = 4
            print(f"  [WARN] ไม่มี header ที่รู้จัก — guess col map: {col}")

        if "code" not in col:
            continue

        print(f"  col map: {col}")

        # ── parse each data row ───────────────────────
        for row in rows[1:]:
            cells = row.find_all(["td","th"])
            if not cells:
                continue

            def get(f, default=""):
                i = col.get(f)
                return cells[i].get_text(strip=True) if i is not None and i < len(cells) else default

            raw_code = get("code","")
            code_m   = re.search(r"(\d{7,8})", raw_code)
            if not code_m:
                continue
            code = code_m.group(1)

            name = get("name","")
            sec  = re.sub(r"\D","", get("sec","1")) or "1"

            # วัน + เวลา
            day   = ""
            start = ""
            end   = ""

            if "day_time" in col:
                dt    = get("day_time","")
                day   = map_day(dt.split()[0]) if dt else ""
                start, end = parse_time_range(dt)

            if not day and "day" in col:
                day = map_day(get("day",""))

            if not start and "time" in col:
                start, end = parse_time_range(get("time",""))

            # credit
            credit_raw = get("credit","3")
            credit_m   = re.search(r"\d+", credit_raw)
            credit     = int(credit_m.group()) if credit_m else 3

            c = {
                "code": code, "name": name, "sec": sec,
                "day":  day,  "start": start or "", "end": end or "",
                "credit": credit,
                "instructor": get("instructor",""),
                "room": get("room",""),
            }

            key = f"{code}_{sec}"
            if key not in seen:
                seen.add(key)
                results.append(c)
                print(f"  ✓ {day or '?'} {code} sec{sec} {start}-{end} {name[:20]}")

    return results


# ──────────────────────────────────────────────
#  MAIN
# ──────────────────────────────────────────────
def run():
    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()))
    wait   = WebDriverWait(driver, WAIT)

    try:
        # 1. load page
        print(f"[1] เปิด {URL}")
        driver.get(URL)
        time.sleep(3)
        driver.save_screenshot("debug_01_loaded.png")

        # 2. เลือกสาขา — หา select ที่มี option ตรงกัน
        print("[2] หา dropdown สาขา...")
        target_select = None
        target_option = None

        for sel_el in driver.find_elements(By.TAG_NAME, "select"):
            for opt in sel_el.find_elements(By.TAG_NAME, "option"):
                t = opt.text.strip()
                if MAJOR_TEXT in t or ("B5602" in t) or ("วิศวกรรมไฟฟ้า" in t and "ป.ตรี" in t):
                    target_select = sel_el
                    target_option = t
                    break
            if target_select:
                break

        if target_select and target_option:
            Select(target_select).select_by_visible_text(target_option)
            print(f"  เลือก: {target_option}")
        else:
            print(f"  [WARN] ไม่พบ option '{MAJOR_TEXT}' — ลิสต์ทั้งหมด:")
            for sel_el in driver.find_elements(By.TAG_NAME, "select"):
                for opt in sel_el.find_elements(By.TAG_NAME, "option"):
                    print(f"    '{opt.text.strip()}'")

        time.sleep(1)

        # 3. กด submit
        print("[3] กด submit...")
        submitted = False
        for xp in ["//input[@type='submit']","//button[@type='submit']",
                   "//input[contains(@value,'ค้นหา')]","//button[contains(text(),'ค้นหา')]"]:
            btns = driver.find_elements(By.XPATH, xp)
            if btns:
                btns[0].click()
                submitted = True
                print(f"  กด: {xp}")
                break

        if not submitted:
            forms = driver.find_elements(By.TAG_NAME, "form")
            if forms:
                driver.execute_script("arguments[0].submit()", forms[0])
                submitted = True
                print("  submit form via JS")

        # 4. รอ div#myBox มีข้อมูล (JS showTimetable() ต้องรันเสร็จ)
        print("[4] รอ div#myBox โหลด...")
        try:
            wait.until(lambda d: len(
                d.execute_script(
                    "var b=document.getElementById('myBox'); return b?b.innerText:'';"
                ).strip()
            ) > 50)
            print("  myBox โหลดแล้ว ✓")
        except TimeoutException:
            print("  [WARN] หมดเวลา รอ myBox — ลอง parse ที่มีอยู่")

        time.sleep(2)
        driver.save_screenshot("debug_02_result.png")

        # 5. dump innerHTML ของ myBox
        mybox_html = driver.execute_script(
            "var b=document.getElementById('myBox'); return b?b.innerHTML:'';"
        )
        print(f"  myBox innerHTML length: {len(mybox_html)}")

        # บันทึก HTML ไว้ debug เสมอ
        with open("debug_mybox.html", "w", encoding="utf-8") as f:
            f.write(mybox_html)
        print("  บันทึก: debug_mybox.html")

        if len(mybox_html.strip()) < 50:
            # ลอง dump ทั้งหน้า
            full_html = driver.page_source
            with open("debug_page.html", "w", encoding="utf-8") as f:
                f.write(full_html)
            print("  [WARN] myBox ว่าง — บันทึก debug_page.html ด้วย")
            print("  ส่งไฟล์ debug_02_result.png มาให้ดูด้วยครับ")

        # 6. parse
        print("[5] Parse...")
        results = parse_mybox(mybox_html)

        # 7. save
        os.makedirs("public", exist_ok=True)
        with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)

        status = "✅" if results else "❌"
        print(f"\n{status} {len(results)} รายการ → {OUTPUT_PATH}")

        if not results:
            print("\n⚠ ดึงข้อมูลไม่ได้ — ดู debug_mybox.html และ debug_02_result.png")
            print("  แล้วส่งมาให้ดูครับ")

    except Exception:
        traceback.print_exc()
        try: driver.save_screenshot("debug_error.png")
        except: pass
    finally:
        input("\nกด Enter เพื่อปิด browser...")
        driver.quit()


if __name__ == "__main__":
    # ตรวจว่ามี beautifulsoup4 หรือยัง
    try:
        import bs4
    except ImportError:
        print("ติดตั้ง beautifulsoup4 ก่อน:")
        print("  pip install beautifulsoup4")
        exit(1)
    run()
