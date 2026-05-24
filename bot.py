"""
bot_debug.py — ตรวจสอบโครงสร้างหน้าเว็บก่อน scrape จริง
รัน: python bot_debug.py
"""

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import Select, WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager
import time, json

URL         = "https://misreg.csc.ku.ac.th/misreg/schedule_v2/index.php?flag=FM"
MAJOR_VALUE = "B5602_B"
WAIT_SECS   = 30

def run():
    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()))
    wait   = WebDriverWait(driver, WAIT_SECS)

    print("[1] เปิดหน้าเว็บ...")
    driver.get(URL)
    time.sleep(3)

    # ── ดู options ทั้งหมดใน major_id ──────────────
    print("\n[2] Options ใน select[name=major_id]:")
    try:
        sel_el = driver.find_element(By.NAME, "major_id")
        opts = sel_el.find_elements(By.TAG_NAME, "option")
        for o in opts[:20]:
            print(f"  value={repr(o.get_attribute('value'))}  text={repr(o.text.strip())}")
        print(f"  ... ทั้งหมด {len(opts)} options")
    except Exception as e:
        print(f"  ❌ ไม่พบ: {e}")

    # ── ดู input fields ทั้งหมด ──────────────────────
    print("\n[3] Input fields ทั้งหมด:")
    for inp in driver.find_elements(By.TAG_NAME, "input"):
        print(f"  name={repr(inp.get_attribute('name'))}  "
              f"type={repr(inp.get_attribute('type'))}  "
              f"value={repr(inp.get_attribute('value'))}")

    # ── เลือกสาขา + กรอกปี ──────────────────────────
    print(f"\n[4] เลือกสาขา value='{MAJOR_VALUE}'")
    Select(driver.find_element(By.NAME, "major_id")).select_by_value(MAJOR_VALUE)

    # ลอง std_year ทุก format ที่เป็นไปได้
    for yr in ["68", "2568", "65", "2565", "66", "67"]:
        try:
            inp = driver.find_element(By.NAME, "std_year")
            inp.clear()
            inp.send_keys(yr)
            print(f"  → ลอง std_year = {yr}")
            break
        except:
            pass

    driver.save_screenshot("debug_before_submit.png")

    # ── Submit ──────────────────────────────────────
    print("\n[5] Submit...")
    for xp in ["//input[@name='btnMajor']","//input[@type='submit']","//button[@type='submit']"]:
        btns = driver.find_elements(By.XPATH, xp)
        if btns:
            btns[0].click()
            print(f"  ✓ คลิก {xp}")
            break

    time.sleep(5)
    driver.save_screenshot("debug_after_submit.png")

    # ── ดู DOM หลัง submit ──────────────────────────
    print("\n[6] ตรวจ DOM หลัง submit:")
    print(f"  URL ปัจจุบัน: {driver.current_url}")

    # หา element ที่น่าจะมีตารางเรียน
    candidates = driver.execute_script("""
        var results = [];
        var all = document.querySelectorAll('div,table,tbody,section');
        all.forEach(function(el) {
            var t = (el.innerText||'').trim();
            if (t.length > 200) {
                results.push({
                    tag: el.tagName,
                    id: el.id || '',
                    cls: el.className ? el.className.toString().slice(0,50) : '',
                    len: t.length,
                    preview: t.slice(0, 80)
                });
            }
        });
        // เรียงตาม length มากสุดก่อน
        results.sort(function(a,b){ return b.len - a.len; });
        return results.slice(0, 10);
    """)
    for c in candidates:
        print(f"  <{c['tag']}> id={repr(c['id'])} class={repr(c['cls'])} "
              f"len={c['len']}  preview={repr(c['preview'])}")

    # ── ตรวจ myBox โดยตรง ───────────────────────────
    mybox = driver.execute_script(
        "var b=document.getElementById('myBox'); return b ? b.innerHTML : 'NOT FOUND';"
    )
    print(f"\n[7] myBox innerHTML ({len(mybox)} chars): {mybox[:200]}")

    # ── บันทึก page source ──────────────────────────
    with open("debug_page_after.html", "w", encoding="utf-8") as f:
        f.write(driver.page_source)
    print("\n  ✓ บันทึก debug_page_after.html")
    print("  เปิดไฟล์นั้นใน browser แล้วกด Ctrl+F หา 'table' หรือรหัสวิชา")

    input("\nกด Enter ปิด browser...")
    driver.quit()

if __name__ == "__main__":
    run()