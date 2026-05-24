import { useState, useMemo, useEffect, useRef, useCallback } from "react";

const MAX_CREDITS = 22;
const HOUR_START = 8;
const HOUR_END = 20;
const TOTAL_HOURS = HOUR_END - HOUR_START;
const LS_KEY = "timetable_selected_v1";

const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const DAY_LABELS = {
  SUN: "อาทิตย์", MON: "จันทร์", TUE: "อังคาร", WED: "พุธ",
  THU: "พฤหัสฯ", FRI: "ศุกร์", SAT: "เสาร์",
};
const DAY_SHORT = {
  SUN: "อา", MON: "จ", TUE: "อ", WED: "พ", THU: "พฤ", FRI: "ศ", SAT: "ส",
};

const P = {
  pageBg:        "#fdf2f8",
  cardBg:        "#ffffff",
  headerBg:      "#ffffff",
  border:        "#f5d0e8",
  borderMid:     "#e8a7cf",
  rowBg:         "#fdf7fb",
  gridLine:      "#f3d7ec",
  accent:        "#c2185b",
  accentLt:      "#fce4ec",
  accentMid:     "#e91e8c",
  textPrimary:   "#3b1f2b",
  textSecondary: "#9c6b83",
  textHint:      "#d4a8c0",
  warn:          "#fff8e1",
  warnBorder:    "#ffe082",
  warnText:      "#795548",
  sunBg:         "#fff0fb",
  satBg:         "#fef6ff",
  conflict:      "#ffebee",
  conflictBorder:"#e53935",
};

const PALETTE = [
  { bg: "#fce4ec", border: "#e91e8c", text: "#880e4f" },
  { bg: "#fce4f7", border: "#ab47bc", text: "#6a1b9a" },
  { bg: "#f3e5f5", border: "#7b1fa2", text: "#4a148c" },
  { bg: "#ffe0f0", border: "#f06292", text: "#880e4f" },
  { bg: "#ffeef8", border: "#ce93d8", text: "#6a1b9a" },
  { bg: "#fde0f2", border: "#d81b60", text: "#880e4f" },
  { bg: "#f8bbd0", border: "#c2185b", text: "#880e4f" },
  { bg: "#f9f0fb", border: "#9c27b0", text: "#4a148c" },
  { bg: "#fce8f3", border: "#ad1457", text: "#880e4f" },
  { bg: "#ede7f6", border: "#673ab7", text: "#311b92" },
  { bg: "#fff0f7", border: "#e040fb", text: "#6a1b9a" },
  { bg: "#fdeef8", border: "#ba68c8", text: "#6a1b9a" },
];

// ── helpers ──────────────────────────────────────────────
function parseTime(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h + (m || 0) / 60;
}
function hasConflict(a, b) {
  if (a.day !== b.day || !a.start || !b.start) return false;
  return parseTime(a.start) < parseTime(b.end) && parseTime(b.start) < parseTime(a.end);
}
function blockPos(course) {
  const s = parseTime(course.start), e = parseTime(course.end);
  if (!s || !e) return null;
  return {
    left: `${((s - HOUR_START) / TOTAL_HOURS) * 100}%`,
    width: `${((e - s) / TOTAL_HOURS) * 100}%`,
  };
}

// ── CreditBar ────────────────────────────────────────────
function CreditBar({ current, max }) {
  const pct = Math.min((current / max) * 100, 100);
  const over = current > max;
  const barColor = over ? "#e53935" : current >= max * 0.8 ? "#f06292" : P.accentMid;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: P.textSecondary, fontWeight: 500 }}>หน่วยกิตรวม</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: over ? "#e53935" : P.textPrimary }}>
          {current}<span style={{ fontWeight: 400, color: P.textHint }}>/{max}</span>
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 99, background: P.border, overflow: "hidden" }}>
        <div style={{
          height: "100%", borderRadius: 99, background: barColor, width: `${pct}%`,
          transition: "width .35s ease",
        }} />
      </div>
    </div>
  );
}

// ── Grid — ใส่ ref สำหรับ export, แสดง conflict แดง ────
function Grid({ selectedCourses, onRemove, gridRef, conflictIds }) {
  const slots = Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => HOUR_START + i);
  return (
    <div style={{ overflowX: "auto" }}>
      {/* grid ส่วนที่จะ capture เป็น PNG */}
      <div ref={gridRef} style={{ background: P.cardBg, padding: "6px 0" }}>
        {/* header ชั่วโมง */}
        <div style={{ display: "flex", paddingLeft: 72, marginBottom: 4 }}>
          {slots.map(h => (
            <div key={h} style={{
              width: `${100 / TOTAL_HOURS}%`, flexShrink: 0,
              fontSize: 10, color: P.textHint, textAlign: "center",
            }}>{String(h).padStart(2, "0")}:00</div>
          ))}
        </div>

        {DAYS.map(day => {
          const courses = selectedCourses.filter(c => c.day === day);
          const isSun = day === "SUN";
          const isSat = day === "SAT";
          const isWeekend = isSun || isSat;
          const rowBg = isSun ? P.sunBg : isSat ? P.satBg : P.rowBg;
          const borderColor = isSun ? "#f0b8dd" : isSat ? P.borderMid : P.border;
          return (
            <div key={day} style={{ display: "flex", alignItems: "center", marginBottom: 4, height: 38 }}>
              <div style={{
                width: 72, flexShrink: 0, fontSize: 11, textAlign: "right", paddingRight: 10,
                color: isSun ? "#c2185b" : isSat ? P.accentMid : P.textSecondary,
                fontWeight: isWeekend ? 700 : 400,
              }}>
                {DAY_LABELS[day]}
                {isSun && <span style={{ fontSize: 9, marginLeft: 3, color: P.accentMid }}>☀</span>}
              </div>
              <div style={{
                flex: 1, position: "relative", height: 30, borderRadius: 8,
                background: rowBg, border: `1px solid ${borderColor}`,
              }}>
                {Array.from({ length: TOTAL_HOURS - 1 }, (_, i) => (
                  <div key={i} style={{
                    position: "absolute", top: 0, height: "100%",
                    left: `${((i + 1) / TOTAL_HOURS) * 100}%`,
                    borderLeft: `1px solid ${P.gridLine}`,
                  }} />
                ))}
                {courses.map(c => {
                  const pos = blockPos(c);
                  if (!pos) return null;
                  const isConflicting = conflictIds.has(c.id);
                  const pal = PALETTE[c.colorIndex];
                  return (
                    <div
                      key={c.id}
                      onClick={() => onRemove(c)}
                      title={`${c.name} | หมู่ ${c.sec}${c.instructor !== "-" ? " | " + c.instructor : ""} | ${c.start}–${c.end}${isConflicting ? " ⚠ เวลาชนกัน" : ""}`}
                      style={{
                        position: "absolute", top: 3, bottom: 3,
                        left: pos.left, width: pos.width,
                        borderRadius: 5, padding: "0 6px",
                        // FIX 3: conflict = แดงแทน opacity
                        background: isConflicting ? P.conflict : pal.bg,
                        border: `1.5px solid ${isConflicting ? P.conflictBorder : pal.border}`,
                        color: isConflicting ? P.conflictBorder : pal.text,
                        fontSize: 10, fontWeight: 700,
                        display: "flex", alignItems: "center", overflow: "hidden",
                        cursor: "pointer", whiteSpace: "nowrap",
                        transition: "opacity .1s",
                      }}
                      onMouseEnter={e => e.currentTarget.style.opacity = "0.75"}
                      onMouseLeave={e => e.currentTarget.style.opacity = "1"}
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                        {isConflicting && <span style={{ marginRight: 3 }}>⚠</span>}
                        {c.code}<span style={{ opacity: 0.55, marginLeft: 3 }}>#{c.sec}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {selectedCourses.length === 0 && (
          <p style={{ textAlign: "center", fontSize: 11, color: P.textHint, padding: "4px 0 0" }}>
            เลือกวิชาจากรายการด้านขวาเพื่อแสดงในตาราง
          </p>
        )}
      </div>
    </div>
  );
}

// ── SelectedPanel ─────────────────────────────────────────
function SelectedPanel({ selectedCourses, onRemove, onClear, totalCredits, conflictIds }) {
  return (
    <div style={{
      background: P.cardBg, borderRadius: 16, border: `1px solid ${P.border}`,
      padding: 18, display: "flex", flexDirection: "column", gap: 14,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: P.textPrimary }}>วิชาที่เลือก</h2>
        {selectedCourses.length > 0 && (
          <button onClick={onClear} style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: 11, color: P.textHint, padding: 0,
          }}
            onMouseEnter={e => e.currentTarget.style.color = "#e53935"}
            onMouseLeave={e => e.currentTarget.style.color = P.textHint}
          >ล้างทั้งหมด</button>
        )}
      </div>

      <CreditBar current={totalCredits} max={MAX_CREDITS} />

      {/* FIX 3: แสดง conflict warning ใน panel */}
      {conflictIds.size > 0 && (
        <div style={{
          background: "#ffebee", border: "1px solid #e5393540", borderRadius: 8,
          padding: "7px 10px", fontSize: 11, color: "#b71c1c",
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <span>⚠</span>
          <span>มี {conflictIds.size} วิชาที่เวลาชนกัน — ดูได้จากกล่องสีแดงในตาราง</span>
        </div>
      )}

      {selectedCourses.length === 0 ? (
        <p style={{ fontSize: 12, color: P.textHint, textAlign: "center", padding: "16px 0", margin: 0 }}>
          กดเลือกวิชาจากรายการด้านล่าง
        </p>
      ) : (
        <div className="selected-panel-list" style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {selectedCourses.map(c => {
            const pal = PALETTE[c.colorIndex];
            const isConflicting = conflictIds.has(c.id);
            return (
              <div key={c.id} style={{
                borderRadius: 10, padding: "8px 10px",
                background: isConflicting ? P.conflict : pal.bg,
                border: `1px solid ${isConflicting ? P.conflictBorder + "60" : pal.border + "40"}`,
                display: "flex", alignItems: "flex-start", gap: 8,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
                    {isConflicting && <span style={{ fontSize: 11, color: P.conflictBorder }}>⚠</span>}
                    <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: isConflicting ? P.conflictBorder : pal.border }}>
                      {c.code}
                    </span>
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: "1px 5px", borderRadius: 3,
                      background: isConflicting ? P.conflictBorder + "20" : pal.border + "25",
                      color: isConflicting ? P.conflictBorder : pal.text,
                    }}>หมู่ {c.sec}</span>
                  </div>
                  <div style={{
                    fontSize: 12, fontWeight: 600, color: P.textPrimary,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 2,
                  }}>{c.name}</div>
                  <div style={{ fontSize: 10, color: P.textSecondary, display: "flex", gap: 5, flexWrap: "wrap" }}>
                    <span>{DAY_LABELS[c.day] ?? c.day} {c.start}–{c.end}</span>
                    {c.instructor !== "-" && <span>· {c.instructor}</span>}
                    <span>· {c.credit} หน่วย</span>
                  </div>
                </div>
                <button onClick={() => onRemove(c)} style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: P.textHint, fontSize: 14, lineHeight: 1, flexShrink: 0, padding: "1px 2px",
                }}
                  onMouseEnter={e => e.currentTarget.style.color = "#e53935"}
                  onMouseLeave={e => e.currentTarget.style.color = P.textHint}
                >✕</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── CourseCard ────────────────────────────────────────────
function CourseCard({ course, isSelected, isConflict, onToggle }) {
  const pal = PALETTE[course.colorIndex];
  return (
    <div
      onClick={() => !isConflict && onToggle(course)}
      style={{
        border: isSelected ? `1.5px solid ${pal.border}` : `1px solid ${P.border}`,
        borderRadius: 12, padding: "10px 12px",
        background: isSelected ? pal.bg : P.cardBg,
        cursor: isConflict ? "not-allowed" : "pointer",
        opacity: isConflict ? 0.32 : 1,
        transition: "border-color .1s, background .1s",
        userSelect: "none",
      }}
      onMouseEnter={e => { if (!isConflict && !isSelected) e.currentTarget.style.borderColor = P.borderMid; }}
      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.borderColor = P.border; }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 3 }}>
            <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: pal.border }}>
              {course.code}
            </span>
            <span style={{
              fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 4,
              background: isSelected ? pal.border : P.accentLt,
              color: isSelected ? "#fff" : P.accent,
            }}>หมู่ {course.sec}</span>
            {course.year && (
              <span style={{
                fontSize: 10, padding: "2px 5px", borderRadius: 4,
                background: P.border, color: P.textSecondary,
              }}>ปี {course.year}</span>
            )}
          </div>
          <div style={{
            fontSize: 13, fontWeight: 600, color: P.textPrimary,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 3,
          }}>{course.name}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {course.start && (
              <span style={{ fontSize: 11, color: P.textSecondary, display: "flex", alignItems: "center", gap: 3 }}>
                <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                  <circle cx={12} cy={12} r={10} /><polyline points="12 6 12 12 16 14" />
                </svg>
                {DAY_SHORT[course.day] ?? course.day} · {course.start}–{course.end}
              </span>
            )}
            {course.instructor && course.instructor !== "-" && (
              <span style={{ fontSize: 11, color: P.textHint, display: "flex", alignItems: "center", gap: 3 }}>
                <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx={12} cy={7} r={4} />
                </svg>
                {course.instructor}
              </span>
            )}
          </div>
          {course.majorLabel && (
            <div style={{ fontSize: 10, color: P.textHint, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {course.majorLabel}
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: P.textHint }}>{course.credit} หน่วย</span>
          <div style={{
            width: 16, height: 16, borderRadius: "50%", border: `2px solid ${pal.border}`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {isSelected && <div style={{ width: 8, height: 8, borderRadius: "50%", background: pal.border }} />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── SAMPLE DATA ───────────────────────────────────────────
const SAMPLE_DATA = {
  courses: [
    { code: "04252211", name: "Electric Circuit Analysis I", sec: "1", day: "MON", start: "09:30", end: "12:30", instructor: "อ.สมชาย", credit: 3, year: "68", major_value: "B5602_B", major_label: "วิศวกรรมไฟฟ้า (B5602) -ป.ตรี" },
    { code: "04252214", name: "Digital System Design", sec: "1", day: "MON", start: "13:30", end: "16:30", instructor: "อ.วิทยา", credit: 3, year: "68", major_value: "B5602_B", major_label: "วิศวกรรมไฟฟ้า (B5602) -ป.ตรี" },
    { code: "01355102", name: "English for University", sec: "9", day: "TUE", start: "13:30", end: "16:30", instructor: "อ.พิมพ์", credit: 3, year: "68", major_value: "B5602_B", major_label: "วิศวกรรมไฟฟ้า (B5602) -ป.ตรี" },
    { code: "04253201", name: "Basic Principles of Mechanics", sec: "1", day: "WED", start: "09:30", end: "12:30", instructor: "อ.ณัฐ", credit: 3, year: "68", major_value: "B5602_B", major_label: "วิศวกรรมไฟฟ้า (B5602) -ป.ตรี" },
    { code: "04252213", name: "Electric Circuit Lab", sec: "102", day: "THU", start: "13:30", end: "16:30", instructor: "อ.สมชาย", credit: 1, year: "68", major_value: "B5602_B", major_label: "วิศวกรรมไฟฟ้า (B5602) -ป.ตรี" },
    { code: "04252299", name: "Special Topics in EE", sec: "1", day: "SUN", start: "09:00", end: "12:00", instructor: "อ.ปิยวัฒน์", credit: 3, year: "68", major_value: "B5602_B", major_label: "วิศวกรรมไฟฟ้า (B5602) -ป.ตรี" },
    { code: "01132222", name: "Human Resource Management", sec: "1", day: "MON", start: "09:30", end: "12:30", instructor: "อ.นัฐนันท์", credit: 3, year: "68", major_value: "C5101_B", major_label: "การจัดการ (C5101) -ป.ตรี" },
    { code: "01101182", name: "Macroeconomics I", sec: "2", day: "MON", start: "13:30", end: "16:30", instructor: "อ.ฐิตาวรรณ", credit: 3, year: "68", major_value: "C5101_B", major_label: "การจัดการ (C5101) -ป.ตรี" },
    { code: "01132214", name: "Environment of Business", sec: "1", day: "WED", start: "13:30", end: "16:30", instructor: "อ.ธิดา", credit: 3, year: "68", major_value: "C5101_B", major_label: "การจัดการ (C5101) -ป.ตรี" },
    { code: "01455101", name: "Global Politics in Daily Life", sec: "2", day: "SUN", start: "13:00", end: "16:00", instructor: "อ.ประสงค์", credit: 3, year: "68", major_value: "C5101_B", major_label: "การจัดการ (C5101) -ป.ตรี" },
    { code: "01131211", name: "Business Finance", sec: "1", day: "THU", start: "13:30", end: "16:30", instructor: "อ.ชัยรัตน์", credit: 3, year: "68", major_value: "C5101_B", major_label: "การจัดการ (C5101) -ป.ตรี" },
    { code: "01418231", name: "Data Structures and Algorithms", sec: "1", day: "WED", start: "09:30", end: "12:30", instructor: "อ.ธีระ", credit: 3, year: "67", major_value: "B6001_B", major_label: "วิทยาการคอมพิวเตอร์ (B6001) -ป.ตรี" },
    { code: "01418233", name: "Computer Architecture", sec: "1", day: "FRI", start: "13:30", end: "16:30", instructor: "อ.ประภัส", credit: 3, year: "67", major_value: "B6001_B", major_label: "วิทยาการคอมพิวเตอร์ (B6001) -ป.ตรี" },
    { code: "01418299", name: "Senior Project I", sec: "1", day: "SAT", start: "09:00", end: "12:00", instructor: "อ.ธีระ", credit: 3, year: "65", major_value: "B6001_B", major_label: "วิทยาการคอมพิวเตอร์ (B6001) -ป.ตรี" },
  ],
  majors: [
    { value: "B5602_B", label: "วิศวกรรมไฟฟ้า (B5602) -ป.ตรี" },
    { value: "C5101_B", label: "การจัดการ (C5101) -ป.ตรี" },
    { value: "B5801_B", label: "เคมีประยุกต์ (B5801) -ป.ตรี" },
    { value: "B6001_B", label: "วิทยาการคอมพิวเตอร์ (B6001) -ป.ตรี" },
  ],
  std_year: "68",
  updated_at: null,
};

function normalizeCourse(entry, index) {
  const code = String(entry.code ?? entry.subject_code ?? "").replace(/-\d{2,4}$/, "").trim();
  const name = String(entry.name ?? entry.subject_name ?? "(ไม่มีชื่อ)");
  const sec = String(entry.sec ?? entry.section ?? "1");
  const instructor = String(entry.instructor ?? entry.teacher ?? "-");
  const credit = Number(entry.credit ?? entry.credits ?? 3);
  const year = String(entry.year ?? "");
  const majorValue = String(entry.major_value ?? "");
  const majorLabel = String(entry.major_label ?? "");
  const day = String(entry.day ?? "");
  const start = String(entry.start ?? "");
  const end = String(entry.end ?? "");
  const valid = !!(code && day && start && end);
  return {
    _raw: entry,
    id: `${code}_${sec}_${day}_${index}`,
    code, name, sec, day, start, end, credit,
    instructor, year, majorValue, majorLabel,
    colorIndex: index % PALETTE.length,
    valid,
  };
}

function parseDataSource(raw) {
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.courses) ? raw.courses : [];
  if (arr.length === 0) throw new Error("ไม่พบข้อมูลรายวิชา");
  const majors = Array.isArray(raw?.majors) ? raw.majors : (() => {
    const m = new Map();
    arr.forEach(e => {
      const v = e.major_value ?? "", l = e.major_label ?? v;
      if (v && !m.has(v)) m.set(v, { value: v, label: l });
    });
    return Array.from(m.values());
  })();
  return {
    courses: arr,
    majors,
    std_year: raw?.std_year ?? "",
    updated_at: raw?.updated_at ?? null,   // FIX 4
  };
}

// ── MAIN APP ──────────────────────────────────────────────
export default function App() {
  const [rawInput, setRawInput]         = useState("");
  const [loadError, setLoadError]       = useState("");
  const [warning, setWarning]           = useState("");
  const [query, setQuery]               = useState("");
  const [filterMajor, setFilterMajor]   = useState("");
  const [filterYear, setFilterYear]     = useState("");
  const [filterDay, setFilterDay]       = useState("");
  const [jsonLoaded, setJsonLoaded]     = useState(false);
  const [isLoading, setIsLoading]       = useState(true);
  const [isExporting, setIsExporting]   = useState(false);  // FIX 1
  const [dataSource, setDataSource]     = useState(SAMPLE_DATA);
  const [showUpdatePanel, setShowUpdatePanel] = useState(false);
  const [updateInput, setUpdateInput]   = useState("");
  const [updateError, setUpdateError]   = useState("");
  const gridRef = useRef(null);  // FIX 1: ref สำหรับ export

  // FIX 2: โหลด selection จาก localStorage ตอน mount
  const [selected, setSelected] = useState(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  // FIX 2: sync selected → localStorage ทุกครั้งที่เปลี่ยน
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(selected)); }
    catch { /* quota exceeded — ไม่ critical */ }
  }, [selected]);

  // auto-fetch /all_timetables.json
  useEffect(() => {
    setIsLoading(true);
    fetch("/all_timetables.json")
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then(raw => { setDataSource(parseDataSource(raw)); setJsonLoaded(true); })
      .catch(() => { /* fallback to SAMPLE_DATA */ })
      .finally(() => setIsLoading(false));
  }, []);

  function loadJSON(text) {
    try {
      const ds = parseDataSource(JSON.parse(text));
      setDataSource(ds); setSelected([]); setWarning(""); setLoadError(""); setJsonLoaded(true);
    } catch (e) { setLoadError(e.message); }
  }

  function updateJSON(text) {
    try {
      const ds = parseDataSource(JSON.parse(text));
      setDataSource(ds); setSelected([]); setWarning(""); setUpdateError("");
      setShowUpdatePanel(false); setUpdateInput(""); setJsonLoaded(true);
    } catch (e) { setUpdateError(e.message); }
  }

  const allCourses = useMemo(
    () => dataSource.courses.map((e, i) => normalizeCourse(e, i)).filter(c => c.valid),
    [dataSource]
  );
  const majors = dataSource.majors ?? [];

  const years = useMemo(() => {
    const s = new Set(allCourses.map(c => c.year).filter(Boolean));
    return Array.from(s).sort((a, b) => b.localeCompare(a));
  }, [allCourses]);

  const selectedCourses = useMemo(
    () => allCourses.filter(c => selected.includes(c.id)),
    [allCourses, selected]
  );
  const totalCredits = selectedCourses.reduce((s, c) => s + c.credit, 0);

  // FIX 3: คำนวณ conflictIds — set ของ id ทุกตัวที่ชนกันจริงๆ
  const conflictIds = useMemo(() => {
    const ids = new Set();
    for (let i = 0; i < selectedCourses.length; i++) {
      for (let j = i + 1; j < selectedCourses.length; j++) {
        if (hasConflict(selectedCourses[i], selectedCourses[j])) {
          ids.add(selectedCourses[i].id);
          ids.add(selectedCourses[j].id);
        }
      }
    }
    return ids;
  }, [selectedCourses]);

  const filtered = useMemo(() => {
    let list = allCourses;
    if (filterMajor) list = list.filter(c => c.majorValue === filterMajor);
    if (filterYear)  list = list.filter(c => c.year === filterYear);
    if (filterDay)   list = list.filter(c => c.day === filterDay);
    if (query) {
      const q = query.toLowerCase();
      list = list.filter(c =>
        c.code.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.instructor.toLowerCase().includes(q) ||
        c.sec.includes(q)
      );
    }
    return list;
  }, [allCourses, filterMajor, filterYear, filterDay, query]);

  function toggle(course) {
    if (selected.includes(course.id)) {
      setSelected(p => p.filter(id => id !== course.id)); setWarning(""); return;
    }
    if (totalCredits + course.credit > MAX_CREDITS) {
      setWarning(`หน่วยกิตเกิน ${MAX_CREDITS} (จะเป็น ${totalCredits + course.credit} หน่วย)`); return;
    }
    const conflict = selectedCourses.find(c => hasConflict(c, course));
    if (conflict) {
      // FIX 3: อนุญาตให้เพิ่มได้แต่แจ้ง warning และ highlight แดง
      setSelected(p => [...p, course.id]);
      setWarning(`⚠ ${course.name} หมู่ ${course.sec} เวลาชนกับ ${conflict.name} หมู่ ${conflict.sec} — ทั้งสองวิชาจะถูก highlight แดงในตาราง`);
      return;
    }
    setSelected(p => [...p, course.id]); setWarning("");
  }

  // FIX 1: Export grid เป็น PNG ด้วย html2canvas (โหลด dynamic)
  const exportPNG = useCallback(async () => {
    if (!gridRef.current || selectedCourses.length === 0) return;
    setIsExporting(true);
    try {
      // โหลด html2canvas จาก CDN แบบ dynamic
      if (!window.html2canvas) {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
          s.onload = resolve; s.onerror = reject;
          document.head.appendChild(s);
        });
      }
      const canvas = await window.html2canvas(gridRef.current, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        logging: false,
      });
      const link = document.createElement("a");
      link.download = `timetable_${new Date().toLocaleDateString("th-TH").replace(/\//g, "-")}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch (err) {
      console.error("Export failed:", err);
      alert("Export ไม่สำเร็จ — กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsExporting(false);
    }
  }, [selectedCourses.length]);

  const selectStyle = {
    fontSize: 12, padding: "5px 10px", borderRadius: 8,
    border: `1px solid ${P.border}`, background: "#fff",
    color: P.textPrimary, cursor: "pointer",
  };

  return (
    <div style={{ minHeight: "100vh", background: P.pageBg, fontFamily: "'Noto Sans Thai', sans-serif" }}>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .timetable-layout {
          display: grid;
          grid-template-columns: 1fr;
          gap: 16px;
        }
        .sidebar { display: flex; flex-direction: column; gap: 16px; }
        .selected-panel-list { max-height: 240px; overflow-y: auto; }
        .course-list-scroll  { max-height: 420px; overflow-y: auto; }
        .filter-select { min-width: 0; flex: 1; }
        @media (min-width: 900px) {
          .timetable-layout {
            grid-template-columns: minmax(0, 1fr) 340px;
            align-items: start;
          }
          /* ไม่ใส่ overflow-y ที่ sidebar-sticky เพราะทำให้ sticky พัง (Firefox) */
          .sidebar-sticky { position: sticky; top: 68px; max-height: calc(100vh - 84px); }
          .course-list-scroll  { max-height: calc(100vh - 540px); min-height: 160px; }
          .selected-panel-list { max-height: 220px; }
        }
        @media (min-width: 1200px) {
          .timetable-layout { grid-template-columns: minmax(0, 1fr) 380px; }
          .course-list-scroll { max-height: calc(100vh - 520px); }
        }
      `}</style>

      {/* ── Header ── */}
      <header style={{
        background: P.headerBg, borderBottom: `1px solid ${P.border}`,
        position: "sticky", top: 0, zIndex: 20,
      }}>
        <div style={{
          maxWidth: 1320, margin: "0 auto", padding: "0 16px",
          height: 52, display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 8, background: P.accent,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.2}>
                <rect x={3} y={4} width={18} height={18} rx={2} />
                <line x1={16} y1={2} x2={16} y2={6} /><line x1={8} y1={2} x2={8} y2={6} />
                <line x1={3} y1={10} x2={21} y2={10} />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: P.textPrimary, lineHeight: 1.1 }}>
                Timetable Builder
              </div>
              {/* FIX 4: แสดง updated_at + loading state */}
              <div style={{ fontSize: 10, color: P.textHint, display: "flex", alignItems: "center", gap: 4 }}>
                มก.ฉกส.
                {isLoading
                  ? <span style={{ color: P.accentMid, marginLeft: 4 }}>
                      <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
                        style={{ animation: "spin 1s linear infinite", verticalAlign: "middle" }}>
                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                      </svg>
                      {" "}กำลังโหลด...
                    </span>
                  : jsonLoaded
                    ? <>
                        <span style={{ marginLeft: 4 }}>· {allCourses.length.toLocaleString()} รายวิชา</span>
                        {dataSource.updated_at && (
                          <span style={{ color: P.textHint, marginLeft: 4 }}>
                            · อัพเดท {dataSource.updated_at}
                          </span>
                        )}
                      </>
                    : <span style={{ marginLeft: 4 }}>· ตัวอย่างข้อมูล</span>
                }
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {selectedCourses.length > 0 && (
              <span style={{ fontSize: 12, color: P.accent, fontWeight: 700 }}>
                {selectedCourses.length} วิชา · {totalCredits} หน่วยกิต
              </span>
            )}
            {/* FIX 1: ปุ่ม Export PNG */}
            {selectedCourses.length > 0 && (
              <button
                onClick={exportPNG}
                disabled={isExporting}
                title="บันทึกตารางเรียนเป็น PNG"
                style={{
                  fontSize: 11, padding: "5px 12px", borderRadius: 8, cursor: isExporting ? "wait" : "pointer",
                  background: isExporting ? P.border : P.accentLt,
                  color: P.accent, border: `1px solid ${P.borderMid}`, fontWeight: 600,
                  display: "flex", alignItems: "center", gap: 5, transition: "all .15s",
                }}
              >
                {isExporting
                  ? <><svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
                        style={{ animation: "spin 1s linear infinite" }}>
                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/>
                      </svg> กำลัง export...</>
                  : <><svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7 10 12 15 17 10"/><line x1={12} y1={15} x2={12} y2={3}/>
                      </svg> บันทึก PNG</>
                }
              </button>
            )}
            {jsonLoaded && (
              <button
                onClick={() => { setShowUpdatePanel(p => !p); setUpdateError(""); }}
                style={{
                  fontSize: 11, padding: "5px 12px", borderRadius: 8, cursor: "pointer",
                  background: showUpdatePanel ? P.accent : P.accentLt,
                  color: showUpdatePanel ? "#fff" : P.accent,
                  border: `1px solid ${P.borderMid}`, fontWeight: 600, transition: "all .15s",
                }}
              >
                {showUpdatePanel ? "✕ ปิด" : "↑ อัพเดทข้อมูล"}
              </button>
            )}
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1320, margin: "0 auto", padding: "16px 16px 48px" }}>

        {/* Panel อัพเดทข้อมูล */}
        {showUpdatePanel && (
          <div style={{
            background: "#fff3e0", border: "1px solid #ffcc02", borderRadius: 12,
            padding: "14px 16px", marginBottom: 16,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#e65100", marginBottom: 6 }}>
              ↑ อัพเดทข้อมูลใหม่ (จะแทนที่ข้อมูลเดิมทั้งหมด)
            </div>
            <p style={{ fontSize: 11, color: "#795548", margin: "0 0 8px" }}>
              วาง JSON ใหม่จาก bot_2.py ด้านล่าง — ข้อมูลเดิมทั้งหมดจะถูกแทนที่ทันที วิชาที่เลือกไว้จะถูกล้าง
            </p>
            <textarea
              placeholder="วาง all_timetables.json ใหม่ตรงนี้..."
              value={updateInput} onChange={e => setUpdateInput(e.target.value)}
              style={{
                display: "block", width: "100%", padding: "8px 10px",
                fontSize: 11, fontFamily: "monospace", borderRadius: 8,
                border: "1px solid #ffcc80", background: "#fffde7", resize: "vertical",
                height: 72, boxSizing: "border-box", color: P.textPrimary, outline: "none",
              }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
              <button onClick={() => updateInput && updateJSON(updateInput)} style={{
                padding: "5px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700,
                background: "#e65100", color: "#fff", border: "none", cursor: "pointer",
              }}>แทนที่ข้อมูลทั้งหมด</button>
              <label style={{ cursor: "pointer", fontSize: 12, color: "#e65100", fontWeight: 600 }}>
                หรืออัพโหลดไฟล์
                <input type="file" accept=".json" style={{ display: "none" }} onChange={e => {
                  const f = e.target.files[0]; if (!f) return;
                  const r = new FileReader(); r.onload = ev => updateJSON(ev.target.result); r.readAsText(f);
                }} />
              </label>
              {updateError && <span style={{ fontSize: 11, color: "#e53935" }}>⚠ {updateError}</span>}
            </div>
          </div>
        )}

        {/* Loading banner */}
        {isLoading && (
          <div style={{
            background: P.accentLt, border: `1px solid ${P.borderMid}`, borderRadius: 12,
            padding: "12px 16px", marginBottom: 16,
            display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: P.accent,
          }}>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={P.accentMid} strokeWidth={2.2}
              style={{ flexShrink: 0, animation: "spin 1s linear infinite" }}>
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
            </svg>
            <span>กำลังโหลดข้อมูลตารางเรียน...</span>
          </div>
        )}

        {/* JSON upload banner (เมื่อโหลดเสร็จแล้วไม่เจอไฟล์) */}
        {!isLoading && !jsonLoaded && (
          <div style={{
            background: P.accentLt, border: `1px solid ${P.borderMid}`, borderRadius: 12,
            padding: "12px 16px", marginBottom: 16, display: "flex", gap: 10, alignItems: "flex-start",
          }}>
            <svg style={{ flexShrink: 0, marginTop: 1 }} width={17} height={17} viewBox="0 0 24 24" fill="none" stroke={P.accent} strokeWidth={2}>
              <circle cx={12} cy={12} r={10} /><line x1={12} y1={8} x2={12} y2={12} /><line x1={12} y1={16} x2={12.01} y2={16} />
            </svg>
            <div style={{ flex: 1, fontSize: 12, color: P.accent }}>
              <strong>กำลังใช้ข้อมูลตัวอย่าง</strong> — วางเนื้อหา{" "}
              <code style={{ background: "#fff", padding: "1px 5px", borderRadius: 3 }}>all_timetables.json</code>{" "}
              ลงในช่องด้านล่าง
              <textarea
                placeholder='วาง JSON ที่ได้จาก bot_2.py ตรงนี้ แล้วกด "โหลดข้อมูล"...'
                value={rawInput} onChange={e => setRawInput(e.target.value)}
                style={{
                  display: "block", width: "100%", marginTop: 8, padding: "8px 10px",
                  fontSize: 11, fontFamily: "monospace", borderRadius: 8,
                  border: `1px solid ${P.borderMid}`, background: "#fff", resize: "vertical",
                  height: 68, boxSizing: "border-box", color: P.textPrimary, outline: "none",
                }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                <button onClick={() => rawInput && loadJSON(rawInput)} style={{
                  padding: "5px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700,
                  background: P.accent, color: "#fff", border: "none", cursor: "pointer",
                }}>โหลดข้อมูล</button>
                <label style={{ cursor: "pointer", fontSize: 12, color: P.accentMid, fontWeight: 600 }}>
                  หรืออัพโหลดไฟล์
                  <input type="file" accept=".json" style={{ display: "none" }} onChange={e => {
                    const f = e.target.files[0]; if (!f) return;
                    const r = new FileReader(); r.onload = ev => loadJSON(ev.target.result); r.readAsText(f);
                  }} />
                </label>
                {loadError && <span style={{ fontSize: 11, color: "#e53935" }}>⚠ {loadError}</span>}
              </div>
            </div>
          </div>
        )}

        {/* Warning */}
        {warning && (
          <div style={{
            background: P.warn, border: `1px solid ${P.warnBorder}`, borderRadius: 10,
            padding: "8px 12px", marginBottom: 12,
            display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: P.warnText,
          }}>
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ flexShrink: 0 }}>
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              <line x1={12} y1={9} x2={12} y2={13}/><line x1={12} y1={17} x2={12.01} y2={17}/>
            </svg>
            <span style={{ flex: 1 }}>{warning}</span>
            <button onClick={() => setWarning("")} style={{
              background: "none", border: "none", cursor: "pointer",
              color: P.warnText, fontSize: 15, lineHeight: 1, padding: 0, opacity: 0.6,
            }}>✕</button>
          </div>
        )}

        {/* ── MAIN LAYOUT ── */}
        <div className="timetable-layout">

          {/* คอลัมน์ซ้าย: ตารางเรียน */}
          <div style={{
            background: P.cardBg, borderRadius: 16, border: `1px solid ${P.border}`,
            padding: "16px 16px 12px",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h2 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: P.textPrimary }}>
                ตารางเรียน
                <span style={{ fontSize: 10, fontWeight: 400, color: P.textHint, marginLeft: 8 }}>
                  (☀ อาทิตย์–เสาร์)
                </span>
              </h2>
              {selectedCourses.length > 0 && (
                <button onClick={() => { setSelected([]); setWarning(""); }} style={{
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: 11, color: P.textHint, padding: 0,
                }}
                  onMouseEnter={e => e.currentTarget.style.color = "#e53935"}
                  onMouseLeave={e => e.currentTarget.style.color = P.textHint}
                >ล้างทั้งหมด</button>
              )}
            </div>
            <Grid
              selectedCourses={selectedCourses}
              onRemove={toggle}
              gridRef={gridRef}
              conflictIds={conflictIds}
            />
          </div>

          {/* คอลัมน์ขวา: Sidebar */}
          <div className="sidebar sidebar-sticky">
            <SelectedPanel
              selectedCourses={selectedCourses}
              onRemove={toggle}
              onClear={() => { setSelected([]); setWarning(""); }}
              totalCredits={totalCredits}
              conflictIds={conflictIds}
            />

            {/* รายวิชาทั้งหมด */}
            <div style={{
              background: P.cardBg, borderRadius: 16, border: `1px solid ${P.border}`,
              padding: 20, display: "flex", flexDirection: "column", gap: 12,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <h2 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: P.textPrimary }}>รายวิชาทั้งหมด</h2>
                <span style={{
                  fontSize: 11, padding: "2px 8px", borderRadius: 99,
                  background: P.accentLt, color: P.accent, fontWeight: 600,
                }}>{filtered.length.toLocaleString()} รายการ</span>
              </div>

              {/* Filters */}
              <div style={{ display: "flex", gap: 8, flexDirection: "column" }}>
                {majors.length > 1 && (
                  <select value={filterMajor} onChange={e => setFilterMajor(e.target.value)}
                    className="filter-select" style={{ ...selectStyle, width: "100%" }}>
                    <option value="">ทุกสาขาวิชา</option>
                    {majors.map(m => (
                      <option key={m.value} value={m.value}>
                        {m.label.length > 34 ? m.label.slice(0, 34) + "…" : m.label}
                      </option>
                    ))}
                  </select>
                )}
                <div style={{ display: "flex", gap: 8, minWidth: 0 }}>
                  {years.length > 0 && (
                    <select value={filterYear} onChange={e => setFilterYear(e.target.value)}
                      className="filter-select" style={{ ...selectStyle }}>
                      <option value="">ทุกปีรหัส</option>
                      {years.map(y => <option key={y} value={y}>ปีรหัส {y}</option>)}
                    </select>
                  )}
                  <select value={filterDay} onChange={e => setFilterDay(e.target.value)}
                    className="filter-select" style={{ ...selectStyle }}>
                    <option value="">ทุกวัน</option>
                    {DAYS.map(d => <option key={d} value={d}>{DAY_LABELS[d]}</option>)}
                  </select>
                </div>
                {(filterMajor || filterYear || filterDay) && (
                  <button onClick={() => { setFilterMajor(""); setFilterYear(""); setFilterDay(""); }} style={{
                    fontSize: 11, padding: "5px 10px", borderRadius: 8,
                    border: `1px solid ${P.border}`, background: "#fff",
                    color: P.textSecondary, cursor: "pointer", width: "100%",
                  }}>ล้างตัวกรอง ✕</button>
                )}
              </div>

              {/* Search */}
              <div style={{ position: "relative" }}>
                <svg style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
                  width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={P.textHint} strokeWidth={2.2}>
                  <circle cx={11} cy={11} r={8} /><line x1={21} y1={21} x2={16.65} y2={16.65} />
                </svg>
                <input
                  type="text"
                  placeholder="ค้นหารหัส ชื่อวิชา หมู่ หรืออาจารย์..."
                  value={query} onChange={e => setQuery(e.target.value)}
                  style={{
                    width: "100%", padding: "7px 10px 7px 30px", fontSize: 13,
                    border: `1px solid ${P.border}`, borderRadius: 10, outline: "none",
                    boxSizing: "border-box", background: P.rowBg, color: P.textPrimary,
                  }}
                  onFocus={e => e.target.style.borderColor = P.accentMid}
                  onBlur={e => e.target.style.borderColor = P.border}
                />
              </div>

              {/* Course cards */}
              <div className="course-list-scroll" style={{ display: "flex", flexDirection: "column", gap: 6, paddingRight: 2 }}>
                {filtered.length === 0 && (
                  <p style={{ textAlign: "center", fontSize: 13, color: P.textHint, padding: "36px 0" }}>
                    ไม่พบรายวิชา
                  </p>
                )}
                {filtered.map(course => (
                  <CourseCard
                    key={course.id}
                    course={course}
                    isSelected={selected.includes(course.id)}
                    isConflict={!selected.includes(course.id) && selectedCourses.some(c => hasConflict(c, course))}
                    onToggle={toggle}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
