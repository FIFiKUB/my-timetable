import React, { useState } from "react";

const mockCourses = [
  {
    id: 1,
    code: "04252211",
    name: "Electric Circuit Analysis I",
    sec: "1",
    instructor: "ผศ.ศุภลักษณ์",
    day: "MON",
    start: "09:30",
    end: "12:30",
    credit: 3,
  },
  {
    id: 2,
    code: "04252211",
    name: "Electric Circuit Analysis I",
    sec: "2",
    instructor: "ผศ.ศุภลักษณ์",
    day: "MON",
    start: "13:00",
    end: "16:00",
    credit: 3,
  },
  {
    id: 3,
    code: "04252214",
    name: "Digital System Design",
    sec: "1",
    instructor: "ผศ.กิติโชค",
    day: "TUE",
    start: "13:30",
    end: "16:30",
    credit: 3,
  },
  {
    id: 4,
    code: "04252214",
    name: "Digital System Design",
    sec: "2",
    instructor: "ผศ.กิติโชค",
    day: "TUE",
    start: "09:00",
    end: "12:00",
    credit: 3,
  },
  {
    id: 5,
    code: "04252331",
    name: "Electromagnetics",
    sec: "1",
    instructor: "ผศ.ดร.นพดล",
    day: "SUN",
    start: "09:00",
    end: "12:00",
    credit: 3,
  },
  {
    id: 6,
    code: "01999213",
    name: "Environment, Technology and Life",
    sec: "1",
    instructor: "อ.ดร.สมชาย",
    day: "WED",
    start: "13:00",
    end: "16:00",
    credit: 3,
  },
  {
    id: 7,
    code: "04252212",
    name: "Electric Circuit Laboratory I",
    sec: "1",
    instructor: "อ.คณะวิศวกรรมศาสตร์",
    day: "THU",
    start: "09:00",
    end: "12:00",
    credit: 1,
  },
];

const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const TIME_SLOTS = [
  "08:00",
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
  "18:00",
  "19:00",
  "20:00",
];
const MAX_CREDITS = 22; // ลิมิตหน่วยกิตสูงสุดที่ลงได้ต่อเทอม

export default function App() {
  const [selectedCourses, setSelectedCourses] = useState([]);
  const [warning, setWarning] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterDay, setFilterDay] = useState("ALL");

  // คำนวณหน่วยกิตรวมแบบเรียลไทม์
  const totalCredits = selectedCourses.reduce((sum, c) => sum + c.credit, 0);

  const checkTimeConflict = (newCourse) => {
    const parseTime = (t) => {
      const [h, m] = t.split(":").map(Number);
      return h + m / 60;
    };
    for (let course of selectedCourses) {
      if (course.day === newCourse.day) {
        if (
          parseTime(newCourse.start) < parseTime(course.end) &&
          parseTime(newCourse.end) > parseTime(course.start)
        ) {
          return `⚠️ เวลาชนกับวิชา ${course.name}`;
        }
      }
    }
    return null;
  };

  const addCourse = (course) => {
    // 1. เช็ควิชาซ้ำ
    if (selectedCourses.some((c) => c.code === course.code))
      return setWarning(`⚠️ เลือกได้วิชาละ 1 หมู่เรียน`);

    // 2. เช็คหน่วยกิตล้นลิมิต
    if (totalCredits + course.credit > MAX_CREDITS) {
      return setWarning(
        `⚠️ ไม่สามารถเพิ่มได้! หน่วยกิตรวมจะเกินลิมิต ${MAX_CREDITS} นก.`
      );
    }

    // 3. เช็คเวลาชน
    const conflict = checkTimeConflict(course);
    if (conflict) return setWarning(conflict);

    setSelectedCourses([...selectedCourses, course]);
    setWarning("");
  };

  const removeCourse = (id) =>
    setSelectedCourses(selectedCourses.filter((c) => c.id !== id));

  const getStyleForCourse = (start, end) => {
    const parseTime = (t) => {
      const [h, m] = t.split(":").map(Number);
      return h + m / 60;
    };
    return {
      left: `${((parseTime(start) - 8) / 12) * 100}%`,
      width: `${((parseTime(end) - parseTime(start)) / 12) * 100}%`,
    };
  };

  const filtered = mockCourses.filter(
    (c) =>
      (c.code.includes(searchTerm) ||
        c.name.toLowerCase().includes(searchTerm.toLowerCase())) &&
      (filterDay === "ALL" || c.day === filterDay)
  );

  // คำนวณเปอร์เซ็นต์ความคุมหลอดหน่วยกิต
  const creditPercentage = Math.min((totalCredits / MAX_CREDITS) * 100, 100);

  return (
    <div className="p-4 md:p-6 bg-gray-100 min-h-screen text-gray-800 font-sans">
      {/* Header และ แถบแสดงหน่วยกิต */}
      <div className="mb-6 bg-white p-4 md:p-6 rounded-xl border-l-4 border-[#5E1916] flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Timetable Builder
          </h1>
          <p className="text-sm text-gray-500">
            วิศวกรรมไฟฟ้า (B5602) • มก.ฉกส.
          </p>
        </div>

        {/* กล่องแสดงสถานะหน่วยกิตที่มุมขวาบน */}
        <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 min-w-[200px]">
          <div className="flex justify-between items-end mb-1">
            <span className="text-xs font-bold text-gray-500">
              หน่วยกิตที่ลงแล้ว
            </span>
            <span className="text-lg font-black text-[#5E1916]">
              {totalCredits}{" "}
              <span className="text-sm text-gray-400 font-medium">
                / {MAX_CREDITS}
              </span>
            </span>
          </div>
          {/* หลอด Progress Bar */}
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all duration-500 ${
                totalCredits === MAX_CREDITS ? "bg-red-500" : "bg-[#5E1916]"
              }`}
              style={{ width: `${creditPercentage}%` }}
            ></div>
          </div>
        </div>
      </div>

      {warning && (
        <div className="bg-red-50 border border-red-200 p-3 rounded-lg text-red-700 mb-6 flex justify-between items-center shadow-sm">
          <span className="font-medium text-sm">{warning}</span>
          <button
            onClick={() => setWarning("")}
            className="font-bold hover:text-red-900"
          >
            ✕
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-1 bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex flex-col h-[600px]">
          <h2 className="font-bold text-lg mb-3">📋 ค้นหารายวิชา</h2>
          <input
            className="w-full p-2 border border-gray-300 rounded-lg mb-3 text-sm focus:ring-2 focus:ring-[#5E1916]/50 focus:outline-none"
            placeholder="พิมพ์รหัส / ชื่อวิชา..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <div className="flex gap-1.5 mb-4 overflow-x-auto pb-2 scrollbar-hide">
            <button
              onClick={() => setFilterDay("ALL")}
              className={`px-3 py-1 text-xs font-bold rounded-full shrink-0 transition-all ${
                filterDay === "ALL"
                  ? "bg-[#5E1916] text-white"
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }`}
            >
              ทั้งหมด
            </button>
            {DAYS.map((d) => (
              <button
                key={d}
                onClick={() => setFilterDay(d)}
                className={`px-3 py-1 text-xs font-bold rounded-full shrink-0 transition-all ${
                  filterDay === d
                    ? "bg-[#5E1916] text-white"
                    : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
          <div className="space-y-3 overflow-y-auto pr-1 flex-1">
            {filtered.map((course) => {
              const isDisabled = selectedCourses.some(
                (c) => c.id === course.id || c.code === course.code
              );
              return (
                <div
                  key={course.id}
                  className={`p-4 rounded-xl border flex justify-between items-center transition-all ${
                    isDisabled
                      ? "bg-gray-50 border-gray-100 opacity-60"
                      : "bg-white border-gray-200 hover:shadow-md"
                  }`}
                >
                  <div className="text-sm w-full pr-3">
                    <p className="font-bold text-xs text-gray-400 mb-0.5">
                      {course.code} • Sec {course.sec}
                    </p>
                    <p className="font-bold text-gray-900 leading-tight mb-1">
                      {course.name}
                    </p>
                    <p className="text-xs text-[#5E1916] font-medium">
                      👤 {course.instructor}
                    </p>
                    <div className="flex gap-1.5 mt-2 text-[10px] font-medium">
                      <span className="bg-[#5E1916]/10 text-[#5E1916] px-2 py-0.5 rounded">
                        {course.day}
                      </span>
                      <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                        {course.start}-{course.end}
                      </span>
                      <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                        {course.credit} นก.
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => addCourse(course)}
                    disabled={isDisabled}
                    className={`px-3 py-2 rounded-lg text-xs font-bold shrink-0 transition-all ${
                      isDisabled
                        ? "bg-gray-300 text-gray-500"
                        : "bg-[#5E1916] text-white hover:bg-red-800 shadow-sm"
                    }`}
                  >
                    {isDisabled ? "เลือกแล้ว" : "+ เพิ่ม"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="xl:col-span-2 bg-white p-4 rounded-xl shadow-sm border border-gray-200 overflow-x-auto h-[600px]">
          <h2 className="font-bold text-lg mb-4">📅 ตารางเรียน</h2>
          <div className="min-w-[800px] relative select-none">
            <div className="flex border-b border-gray-200 text-xs font-bold text-gray-400 pb-2">
              <div className="w-16 shrink-0 text-center">เวลา</div>
              <div className="flex-1 grid grid-cols-12">
                {TIME_SLOTS.slice(0, -1).map((t) => (
                  <div key={t} className="pl-1 border-l border-transparent">
                    {t}
                  </div>
                ))}
              </div>
            </div>
            {DAYS.map((day) => (
              <div
                key={day}
                className="flex items-center h-16 border-b border-gray-100 relative bg-gray-50/30"
              >
                <div
                  className={`w-16 shrink-0 text-xs font-black h-full flex items-center justify-center border-r border-gray-200 z-10 ${
                    day === "SUN"
                      ? "bg-red-50 text-red-700"
                      : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {day}
                </div>
                <div className="flex-1 relative h-full">
                  <div className="absolute inset-0 grid grid-cols-12 pointer-events-none">
                    {TIME_SLOTS.slice(0, -1).map((_, i) => (
                      <div
                        key={i}
                        className="border-l border-gray-200/50 h-full"
                      ></div>
                    ))}
                  </div>
                  {selectedCourses
                    .filter((c) => c.day === day)
                    .map((c) => (
                      <div
                        key={c.id}
                        style={getStyleForCourse(c.start, c.end)}
                        onClick={() => removeCourse(c.id)}
                        className="absolute top-1 bottom-1 bg-[#5E1916] text-white p-2 rounded-lg shadow-sm cursor-pointer overflow-hidden flex flex-col justify-center border-l-4 border-yellow-400 hover:bg-red-800 transition-all group"
                      >
                        <span className="text-[11px] font-bold truncate">
                          {c.code} (Sec {c.sec})
                        </span>
                        <span className="text-[10px] text-yellow-300 truncate mt-0.5">
                          👤 {c.instructor}
                        </span>
                        <div className="hidden group-hover:flex absolute inset-0 bg-red-600/90 items-center justify-center font-bold text-white text-xs">
                          ✕ ลบ
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
