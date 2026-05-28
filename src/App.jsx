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
    leftPct: ((s - HOUR_START) / TOTAL_HOURS) * 100,
    widthPct: ((e - s) / TOTAL_HOURS) * 100,
    durationH: e - s,
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
// ── GridBlock ─────────────────────────────────────────────
function GridBlock({ course, isConflicting, pal, pos, onRemove, lane = 0, numLanes = 1, laneH = 88 }) {
  const isLab = course.type === "lab";
  const displayRoom = course.room;
  const borderStyle = isLab ? "dashed" : "solid";
  const bgColor     = isLab
    ? (isConflicting ? P.conflict : pal.bg + "cc")   // lab = slightly transparent
    : (isConflicting ? P.conflict : pal.bg);
  const topVal    = numLanes > 1 ? lane * laneH + 4 : 4;
  const bottomVal = numLanes > 1 ? undefined : 4;
  const heightVal = numLanes > 1 ? laneH - 8 : undefined;
  return (
    <div
      data-grid-block="1"
      onClick={() => onRemove(course)}
      style={{
        position: "absolute",
        top: topVal,
        bottom: bottomVal,
        height: heightVal,
        left: `${pos.leftPct}%`,
        width: `${pos.widthPct}%`,
        borderRadius: 8,
        padding: "7px 10px",
        background: bgColor,
        border: `1.5px ${borderStyle} ${isConflicting ? P.conflictBorder : pal.border}`,
        cursor: "pointer",
        whiteSpace: "normal",
        lineHeight: 1.35,
        transition: "opacity .1s",
        boxSizing: "border-box",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
      onMouseEnter={e => e.currentTarget.style.opacity = "0.78"}
      onMouseLeave={e => e.currentTarget.style.opacity = "1"}
    >
      {/* บรรทัด 1: รหัส + badge (หมู่ / ปฏิบัติ) */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
        {isConflicting && (
          <span style={{ fontSize: 10, color: P.conflictBorder, flexShrink: 0 }}>⚠</span>
        )}
        <span style={{
          fontFamily: "monospace", fontWeight: 700,
          fontSize: 11, color: isConflicting ? P.conflictBorder : pal.border,
        }}>{course.code}</span>
        <span style={{
          fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 4,
          background: isConflicting ? P.conflictBorder + "20" : pal.border + "25",
          color: isConflicting ? P.conflictBorder : pal.text,
        }}>{isLab ? `🔬 Lab ${course.sec}` : `หมู่ ${course.sec}`}</span>
      </div>
      {/* บรรทัด 2: ชื่อวิชา */}
      <div data-grid-name="1" style={{
        fontSize: 11, fontWeight: 600,
        color: isConflicting ? P.conflictBorder : P.textPrimary,
        lineHeight: 1.3,
        display: "-webkit-box",
        WebkitLineClamp: 2,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
      }}>{course.name}</div>
      {/* บรรทัด 3: อาจารย์ + ห้อง */}
      {(course.instructor && course.instructor !== "-" || displayRoom) && (
        <div style={{ fontSize: 10, color: P.textHint, display: "flex", alignItems: "center", gap: 4, flexWrap: "nowrap", overflow: "hidden", minWidth: 0 }}>
          {course.instructor && course.instructor !== "-" && (
            <>
              <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} style={{ flexShrink: 0 }}>
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx={12} cy={7} r={4}/>
              </svg>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{course.instructor}</span>
            </>
          )}
          {displayRoom && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 2, whiteSpace: "nowrap", flexShrink: 0 }}>
              🏫 {displayRoom}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
// ── Grid ─────────────────────────────────────────────────
function Grid({ selectedCourses, onRemove, gridRef, conflictIds }) {
  const slots = Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => HOUR_START + i);
  return (
    <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
      <div
        ref={gridRef}
        style={{ background: P.cardBg, padding: "6px 0", minWidth: 480 }}
      >
        {/* header ชั่วโมง */}
        <div style={{ display: "flex", paddingLeft: 62, marginBottom: 4 }}>
          {slots.map(h => (
            <div key={h} style={{
              width: `${100 / TOTAL_HOURS}%`, flexShrink: 0,
              fontSize: 9, color: P.textHint, textAlign: "center",
            }}>{String(h).padStart(2, "0")}:00</div>
          ))}
        </div>
        {DAYS.map(day => {
          // แต่ละ entry (lec หรือ lab) เป็น block แยกกัน — มี day/start/end ของตัวเอง
          const allBlocks = selectedCourses
            .filter(c => c.day === day)
            .map(c => ({ course: c, pos: blockPos(c) }))
            .filter(b => b.pos);

          // แบ่ง lane เพื่อป้องกัน blocks ทับกัน
          const LANE_H = 88;
          allBlocks.forEach((b, idx) => {
            const s = { day, start: b.course.start, end: b.course.end };
            let lane = 0;
            while (true) {
              const conflicts = allBlocks.slice(0, idx)
                .filter(x => x.lane === lane)
                .some(x => hasConflict(s, { day, start: x.course.start, end: x.course.end }));
              if (!conflicts) { b.lane = lane; break; }
              lane++;
            }
          });
          const numLanes = allBlocks.length > 0 ? Math.max(...allBlocks.map(b => b.lane)) + 1 : 1;

          const isSun = day === "SUN";
          const isSat = day === "SAT";
          const isWeekend = isSun || isSat;
          const rowBg       = isSun ? P.sunBg : isSat ? P.satBg : P.rowBg;
          const borderColor = isSun ? "#f0b8dd" : isSat ? P.borderMid : P.border;
          const rowMinHeight = numLanes > 1 ? numLanes * LANE_H + 8 : allBlocks.length > 0 ? 96 : 36;
          return (
            <div key={day} data-grid-row="1" style={{
              display: "flex",
              alignItems: "flex-start",
              marginBottom: 3,
              minHeight: rowMinHeight,
            }}>
              {/* label วัน */}
              <div style={{
                width: 62, flexShrink: 0, fontSize: 10, textAlign: "right",
                paddingRight: 8, paddingTop: 6,
                color: isSun ? "#c2185b" : isSat ? P.accentMid : P.textSecondary,
                fontWeight: isWeekend ? 700 : 400,
              }}>
                <span className="day-full">{DAY_LABELS[day]}</span>
                <span className="day-short" style={{ display: "none" }}>{DAY_SHORT[day]}</span>
                {isSun && <span style={{ fontSize: 8, marginLeft: 2, color: P.accentMid }}>☀</span>}
              </div>
              {/* inner row */}
              <div data-grid-inner="1" style={{
                flex: 1, position: "relative",
                minHeight: rowMinHeight,
                borderRadius: 8, background: rowBg,
                border: `1px solid ${borderColor}`,
              }}>
                {/* เส้นแบ่งชั่วโมง */}
                {Array.from({ length: TOTAL_HOURS - 1 }, (_, i) => (
                  <div key={i} style={{
                    position: "absolute", top: 0, height: "100%",
                    left: `${((i + 1) / TOTAL_HOURS) * 100}%`,
                    borderLeft: `1px solid ${P.gridLine}`,
                  }} />
                ))}
                {allBlocks.map(({ course: c, pos, lane }) => {
                  const isConflicting = conflictIds.has(c.id);
                  const pal = PALETTE[c.colorIndex];
                  return (
                    <GridBlock
                      key={c.id}
                      course={c}
                      isConflicting={isConflicting}
                      pal={pal}
                      pos={pos}
                      onRemove={onRemove}
                      lane={lane ?? 0}
                      numLanes={numLanes}
                      laneH={LANE_H}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
        {selectedCourses.length === 0 && (
          <p style={{
            textAlign: "center", fontSize: 11, color: P.textHint,
            padding: "8px 0 4px", margin: 0,
          }}>
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
      {conflictIds.size > 0 && (
        <div style={{
          background: "#ffebee", border: "1px solid #e5393540", borderRadius: 8,
          padding: "7px 10px", fontSize: 11, color: "#b71c1c",
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <span>⚠</span>
          <span>มี {conflictIds.size} วิชาที่เวลาชนกัน — ดูกล่องสีแดงในตาราง</span>
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
            const isLab = c.type === "lab";
            return (
              <div key={c.id} style={{
                borderRadius: 10, padding: "8px 10px",
                background: isConflicting ? P.conflict : pal.bg,
                border: `1px ${isLab ? "dashed" : "solid"} ${isConflicting ? P.conflictBorder + "60" : pal.border + "40"}`,
                display: "flex", alignItems: "flex-start", gap: 8,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2, flexWrap: "wrap" }}>
                    {isConflicting && <span style={{ fontSize: 11, color: P.conflictBorder }}>⚠</span>}
                    <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: isConflicting ? P.conflictBorder : pal.border }}>
                      {c.code}
                    </span>
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: "1px 5px", borderRadius: 3,
                      background: isConflicting ? P.conflictBorder + "20" : pal.border + "25",
                      color: isConflicting ? P.conflictBorder : pal.text,
                    }}>{isLab ? `🔬 Lab ${c.sec}` : `หมู่ ${c.sec}`}</span>
                  </div>
                  <div style={{
                    fontSize: 12, fontWeight: 600, color: P.textPrimary,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 2,
                  }}>{c.name}</div>
                  <div style={{ fontSize: 10, color: P.textSecondary, display: "flex", gap: 5, flexWrap: "wrap" }}>
                    <span>{DAY_LABELS[c.day] ?? c.day} {c.start}–{c.end}</span>
                    {c.instructor && c.instructor !== "-" && <span>· {c.instructor}</span>}
                    {c.room && <span>· 🏫 {c.room}</span>}
                    {c.credit > 0 && <span>· {c.credit} หน่วย</span>}
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
function CourseCard({ course, isSelected, isConflict, isDuplicateSection, onToggle, filterYear }) {
  const pal = PALETTE[course.colorIndex];
  const isDisabled = !isSelected && isDuplicateSection;
  const isLab = course.type === "lab";
  return (
    <div
      onClick={() => !isDisabled && onToggle(course)}
      style={{
        border: isSelected
          ? `1.5px ${isLab ? "dashed" : "solid"} ${pal.border}`
          : isConflict
            ? `1px ${isLab ? "dashed" : "solid"} ${P.conflictBorder}80`
            : `1px ${isLab ? "dashed" : "solid"} ${P.border}`,
        borderRadius: 12, padding: "10px 12px",
        background: isSelected ? pal.bg : isConflict ? "#fff5f6" : P.cardBg,
        cursor: isDisabled ? "not-allowed" : "pointer",
        opacity: isDisabled ? 0.4 : 1,
        transition: "border-color .1s, background .1s",
        userSelect: "none",
      }}
      onMouseEnter={e => { if (!isDisabled && !isSelected) e.currentTarget.style.borderColor = isConflict ? P.conflictBorder : P.borderMid; }}
      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.borderColor = isConflict ? P.conflictBorder + "80" : P.border; }}
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
            }}>{isLab ? `🔬 Lab ${course.sec}` : `หมู่ ${course.sec}`}</span>
            {(() => {
              // ถ้า user filter ปี → โชว์แค่ปีนั้น (ตรงกับ KU FM page)
              // ถ้าไม่ filter → โชว์ปีทั้งหมดที่ section นี้รองรับ
              const ys = filterYear && course.branchYears?.includes(filterYear)
                ? [filterYear]
                : (course.branchYears && course.branchYears.length > 0 ? course.branchYears : (course.year ? [course.year] : []));
              return ys.length > 0 && (
                <span style={{ fontSize: 10, padding: "2px 5px", borderRadius: 4, background: P.border, color: P.textSecondary }}>
                  ปี {ys.join("/")}
                </span>
              );
            })()}
            {course.facultyYearTags && course.facultyYearTags.some(t => t.endsWith("-00")) && (
              <span style={{
                fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 4,
                background: "#fff3e0", color: "#e65100", border: "1px solid #ffb74d",
              }}>📖 วิชาทั่วไป</span>
            )}
            {isConflict && !isDuplicateSection && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                background: P.conflictBorder + "1a", color: P.conflictBorder,
                display: "flex", alignItems: "center", gap: 3,
              }}>⚠ ชนเวลา</span>
            )}
            {isDuplicateSection && !isSelected && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                background: "#e0e0e0", color: "#757575",
                display: "flex", alignItems: "center", gap: 3,
              }}>เลือก{isLab ? "lab" : "หมู่"}อื่นแล้ว</span>
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
                {isLab && "🔬 "}{DAY_SHORT[course.day] ?? course.day} · {course.start}–{course.end}
                {course.room ? ` · 🏫 ${course.room}` : ""}
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
          {course.credit > 0 && (
            <span style={{ fontSize: 11, color: P.textHint }}>{course.credit} หน่วย</span>
          )}
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
    { code: "04252211", name: "Electric Circuit Analysis I", sec: "1", day: "MON", start: "09:30", end: "12:30", instructor: "อ.ณธกร", room: "2-302", credit: 3, year: "2", major_value: "วิศวกรรมไฟฟ้า", major_label: "วิศวกรรมไฟฟ้า", branch: "วิศวกรรมไฟฟ้า-2", lab_day: "WED", lab_start: "13:30", lab_end: "16:30", lab_room: "6-203", seats_total: 30, seats_enrolled: 25 },
    { code: "04252214", name: "Digital System Design", sec: "1", day: "TUE", start: "09:30", end: "12:30", instructor: "อ.เศรษฐกร", room: "2-301", credit: 3, year: "2", major_value: "วิศวกรรมไฟฟ้า", major_label: "วิศวกรรมไฟฟ้า", branch: "วิศวกรรมไฟฟ้า-2", lab_day: "FRI", lab_start: "09:30", lab_end: "12:30", lab_room: "6-204", seats_total: 30, seats_enrolled: 30 },
    { code: "01355102", name: "English for University Life", sec: "9", day: "TUE", start: "13:30", end: "16:30", instructor: "อ.วีระชัย", room: "13-208/1", credit: 3, year: "2", major_value: "วิศวกรรมไฟฟ้า", major_label: "วิศวกรรมไฟฟ้า", branch: "วิศวกรรมไฟฟ้า-2", seats_total: 40, seats_enrolled: 35 },
    { code: "04253201", name: "Engineering Mechanics", sec: "1", day: "WED", start: "09:30", end: "12:30", instructor: "อ.ประภากรณ์", room: "9-302", credit: 3, year: "2", major_value: "วิศวกรรมไฟฟ้า", major_label: "วิศวกรรมไฟฟ้า", branch: "วิศวกรรมไฟฟ้า-2", seats_total: 35, seats_enrolled: 20 },
    { code: "04252299", name: "Special Topics in EE", sec: "1", day: "SUN", start: "09:00", end: "12:00", instructor: "อ.ปิยวัฒน์", room: "", credit: 3, year: "2", major_value: "วิศวกรรมไฟฟ้า", major_label: "วิศวกรรมไฟฟ้า", branch: "วิศวกรรมไฟฟ้า-2" },
    { code: "01132222", name: "Human Resource Management", sec: "1", day: "MON", start: "09:30", end: "12:30", instructor: "อ.นัฐนันท์", room: "13-211", credit: 3, year: "2", major_value: "การจัดการ", major_label: "การจัดการ", branch: "การจัดการ-2", seats_total: 50, seats_enrolled: 42 },
    { code: "01101182", name: "Macroeconomics I", sec: "2", day: "MON", start: "13:30", end: "16:30", instructor: "อ.ฐิตาวรรณ", room: "2-303", credit: 3, year: "2", major_value: "การจัดการ", major_label: "การจัดการ", branch: "การจัดการ-2", seats_total: 50, seats_enrolled: 18 },
    { code: "01418231", name: "Data Structures and Algorithms", sec: "1", day: "WED", start: "09:30", end: "12:30", instructor: "อ.ฐาปนี", room: "9-301/1", credit: 3, year: "3", major_value: "วิทยาการคอมพิวเตอร์", major_label: "วิทยาการคอมพิวเตอร์", branch: "วิทยาการคอมพิวเตอร์-3", lab_day: "THU", lab_start: "13:30", lab_end: "16:30", lab_room: "9-305", seats_total: 40, seats_enrolled: 38 },
    { code: "01418233", name: "Computer Architecture", sec: "1", day: "FRI", start: "13:30", end: "16:30", instructor: "อ.ถนอมศักดิ์", room: "9-306", credit: 3, year: "3", major_value: "วิทยาการคอมพิวเตอร์", major_label: "วิทยาการคอมพิวเตอร์", branch: "วิทยาการคอมพิวเตอร์-3", seats_total: 40, seats_enrolled: 15 },
    { code: "01418299", name: "Senior Project I", sec: "1", day: "SAT", start: "09:00", end: "12:00", instructor: "อ.ธีระ", room: "7-114/2", credit: 3, year: "4", major_value: "วิทยาการคอมพิวเตอร์", major_label: "วิทยาการคอมพิวเตอร์", branch: "วิทยาการคอมพิวเตอร์-4", seats_total: 20, seats_enrolled: 12 },
  ],
  majors: [
    { value: "วิศวกรรมไฟฟ้า", label: "วิศวกรรมไฟฟ้า" },
    { value: "การจัดการ", label: "การจัดการ" },
    { value: "วิทยาการคอมพิวเตอร์", label: "วิทยาการคอมพิวเตอร์" },
  ],
  std_year: "",
  updated_at: null,
};
function normalizeTime(raw) {
  if (!raw) return "";
  const s = String(raw).trim();
  const sep = s.includes(".") ? "." : s.includes(":") ? ":" : null;
  if (sep) {
    const [h, m] = s.split(sep);
    const min = String(m ?? "").startsWith("3") ? 30 : 0;
    return `${String(parseInt(h, 10)).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }
  if (/^\d{3,4}$/.test(s)) {
    const n = parseInt(s, 10);
    return `${String(Math.floor(n / 100)).padStart(2, "0")}:${String(n % 100).padStart(2, "0")}`;
  }
  return s;
}
function parseDayTime(dt) {
  if (!dt) return { day: "", start: "", end: "" };
  const DAY_MAP = { SUN:"SUN", MON:"MON", TUE:"TUE", WED:"WED", THU:"THU", FRI:"FRI", SAT:"SAT" };
  const m = String(dt).trim().match(/^(SUN|MON|TUE|WED|THU|FRI|SAT)\s+(.+)/i);
  if (!m) return { day: "", start: "", end: "" };
  const day = DAY_MAP[m[1].toUpperCase()] ?? "";
  const timeStr = m[2];
  const tm = timeStr.match(/(\d{1,2}[.:]\d{1,2}|\d{3,4})\s*[-–]\s*(\d{1,2}[.:]\d{1,2}|\d{3,4})/);
  if (tm) return { day, start: normalizeTime(tm[1]), end: normalizeTime(tm[2]) };
  return { day, start: "", end: "" };
}
function normalizeCourseEntries(entry, index) {
  const code = String(entry.code ?? entry.subject_code ?? "").replace(/-\d{2,4}$/, "").trim();
  const name = String(entry.name ?? entry.subject_name ?? "(ไม่มีชื่อ)");
  const sec = String(entry.sec ?? entry.section ?? "1");
  const instructor = String(entry.instructor ?? entry.teacher ?? "-");
  const credit = Number(entry.credit ?? entry.credits ?? 3);
  // ── extract year / major จาก branches array (scraped data) ─────────
  const rawBranches = Array.isArray(entry.branches) ? entry.branches : [];
  let year = String(entry.year ?? "");
  let majorValue = String(entry.major_value ?? "").replace(/_(B|M|D)$/i, "");
  let majorLabel = String(entry.major_label ?? "");
  const majorValues = Array.isArray(entry.major_values)
    ? entry.major_values.map(v => String(v).replace(/_(B|M|D)$/i, ""))
    : [];
  if (!year) {
    for (const br of rawBranches) {
      const m = String(br).match(/-(\d{2})$/);
      if (m) { year = m[1]; break; }
    }
  }
  if (!majorValue) {
    for (const br of rawBranches) {
      const s = String(br).trim();
      // รหัสสาขา เช่น "B5602-2"
      const m1 = s.match(/^([A-Z]\d+)-/i);
      if (m1) { majorValue = m1[1].toUpperCase(); break; }
      // ชื่อภาษาไทย เช่น "วิศวกรรมไฟฟ้า-2"
      const m2 = s.match(/^(.+)-\d+$/);
      if (m2) { majorValue = m2[1].trim(); break; }
    }
  }
  if (!majorLabel) majorLabel = majorValue;
  // ── เก็บข้อมูลจาก branches ทั้งหมด ──
  //  majorCodes: รหัสสาขาทุกอันที่เปิดให้ลง (เช่น ["B5602","B6101"])
  //  branchTuples: pair "MAJOR-YEAR" เช่น ["B5602-68","B6101-67"]
  //  facultyYearTags: generic faculty-year เช่น ["A-0","B-69"] (year=0 = ทุกปี)
  const majorCodesSet     = new Set();
  const branchTuplesSet   = new Set();
  const facultyYearTagsSet = new Set();
  const branchYearsSet    = new Set();
  if (majorValue) majorCodesSet.add(majorValue);
  majorValues.forEach(v => v && majorCodesSet.add(v));
  for (const br of rawBranches) {
    // bot รวมหลายค่าใน entry เดียวด้วย ", " เช่น "C5201-66, C5201-67"
    for (const part of String(br).split(/[,\s]+/)) {
      const p = part.trim();
      if (!p) continue;
      // "B5602-68" หรือ "B5602-2568"
      const m = p.match(/^([A-Z]\d+)-(\d{1,4})$/i);
      if (m) {
        const code = m[1].toUpperCase();
        const raw  = m[2];
        const yr   = raw.length > 2 ? raw.slice(-2) : raw.padStart(2, "0");
        majorCodesSet.add(code);
        branchTuplesSet.add(`${code}-${yr}`);
        branchYearsSet.add(yr);
        continue;
      }
      // เฉพาะรหัสสาขาอย่างเดียว (ไม่มี -year)
      const cm = p.match(/^([A-Z]\d+)$/i);
      if (cm) { majorCodesSet.add(cm[1].toUpperCase()); continue; }
      // generic faculty tag เช่น "A-0", "B-69" หรือ multi-faculty "ABCD-0" (ทุกคณะ A,B,C,D)
      const fm = p.match(/^([A-Z]+)-(\d{1,2})$/i);
      if (fm) {
        const letters = fm[1].toUpperCase();
        const yr  = fm[2].padStart(2, "0");
        for (const fac of letters) {
          facultyYearTagsSet.add(`${fac}-${yr}`);
        }
        if (yr !== "00") branchYearsSet.add(yr);
      }
    }
  }
  const majorCodes      = Array.from(majorCodesSet);
  const branchTuples    = Array.from(branchTuplesSet);
  const facultyYearTags = Array.from(facultyYearTagsSet);
  const branchYears     = Array.from(branchYearsSet);
  // facultyTags backward-compat (single letters) — เผื่อใครยังใช้
  const facultyTags = Array.from(new Set(facultyYearTags.map(t => t[0])));
  // ────────────────────────────────────────────────────────────────────
  const branch = String(entry.branch ?? rawBranches.join(", "));
  // ── บรรยาย (lecture) ────────────────────────────────────
  let lecDay   = String(entry.day   ?? "");
  let lecStart = String(entry.start ?? "");
  let lecEnd   = String(entry.end   ?? "");
  const lecRoom = String(entry.room ?? "");
  if ((!lecDay || !lecStart || !lecEnd) && entry.day_time) {
    const parsed = parseDayTime(entry.day_time);
    if (!lecDay)   lecDay   = parsed.day;
    if (!lecStart) lecStart = parsed.start;
    if (!lecEnd)   lecEnd   = parsed.end;
  }
  lecStart = normalizeTime(lecStart) || lecStart;
  lecEnd   = normalizeTime(lecEnd)   || lecEnd;
  // ── ปฏิบัติ (lab) ───────────────────────────────────────
  const labDay   = String(entry.lab_day   ?? "");
  const labStart = normalizeTime(String(entry.lab_start ?? "")) || "";
  const labEnd   = normalizeTime(String(entry.lab_end   ?? "")) || "";
  const labRoom  = String(entry.lab_room  ?? "");
  // ── จำนวนที่นั่ง ─────────────────────────────────────────
  const seatsTotal    = Number(entry.seats_total    ?? -1);
  const seatsEnrolled = Number(entry.seats_enrolled ?? -1);
  const colorIndex = index % PALETTE.length;
  // semester — รองรับทั้ง main mode ("2569/ต้น") และ FM mode ("FM/major/year/2569/1")
  let semester = String(entry.semester ?? "");
  const fmMatch = semester.match(/\/(\d{4})\/(\d)$/);
  if (fmMatch) {
    const semMap = { "1": "ต้น", "2": "ปลาย", "0": "ฤดูร้อน" };
    semester = `${fmMatch[1]}/${semMap[fmMatch[2]] ?? fmMatch[2]}`;
  }
  const common = {
    code, name, sec, credit,
    instructor, year, majorValue, majorValues, majorLabel, branch,
    majorCodes, facultyTags, branchTuples, facultyYearTags, branchYears,
    seatsTotal, seatsEnrolled, semester,
    colorIndex,
  };
  const entries = [];
  const hasLec = !!(code && lecDay && lecStart && lecEnd);
  const hasLab = !!(code && labDay && labStart && labEnd);
  if (hasLec) {
    entries.push({
      ...common,
      _raw: entry,
      id: `${code}_${sec}_lec_${index}`,
      type: "lec",
      day: lecDay, start: lecStart, end: lecEnd, room: lecRoom,
      // เก็บ credit ไว้ที่ lec (lab จะเป็น 0 ถ้ามี lec คู่กัน เพื่อไม่ double count)
      credit,
    });
  }
  if (hasLab) {
    entries.push({
      ...common,
      _raw: entry,
      id: `${code}_${sec}_lab_${index}`,
      type: "lab",
      day: labDay, start: labStart, end: labEnd, room: labRoom,
      // ถ้ามี lec คู่อยู่แล้ว lab credit = 0 (ป้องกัน double count)
      // ถ้าเป็น lab-only ใช้ credit เต็ม
      credit: hasLec ? 0 : credit,
    });
  }
  return entries;
}
function parseDataSource(raw) {
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.courses) ? raw.courses : [];
  if (arr.length === 0) throw new Error("ไม่พบข้อมูลรายวิชา");
  // ── Cross-section branch inheritance ──
  // วิชา lab-only sections (เช่น 04252214 หมู่ 101-105) บ่อยครั้งมี branches ว่าง
  // เพราะ KU เก็บ branches แค่ที่ row ของ lecture section แต่ส่วน lab อยู่ row แยก
  // → union branches ของทุก section ใน code เดียวกัน แล้วเติมให้ section ที่ว่าง
  const codeBranches = new Map();  // code → Set<branch>
  for (const c of arr) {
    const code = String(c.code ?? c.subject_code ?? "").replace(/-\d{2,4}$/, "").trim();
    if (!code) continue;
    const brs = Array.isArray(c.branches) ? c.branches : [];
    if (brs.length === 0) continue;
    if (!codeBranches.has(code)) codeBranches.set(code, new Set());
    const set = codeBranches.get(code);
    for (const br of brs) if (br) set.add(br);
  }
  for (const c of arr) {
    const code = String(c.code ?? c.subject_code ?? "").replace(/-\d{2,4}$/, "").trim();
    const brs = Array.isArray(c.branches) ? c.branches : [];
    if (brs.length === 0 && codeBranches.has(code)) {
      c.branches = Array.from(codeBranches.get(code));
    }
  }
  const majors = (Array.isArray(raw?.majors) && raw.majors.length > 0) ? raw.majors : (() => {
    const m = new Map();
    arr.forEach(e => {
      let v = String(e.major_value ?? "");
      let l = String(e.major_label ?? v);
      // ถ้า major_value ว่าง → ดึงจาก branches (scraped data)
      if (!v) {
        const brs = Array.isArray(e.branches) ? e.branches : [];
        for (const br of brs) {
          const s = String(br).trim();
          if (!s) continue;
          // รองรับทั้ง "วิศวกรรมไฟฟ้า-2" และ "EE2-xxx"
          const thaiMatch = s.match(/^(.+)-\d+$/);
          const engMatch  = s.match(/^([A-Z]\d+)-/i);
          if (thaiMatch) { v = thaiMatch[1].trim(); l = v; break; }
          if (engMatch)  { v = engMatch[1].toUpperCase(); l = v; break; }
        }
      }
      if (v && !m.has(v)) m.set(v, { value: v, label: l });
    });
    return Array.from(m.values()).sort((a, b) => a.label.localeCompare(b.label, "th"));
  })();
  return {
    courses: arr,
    majors,
    std_year: raw?.std_year ?? "",
    updated_at: raw?.updated_at ?? null,
  };
}
// ── MAIN APP ──────────────────────────────────────────────
export default function App() {
  const [rawInput, setRawInput]       = useState("");
  const [loadError, setLoadError]     = useState("");
  const [warning, setWarning]         = useState("");
  const [query, setQuery]             = useState("");
  const [filterMajor, setFilterMajor] = useState("");
  const [filterYear, setFilterYear]   = useState("");
  const [filterDay, setFilterDay]     = useState("");
  const [jsonLoaded, setJsonLoaded]   = useState(false);
  const [isLoading, setIsLoading]     = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [dataSource, setDataSource]   = useState(SAMPLE_DATA);
  const [showUpdatePanel, setShowUpdatePanel] = useState(false);
  const [updateInput, setUpdateInput] = useState("");
  const [updateError, setUpdateError] = useState("");
  const gridRef = useRef(null);
  const [selected, setSelected] = useState(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(selected)); }
    catch { /* quota exceeded */ }
  }, [selected]);
  useEffect(() => {
    setIsLoading(true);
    // ใช้ BASE_URL เพื่อรองรับ GitHub Pages ที่ deploy ภายใต้ subpath
    fetch(`${import.meta.env.BASE_URL}all_timetables.json`)
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
    () => dataSource.courses.flatMap((e, i) => normalizeCourseEntries(e, i)),
    [dataSource]
  );
  // ── Auto-detect & filter to latest semester only ──
  // "ตารางแสดงแค่ปีที่ศึกษาอยู่" → กรองให้เหลือเฉพาะ semester ล่าสุดแบบ implicit
  const latestSemester = useMemo(() => {
    const set = new Set(allCourses.map(c => c.semester).filter(Boolean));
    if (set.size === 0) return "";
    const order = { "ต้น": 0, "ฤดูร้อน": 1, "ปลาย": 2 };
    return Array.from(set).sort((a, b) => {
      const [ya, sa] = a.split("/");
      const [yb, sb] = b.split("/");
      if (ya !== yb) return yb.localeCompare(ya);
      return (order[sa] ?? 9) - (order[sb] ?? 9);
    })[0];
  }, [allCourses]);
  const currentCourses = useMemo(
    () => latestSemester
      ? allCourses.filter(c => c.semester === latestSemester)
      : allCourses,
    [allCourses, latestSemester]
  );
  const majors = dataSource.majors ?? [];
  const years = useMemo(() => {
    const s = new Set(currentCourses.map(c => c.year).filter(Boolean));
    return Array.from(s).sort((a, b) => b.localeCompare(a));
  }, [currentCourses]);
  const selectedCourses = useMemo(
    () => allCourses.filter(c => selected.includes(c.id)),
    [allCourses, selected]
  );
  // credit ต่อ entry ถูก set ให้ไม่ double-count แล้ว (lab=0 ถ้ามี lec คู่ในวิชาเดียวกัน)
  const totalCredits = selectedCourses.reduce((s, c) => s + c.credit, 0);
  const conflictIds = useMemo(() => {
    const ids = new Set();
    // แต่ละ entry เป็น slot เดี่ยว ๆ — เช็คชนเวลาตรง ๆ ได้เลย
    for (let i = 0; i < selectedCourses.length; i++) {
      for (let j = i + 1; j < selectedCourses.length; j++) {
        const a = selectedCourses[i], b = selectedCourses[j];
        if (hasConflict(a, b)) {
          ids.add(a.id);
          ids.add(b.id);
        }
      }
    }
    return ids;
  }, [selectedCourses]);
  // map: "code|type" → entry — เพื่อ block ซ้ำเฉพาะ lec+lec หรือ lab+lab (ยอมให้ lec+lab ของวิชาเดียวกัน)
  const selectedByCodeType = useMemo(() => {
    const m = new Map();
    selectedCourses.forEach(c => m.set(`${c.code}|${c.type}`, c));
    return m;
  }, [selectedCourses]);
  const filtered = useMemo(() => {
    let list = currentCourses;   // ใช้เฉพาะ semester ล่าสุด
    // เมื่อมีทั้ง major + year → ต้องการ tuple "major-year" ที่แม่นยำ
    // เพื่อให้วิชาที่ branches มีหลาย (major-year) เช่น "B6101-67, B5602-68"
    // แสดงเฉพาะถ้านศ. major+year นั้นจริง ๆ ลงได้
    // courses ที่ไม่มี branch info เลย (lab-only เช่น Sports, Computer Apps) → ถือเป็นวิชาเปิดเสรี
    const noBranchInfo = c =>
      c.branchTuples.length === 0 &&
      c.facultyYearTags.length === 0 &&
      c.majorCodes.length === 0;
    if (filterMajor && filterYear) {
      const fac = filterMajor[0];
      const tuple    = `${filterMajor}-${filterYear}`;
      const facTuple = `${fac}-${filterYear}`;
      const facWild  = `${fac}-00`;
      // strict per-section match — section นี้ต้องระบุสาขา+ปีของ user เอง
      list = list.filter(c =>
        c.branchTuples.includes(tuple) ||
        c.facultyYearTags.includes(facTuple) ||
        c.facultyYearTags.includes(facWild)
      );
    } else if (filterMajor) {
      const fac = filterMajor[0];
      list = list.filter(c =>
        c.majorCodes.includes(filterMajor) ||
        (fac && c.facultyTags.includes(fac))
      );
    } else if (filterYear) {
      list = list.filter(c =>
        c.branchYears.includes(filterYear) || c.year === filterYear
      );
    }
    if (filterDay)   list = list.filter(c => c.day === filterDay);
    if (query) {
      const q = query.toLowerCase();
      list = list.filter(c =>
        c.code.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.instructor.toLowerCase().includes(q) ||
        c.sec.includes(q) ||
        c.room.toLowerCase().includes(q)
      );
    }
    // เรียงตามวัน (จ→ส→อา) แล้วเวลาเริ่ม → code → sec
    const dayOrder = { MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6, SUN: 7 };
    list = [...list].sort((a, b) => {
      const da = dayOrder[a.day] ?? 99;
      const db = dayOrder[b.day] ?? 99;
      if (da !== db) return da - db;
      if (a.start !== b.start) return (a.start || "").localeCompare(b.start || "");
      if (a.code !== b.code)   return a.code.localeCompare(b.code);
      return String(a.sec).localeCompare(String(b.sec));
    });
    return list;
  }, [currentCourses, filterMajor, filterYear, filterDay, query]);
  function toggle(course) {
    if (selected.includes(course.id)) {
      setSelected(p => p.filter(id => id !== course.id));
      setWarning("");
      return;
    }
    // block ถ้ามี code+type เดียวกันถูกเลือกอยู่แล้ว (ยอม lec+lab ของวิชาเดียวกัน)
    const dup = selectedByCodeType.get(`${course.code}|${course.type}`);
    if (dup) {
      const typeLabel = course.type === "lab" ? "Lab" : "Lec";
      setWarning(`⚠️ เลือก ${course.code} ${typeLabel} หมู่ ${dup.sec} ไปแล้ว (เลือกได้ 1 หมู่/รายวิชา/ประเภท)`);
      return;
    }
    if (totalCredits + course.credit > MAX_CREDITS) {
      setWarning(`หน่วยกิตเกิน ${MAX_CREDITS} (จะเป็น ${totalCredits + course.credit} หน่วย)`);
      return;
    }
    // เช็คชนเวลา — ถ้าชน block เลย (ไม่ให้เพิ่ม)
    const conflict = selectedCourses.find(c => hasConflict(c, course));
    if (conflict) {
      const ct = course.type === "lab" ? "Lab" : "Lec";
      const ot = conflict.type === "lab" ? "Lab" : "Lec";
      setWarning(`⛔ ${course.code} ${ct} หมู่ ${course.sec} เวลาชนกับ ${conflict.code} ${ot} หมู่ ${conflict.sec} — เลือกได้แค่อันเดียว`);
      return;
    }
    setSelected(p => [...p, course.id]);
    setWarning("");
  }
  // ── Export PNG ────────────────────────────────────────
  const exportPNG = useCallback(async () => {
    if (!gridRef.current || selectedCourses.length === 0) return;
    setIsExporting(true);
    const el = gridRef.current;
    const scrollWrapEl = el.parentElement;
    const savedScrollOverflow = scrollWrapEl?.style.overflowX ?? "";
    const rowEls = el.querySelectorAll("[data-grid-row]");
    const innerRowEls = el.querySelectorAll("[data-grid-inner]");
    const blockEls = el.querySelectorAll("[data-grid-block]");
    const nameEls = el.querySelectorAll("[data-grid-name]");
    const savedRowStyles = Array.from(rowEls).map(r => ({ el: r, minHeight: r.style.minHeight, height: r.style.height }));
    const savedInnerStyles = Array.from(innerRowEls).map(r => ({ el: r, minHeight: r.style.minHeight, height: r.style.height }));
    const savedBlockStyles = Array.from(blockEls).map(b => ({
      overflow: b.style.overflow, bottom: b.style.bottom, height: b.style.height,
    }));
    const savedNameStyles = Array.from(nameEls).map(n => ({
      overflow: n.style.overflow, webkitLineClamp: n.style.webkitLineClamp, display: n.style.display,
    }));
    let tmpStyle = null;
    try {
      if (!window.html2canvas) {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      }
      if (scrollWrapEl) scrollWrapEl.style.overflowX = "visible";
      el.style.minWidth = "960px";
      // ขยาย row
      rowEls.forEach(r => { r.style.height = "auto"; r.style.minHeight = "120px"; });
      innerRowEls.forEach(r => { r.style.height = "auto"; r.style.minHeight = "114px"; });
      // ปลด bottom constraint → block สูงตาม content ไม่ถูกบีบจาก parent height
      blockEls.forEach(b => {
        b.style.overflow = "visible";
        b.style.bottom = "auto";
        b.style.height = "auto";
      });
      nameEls.forEach(n => {
        n.style.overflow = "visible";
        n.style.webkitLineClamp = "unset";
        n.style.display = "block";
      });
      tmpStyle = document.createElement("style");
      tmpStyle.textContent =
        ".day-full{display:block!important}" +
        ".day-short{display:none!important}";
      document.head.appendChild(tmpStyle);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const canvas = await window.html2canvas(el, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        logging: false,
        windowWidth: 1200,
        height: el.scrollHeight,
        width: el.scrollWidth,
        scrollX: 0,
        scrollY: 0,
      });
      const link = document.createElement("a");
      const date = new Date()
        .toLocaleDateString("th-TH", { year: "numeric", month: "2-digit", day: "2-digit" })
        .replace(/\//g, "-");
      link.download = `timetable_${date}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch (err) {
      console.error("Export failed:", err);
      alert("Export ไม่สำเร็จ — กรุณาลองใหม่อีกครั้ง");
    } finally {
      if (scrollWrapEl) scrollWrapEl.style.overflowX = savedScrollOverflow;
      el.style.minWidth = "";
      savedRowStyles.forEach(({ el: r, minHeight, height }) => { r.style.minHeight = minHeight; r.style.height = height; });
      savedInnerStyles.forEach(({ el: r, minHeight, height }) => { r.style.minHeight = minHeight; r.style.height = height; });
      Array.from(blockEls).forEach((b, i) => {
        b.style.overflow = savedBlockStyles[i].overflow;
        b.style.bottom   = savedBlockStyles[i].bottom;
        b.style.height   = savedBlockStyles[i].height;
      });
      Array.from(nameEls).forEach((n, i) => { n.style.overflow = savedNameStyles[i].overflow; n.style.webkitLineClamp = savedNameStyles[i].webkitLineClamp; n.style.display = savedNameStyles[i].display; });
      tmpStyle?.remove();
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
          .sidebar-sticky {
            position: sticky;
            top: 60px;
            max-height: calc(100vh - 76px);
            overflow-y: auto;
          }
          .course-list-scroll  { max-height: calc(100vh - 550px); min-height: 160px; }
          .selected-panel-list { max-height: 200px; }
        }
        @media (min-width: 1200px) {
          .timetable-layout { grid-template-columns: minmax(0, 1fr) 380px; }
          .course-list-scroll { max-height: calc(100vh - 520px); }
        }
        @media (max-width: 599px) {
          .grid-secondary { display: none !important; }
          .day-full { display: none; }
          .day-short { display: inline !important; }
        }
        @media (min-width: 600px) {
          .day-short { display: none !important; }
        }
        .selected-panel-list::-webkit-scrollbar,
        .course-list-scroll::-webkit-scrollbar,
        .sidebar-sticky::-webkit-scrollbar { width: 4px; }
        .selected-panel-list::-webkit-scrollbar-thumb,
        .course-list-scroll::-webkit-scrollbar-thumb,
        .sidebar-sticky::-webkit-scrollbar-thumb {
          background: #f5d0e8; border-radius: 99px;
        }
      `}</style>
      {/* ── Header ── */}
      <header style={{
        background: P.headerBg, borderBottom: `1px solid ${P.border}`,
        position: "sticky", top: 0, zIndex: 20,
      }}>
        <div style={{
          maxWidth: 1320, margin: "0 auto", padding: "0 16px",
          height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
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
              <div style={{ fontSize: 10, color: P.textHint }}>
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
                        <span style={{ marginLeft: 4 }}>· {currentCourses.length.toLocaleString()} รายวิชา{latestSemester ? ` (ภาค ${latestSemester})` : ""}</span>
                        {dataSource.updated_at && (
                          <span style={{ marginLeft: 4, color: P.textHint }}>
                            · อัพเดท {dataSource.updated_at}
                          </span>
                        )}
                      </>
                    : <span style={{ marginLeft: 4 }}>· ตัวอย่าง</span>
                }
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {selectedCourses.length > 0 && (
              <span style={{ fontSize: 11, color: P.accent, fontWeight: 700, whiteSpace: "nowrap" }}>
                {selectedCourses.length} วิชา · {totalCredits} หน่วย
              </span>
            )}
            {selectedCourses.length > 0 && (
              <button
                onClick={exportPNG}
                disabled={isExporting}
                style={{
                  fontSize: 11, padding: "5px 12px", borderRadius: 8,
                  cursor: isExporting ? "wait" : "pointer",
                  background: isExporting ? P.border : P.accentLt,
                  color: P.accent, border: `1px solid ${P.borderMid}`,
                  fontWeight: 600, display: "flex", alignItems: "center", gap: 5,
                  whiteSpace: "nowrap",
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
                      </svg> 📸 บันทึก PNG</>
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
                  border: `1px solid ${P.borderMid}`, fontWeight: 600, whiteSpace: "nowrap",
                }}
              >
                {showUpdatePanel ? "✕ ปิด" : "↑ อัพเดทข้อมูล"}
              </button>
            )}
          </div>
        </div>
      </header>
      <div style={{ maxWidth: 1320, margin: "0 auto", padding: "16px 16px 48px" }}>
        {showUpdatePanel && (
          <div style={{
            background: "#fff3e0", border: "1px solid #ffcc02", borderRadius: 12,
            padding: "14px 16px", marginBottom: 16,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#e65100", marginBottom: 6 }}>
              ↑ อัพเดทข้อมูลใหม่ (แทนที่ข้อมูลเดิมทั้งหมด + ล้างวิชาที่เลือก)
            </div>
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
            <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
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
        {!isLoading && !jsonLoaded && (
          <div style={{
            background: P.accentLt, border: `1px solid ${P.borderMid}`, borderRadius: 12,
            padding: "12px 16px", marginBottom: 16, display: "flex", gap: 10, alignItems: "flex-start",
          }}>
            <svg style={{ flexShrink: 0, marginTop: 1 }} width={17} height={17} viewBox="0 0 24 24" fill="none" stroke={P.accent} strokeWidth={2}>
              <circle cx={12} cy={12} r={10} /><line x1={12} y1={8} x2={12} y2={12} /><line x1={12} y1={16} x2={12.01} y2={16} />
            </svg>
            <div style={{ flex: 1, fontSize: 12, color: P.accent }}>
              <strong>กำลังใช้ข้อมูลตัวอย่าง</strong> — วาง{" "}
              <code style={{ background: "#fff", padding: "1px 5px", borderRadius: 3 }}>all_timetables.json</code>
              {" "}ลงในช่องด้านล่าง
              <textarea
                placeholder='วาง JSON ที่ได้จาก bot.py ตรงนี้...'
                value={rawInput} onChange={e => setRawInput(e.target.value)}
                style={{
                  display: "block", width: "100%", marginTop: 8, padding: "8px 10px",
                  fontSize: 11, fontFamily: "monospace", borderRadius: 8,
                  border: `1px solid ${P.borderMid}`, background: "#fff", resize: "vertical",
                  height: 68, boxSizing: "border-box", color: P.textPrimary, outline: "none",
                }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
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
                  คลิกบล็อกเพื่อเอาออก
                </span>
              </h2>
              {selectedCourses.length > 0 && (
                <button onClick={() => { setSelected([]); setWarning(""); }} style={{
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: 11, color: P.textHint, padding: 0, flexShrink: 0,
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
            <div style={{
              background: P.cardBg, borderRadius: 16, border: `1px solid ${P.border}`,
              padding: 20, display: "flex", flexDirection: "column", gap: 12,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <h2 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: P.textPrimary }}>รายวิชาทั้งหมด</h2>
                <span style={{
                  fontSize: 11, padding: "2px 8px", borderRadius: 99,
                  background: P.accentLt, color: P.accent, fontWeight: 600,
                }}>{filtered.length.toLocaleString()}</span>
              </div>
              <div style={{ display: "flex", gap: 8, flexDirection: "column" }}>
                <select value={filterMajor} onChange={e => setFilterMajor(e.target.value)}
                  className="filter-select" style={{ ...selectStyle, width: "100%" }}>
                  <option value="">ทุกสาขาวิชา</option>
                  {majors.map(m => (
                    <option key={m.value} value={m.value}>
                      {m.label.length > 34 ? m.label.slice(0, 34) + "…" : m.label}
                    </option>
                  ))}
                </select>
                <div style={{ display: "flex", gap: 8, minWidth: 0 }}>
                  <select value={filterYear} onChange={e => setFilterYear(e.target.value)}
                    className="filter-select" style={selectStyle}>
                    <option value="">ทุกปีรหัส</option>
                    {years.map(y => <option key={y} value={y}>ปี {y}</option>)}
                  </select>
                  <select value={filterDay} onChange={e => setFilterDay(e.target.value)}
                    className="filter-select" style={selectStyle}>
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
              <div style={{ position: "relative" }}>
                <svg style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
                  width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={P.textHint} strokeWidth={2.2}>
                  <circle cx={11} cy={11} r={8} /><line x1={21} y1={21} x2={16.65} y2={16.65} />
                </svg>
                <input
                  type="text"
                  placeholder="ค้นหารหัส ชื่อ หมู่ อาจารย์ ห้อง..."
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
              <div className="course-list-scroll" style={{ display: "flex", flexDirection: "column", gap: 6, paddingRight: 2 }}>
                {filtered.length === 0 && (
                  <p style={{ textAlign: "center", fontSize: 13, color: P.textHint, padding: "36px 0", margin: 0 }}>
                    ไม่พบรายวิชา
                  </p>
                )}
                {filtered.map(course => (
                  <CourseCard
                    key={course.id}
                    course={course}
                    isSelected={selected.includes(course.id)}
                    isConflict={
                      !selected.includes(course.id) &&
                      selectedCourses.some(c => hasConflict(c, course))
                    }
                    isDuplicateSection={
                      !selected.includes(course.id) &&
                      selectedByCodeType.has(`${course.code}|${course.type}`)
                    }
                    onToggle={toggle}
                    filterYear={filterYear}
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
