import { useState, useEffect, useMemo } from "react";

// ─────────────────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────────────────
const MAX_CREDITS = 22;
const HOUR_START  = 8;
const HOUR_END    = 20;
const TOTAL_HOURS = HOUR_END - HOUR_START;

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const DAY_LABELS = {
  MON: "จันทร์", TUE: "อังคาร", WED: "พุธ",
  THU: "พฤหัสฯ",  FRI: "ศุกร์",  SAT: "เสาร์", SUN: "อาทิตย์",
};

const COLORS = [
  { bg: "#dbeafe", border: "#3b82f6", text: "#1e40af" },
  { bg: "#dcfce7", border: "#16a34a", text: "#14532d" },
  { bg: "#fef9c3", border: "#ca8a04", text: "#713f12" },
  { bg: "#fce7f3", border: "#db2777", text: "#831843" },
  { bg: "#ede9fe", border: "#7c3aed", text: "#4c1d95" },
  { bg: "#ffedd5", border: "#ea580c", text: "#7c2d12" },
  { bg: "#cffafe", border: "#0891b2", text: "#164e63" },
  { bg: "#f0fdf4", border: "#15803d", text: "#14532d" },
];

// ─────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────
const DAY_MAP = {
  จ:"MON", อ:"TUE", พ:"WED", พฤ:"THU", ศ:"FRI", ส:"SAT", อา:"SUN",
  MONDAY:"MON", TUESDAY:"TUE", WEDNESDAY:"WED",
  THURSDAY:"THU", FRIDAY:"FRI", SATURDAY:"SAT", SUNDAY:"SUN",
  MON:"MON", TUE:"TUE", WED:"WED", THU:"THU",
  FRI:"FRI", SAT:"SAT", SUN:"SUN",
};

function toHHMM(raw) {
  if (!raw) return "";
  // รองรับ "9.30", "9:30", "930", "09:30"
  const s = String(raw).trim();
  // dot separator
  let h, m;
  if (s.includes(".")) {
    [h, m] = s.split(".").map(Number);
  } else if (s.includes(":")) {
    [h, m] = s.split(":").map(Number);
  } else if (s.length <= 4) {
    // เช่น "930" หรือ "1030"
    const n = parseInt(s);
    h = Math.floor(n / 100);
    m = n % 100;
  } else {
    return s;
  }
  if (isNaN(h) || isNaN(m)) return s;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}

function parseTime(hhmm) {
  if (!hhmm) return 0;
  const [h, m] = hhmm.split(":").map(Number);
  return h + (m || 0) / 60;
}

// Parse "MON 9.30-12.30" หรือ "จ 09:00-12:00"
function parseDayTime(str) {
  if (!str) return {};
  const s = String(str).trim();

  // ดึงช่วงเวลา: รองรับ dot และ colon
  const timeRe = /(\d{1,2}[.:]\d{2})\s*[-–]\s*(\d{1,2}[.:]\d{2})/;
  const tm = s.match(timeRe);
  const start = tm ? toHHMM(tm[1]) : "";
  const end   = tm ? toHHMM(tm[2]) : "";

  // ดึงวัน: token แรก (ก่อน space หรือตัวเลข)
  const firstToken = s.split(/[\s\d]/)[0].trim();
  const day = DAY_MAP[firstToken.toUpperCase()] || DAY_MAP[firstToken] || "";

  return { day, start, end };
}

function normalizeCourse(entry, index) {
  // code — ตัด suffix ปีการศึกษา เช่น "04252211-65" → "04252211"
  const rawCode = String(
    entry.code ?? entry.subject_code ?? entry.รหัสวิชา ?? ""
  );
  const code = rawCode.replace(/-\d{2,4}$/, "").trim();

  const name       = String(entry.name ?? entry.subject_name ?? entry.ชื่อวิชา ?? "");
  const sec        = String(entry.sec  ?? entry.section      ?? entry.หมู่ ?? "1");
  const instructor = String(entry.instructor ?? entry.teacher ?? entry.อาจารย์ ?? "");
  const creditRaw  = entry.credit ?? entry.credits ?? entry.หน่วยกิต;
  const credit     = creditRaw != null ? Number(creditRaw) : 3;

  // เวลา — รองรับ field แยก หรือ day_time รวม
  let day   = String(entry.day   ?? "");
  let start = String(entry.start ?? "");
  let end   = String(entry.end   ?? "");

  // normalize วัน (ถ้ามีอยู่แล้วแต่เป็น Thai / lowercase)
  if (day) day = DAY_MAP[day.toUpperCase()] || DAY_MAP[day] || day;

  // parse จาก day_time ถ้ายังขาด
  if (!day || !start || !end) {
    const dt = entry.day_time ?? entry.dayTime ?? entry.วันเวลา ?? "";
    if (dt) {
      const parsed = parseDayTime(String(dt));
      if (!day   && parsed.day)   day   = parsed.day;
      if (!start && parsed.start) start = parsed.start;
      if (!end   && parsed.end)   end   = parsed.end;
    }
  }

  // normalize เวลา
  start = toHHMM(start);
  end   = toHHMM(end);

  return {
    _raw: entry,           // ไว้ debug
    id: `${code}_${sec}_${index}`,
    code, name, sec, day, start, end, credit, instructor,
    colorIndex: index % COLORS.length,
  };
}

function normalizeCourses(raw) {
  const arr = Array.isArray(raw) ? raw
    : Array.isArray(raw?.courses) ? raw.courses
    : [];
  return arr.map((e, i) => normalizeCourse(e, i));
}

function hasConflict(a, b) {
  if (a.day !== b.day) return false;
  return parseTime(a.start) < parseTime(b.end) &&
         parseTime(b.start) < parseTime(a.end);
}

function blockStyle(course) {
  const left  = ((parseTime(course.start) - HOUR_START) / TOTAL_HOURS) * 100;
  const width = ((parseTime(course.end) - parseTime(course.start)) / TOTAL_HOURS) * 100;
  const c = COLORS[course.colorIndex ?? 0];
  return { left: `${left}%`, width: `${width}%`, bg: c.bg, border: c.border, text: c.text };
}

// ─────────────────────────────────────────────────────────
//  SUB-COMPONENTS
// ─────────────────────────────────────────────────────────
function Skeleton() {
  return (
    <div className="animate-pulse border border-gray-100 rounded-xl p-4 space-y-2">
      <div className="h-3 bg-gray-100 rounded w-1/4" />
      <div className="h-4 bg-gray-100 rounded w-3/4" />
      <div className="h-3 bg-gray-100 rounded w-1/2" />
    </div>
  );
}

function CreditBar({ current, max }) {
  const pct   = Math.min((current / max) * 100, 100);
  const color = current > max ? "#ef4444" : current >= max * 0.8 ? "#f59e0b" : "#22c55e";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-500">
        <span>หน่วยกิตรวม</span>
        <span className="font-semibold" style={{ color: current > max ? "#ef4444" : "#374151" }}>
          {current} / {max}
        </span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-300"
             style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

// Debug panel — แสดงเฉพาะตอน JSON มีปัญหา
function DebugPanel({ all }) {
  const invalid = all.filter(c => !c.day || !c.start || !c.end);
  if (invalid.length === 0) return null;
  return (
    <details className="border border-amber-200 bg-amber-50 rounded-xl p-4 text-xs">
      <summary className="cursor-pointer font-semibold text-amber-700 select-none">
        ⚠ วิชาที่ parse ไม่สมบูรณ์ ({invalid.length} รายการ) — คลิกเพื่อดู
      </summary>
      <div className="mt-3 space-y-1 font-mono text-amber-800 max-h-48 overflow-y-auto">
        {invalid.map((c, i) => (
          <div key={i} className="border-b border-amber-100 pb-1">
            <span className="font-bold">{c.code || "(ไม่มีรหัส)"}</span>
            {" · day="}
            <span className={c.day ? "text-green-700" : "text-red-600 font-bold"}>{c.day || "❌"}</span>
            {" start="}
            <span className={c.start ? "text-green-700" : "text-red-600 font-bold"}>{c.start || "❌"}</span>
            {" · raw="}
            <span className="text-gray-500">{JSON.stringify(c._raw).slice(0, 80)}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

// ─────────────────────────────────────────────────────────
//  MAIN APP
// ─────────────────────────────────────────────────────────
export default function App() {
  const [allCourses, setAllCourses] = useState([]);    // normalized (including invalid)
  const [selected,   setSelected]   = useState([]);    // course ids
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState("");
  const [warning,    setWarning]    = useState("");
  const [query,      setQuery]      = useState("");

  // ── Load JSON ──────────────────────────────────────────
  useEffect(() => {
    fetch("/all_timetables.json")
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(raw => {
        const normalized = normalizeCourses(raw);
        console.log("[Timetable] loaded:", normalized.length, "entries");
        const invalid = normalized.filter(c => !c.day || !c.start || !c.end);
        if (invalid.length) {
          console.warn("[Timetable] invalid entries:", invalid.length);
          invalid.slice(0, 3).forEach(c => console.warn("  →", c._raw));
        }
        setAllCourses(normalized);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  // ── Derived ────────────────────────────────────────────
  const validCourses = useMemo(
    () => allCourses.filter(c => c.code && c.day && c.start && c.end),
    [allCourses]
  );

  const selectedCourses = useMemo(
    () => validCourses.filter(c => selected.includes(c.id)),
    [validCourses, selected]
  );

  const totalCredits = useMemo(
    () => selectedCourses.reduce((s, c) => s + c.credit, 0),
    [selectedCourses]
  );

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return validCourses;
    return validCourses.filter(c =>
      c.code.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      c.instructor.toLowerCase().includes(q)
    );
  }, [validCourses, query]);

  // ── Toggle ─────────────────────────────────────────────
  function toggle(course) {
    if (selected.includes(course.id)) {
      setSelected(p => p.filter(id => id !== course.id));
      setWarning("");
      return;
    }
    if (totalCredits + course.credit > MAX_CREDITS) {
      setWarning(`หน่วยกิตเกิน ${MAX_CREDITS} (${totalCredits + course.credit} หน่วย)`);
      return;
    }
    const conflict = selectedCourses.find(
      c => c.id !== course.id && hasConflict(c, course)
    );
    if (conflict) {
      setWarning(`เวลาชนกับ ${conflict.name}`);
      return;
    }
    setSelected(p => [...p, course.id]);
    setWarning("");
  }

  // ── Time header ────────────────────────────────────────
  const timeSlots = Array.from(
    { length: TOTAL_HOURS + 1 },
    (_, i) => `${String(HOUR_START + i).padStart(2, "0")}:00`
  );

  // ─────────────────────────────────────────────────────────
  //  RENDER
  // ─────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Header ── */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <span className="font-semibold text-gray-900 text-sm">Timetable Builder</span>
          </div>
          <div className="text-xs text-gray-400">
            {selectedCourses.length > 0 && (
              <span className="text-blue-600 font-semibold">{selectedCourses.length} วิชา · {totalCredits} หน่วยกิต</span>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-5 space-y-4">

        {/* ── Warning ── */}
        {warning && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-sm text-amber-800">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <span className="flex-1">{warning}</span>
            <button onClick={() => setWarning("")} className="text-amber-500 hover:text-amber-700 font-medium">✕</button>
          </div>
        )}

        {/* ── Debug Panel ── */}
        {!loading && !error && <DebugPanel all={allCourses} />}

        {/* ── Timetable Grid ── */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="px-5 pt-4 pb-2">
            <h2 className="text-sm font-semibold text-gray-700">ตารางเรียน</h2>
          </div>
          <div className="px-4 pb-4 overflow-x-auto">
            {/* time header */}
            <div className="flex mb-1 pl-[72px]">
              {timeSlots.map(t => (
                <div key={t} className="text-[10px] text-gray-300 text-center select-none"
                     style={{ width: `${100 / TOTAL_HOURS}%` }}>
                  {t}
                </div>
              ))}
            </div>
            {/* day rows */}
            {DAYS.map(day => {
              const dayCourses = selectedCourses.filter(c => c.day === day);
              return (
                <div key={day} className="flex items-center mb-[3px] h-10">
                  <div className="w-[72px] shrink-0 text-xs text-gray-400 text-right pr-3 select-none">
                    {DAY_LABELS[day]}
                  </div>
                  <div className="relative flex-1 h-8 rounded-lg overflow-hidden"
                       style={{ backgroundColor: "#f8fafc" }}>
                    {/* grid lines */}
                    {Array.from({ length: TOTAL_HOURS - 1 }, (_, i) => (
                      <div key={i} className="absolute top-0 h-full"
                           style={{
                             left: `${((i + 1) / TOTAL_HOURS) * 100}%`,
                             borderLeft: "1px solid #e2e8f0",
                           }} />
                    ))}
                    {/* course blocks */}
                    {dayCourses.map(c => {
                      const s = blockStyle(c);
                      return (
                        <div key={c.id}
                             onClick={() => toggle(c)}
                             className="absolute top-1 bottom-1 rounded-md px-1.5 flex items-center
                                        overflow-hidden text-[11px] font-medium cursor-pointer
                                        border transition-opacity hover:opacity-75"
                             style={{
                               left: s.left, width: s.width,
                               backgroundColor: s.bg, borderColor: s.border, color: s.text,
                             }}
                             title={`${c.name} (${c.start}–${c.end})`}>
                          <span className="truncate">{c.code}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Bottom section ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Selected summary */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-700">วิชาที่เลือก</h2>
            <CreditBar current={totalCredits} max={MAX_CREDITS} />

            {selectedCourses.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6">
                กดเลือกวิชาจากรายการด้านขวา
              </p>
            ) : (
              <div className="space-y-2">
                {selectedCourses.map(c => {
                  const col = COLORS[c.colorIndex ?? 0];
                  return (
                    <div key={c.id}
                         className="flex items-center justify-between rounded-lg px-3 py-2 text-xs"
                         style={{ backgroundColor: col.bg }}>
                      <div className="min-w-0">
                        <span className="font-mono font-semibold" style={{ color: col.border }}>
                          {c.code}
                        </span>
                        <span className="text-gray-600 ml-1.5 truncate">{c.name}</span>
                      </div>
                      <button onClick={() => toggle(c)}
                              className="ml-2 shrink-0 text-gray-400 hover:text-red-500 text-xs">✕</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Course list */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-gray-700">รายวิชาทั้งหมด</h2>
              {!loading && !error && (
                <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                  {filtered.length} รายการ
                </span>
              )}
            </div>

            {/* Search */}
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400"
                   fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 1016.65 16.65z" />
              </svg>
              <input
                type="text"
                placeholder="ค้นหารหัส ชื่อวิชา หรืออาจารย์..."
                value={query}
                onChange={e => setQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-xl
                           focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300
                           placeholder-gray-300"
              />
            </div>

            {/* List */}
            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-0.5">
              {loading && [1,2,3,4].map(i => <Skeleton key={i} />)}

              {error && (
                <div className="text-center py-10 space-y-2">
                  <p className="text-red-500 text-sm font-medium">⚠ โหลดข้อมูลไม่สำเร็จ</p>
                  <p className="text-gray-400 text-xs">{error}</p>
                  <p className="text-gray-400 text-xs">
                    วางไฟล์ <code className="bg-gray-100 px-1 rounded font-mono">all_timetables.json</code> ไว้ในโฟลเดอร์ <code className="bg-gray-100 px-1 rounded font-mono">public/</code>
                  </p>
                </div>
              )}

              {!loading && !error && filtered.length === 0 && (
                <p className="text-center text-gray-400 text-sm py-10">ไม่พบรายวิชา</p>
              )}

              {!loading && !error && filtered.map(course => {
                const isSelected = selected.includes(course.id);
                const conflicted = !isSelected && selectedCourses.some(
                  c => hasConflict(c, course)
                );
                const col = COLORS[course.colorIndex ?? 0];
                return (
                  <div
                    key={course.id}
                    onClick={() => toggle(course)}
                    className={`
                      border rounded-xl p-3 cursor-pointer transition-all duration-100 select-none
                      ${isSelected ? "ring-2 ring-offset-1 shadow-sm" : "hover:border-gray-300"}
                      ${conflicted ? "opacity-40 pointer-events-none" : ""}
                    `}
                    style={{
                      borderColor: isSelected ? col.border : "#f1f5f9",
                      backgroundColor: isSelected ? col.bg : "#fff",
                      "--tw-ring-color": col.border,
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-mono font-semibold" style={{ color: col.border }}>
                          {course.code} · Sec {course.sec}
                        </p>
                        <p className="text-sm font-medium text-gray-800 truncate mt-0.5">{course.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {DAY_LABELS[course.day] ?? course.day} · {course.start}–{course.end}
                        </p>
                        {course.instructor && (
                          <p className="text-xs text-gray-400 truncate">{course.instructor}</p>
                        )}
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-1">
                        <span className="text-xs text-gray-400">{course.credit} หน่วย</span>
                        <div className="w-4 h-4 rounded-full border-2 flex items-center justify-center"
                             style={{ borderColor: col.border }}>
                          {isSelected && (
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: col.border }} />
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
