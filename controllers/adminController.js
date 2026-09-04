import ExcelJS from "exceljs";
import User from "../models/User.js";
import Progress from "../models/Progress.js";

const ONLINE_THRESHOLD_MS = 2 * 60 * 1000; // considered "online" if active in the last 2 minutes

function countDone(arr) {
  return (arr || []).reduce((acc, s) => acc + (s?.taskCompleted && s?.testPassed ? 1 : 0), 0);
}

// Builds one row of stats per student, joining User + Progress.
async function buildStudentRows() {
  const students = await User.find({ role: "student" }).sort({ createdAt: -1 });
  const progresses = await Progress.find({ user: { $in: students.map((s) => s._id) } });
  const progressByUser = new Map(progresses.map((p) => [String(p.user), p]));
  const now = Date.now();

  return students.map((s) => {
    const p = progressByUser.get(String(s._id));
    const htmlDone = countDone(p?.statuses);
    const cssDone = countDone(p?.cssStatuses);
    const jsDone = countDone(p?.jsStatuses);
    const htmlComplete = htmlDone === 10;
    const cssComplete = cssDone === 12;
    const jsComplete = jsDone === 6;
    const isOnline = !!(s.lastActiveAt && now - new Date(s.lastActiveAt).getTime() < ONLINE_THRESHOLD_MS);
    return {
      id: s._id,
      name: s.name,
      email: s.email,
      provider: s.provider,
      enrolledAt: s.createdAt,
      lastLoginAt: s.lastLoginAt,
      lastActiveAt: s.lastActiveAt,
      isOnline,
      xp: p?.xp || 0,
      htmlDone, cssDone, jsDone,
      totalLessonsDone: htmlDone + cssDone + jsDone,
      totalLessons: 28,
      htmlComplete, cssComplete, jsComplete,
      htmlPercent: Math.round((htmlDone / 10) * 100),
      cssPercent: Math.round((cssDone / 12) * 100),
      jsPercent: Math.round((jsDone / 6) * 100),
      allComplete: htmlComplete && cssComplete && jsComplete,
    };
  });
}

// @route GET /api/admin/students  (protect, adminOnly)
export async function getStudents(req, res, next) {
  try {
    const rows = await buildStudentRows();
    const summary = {
      totalStudents: rows.length,
      totalOnlineNow: rows.filter((r) => r.isOnline).length,
      totalCompletedAllCourses: rows.filter((r) => r.allComplete).length,
      totalHtmlComplete: rows.filter((r) => r.htmlComplete).length,
      totalCssComplete: rows.filter((r) => r.cssComplete).length,
      totalJsComplete: rows.filter((r) => r.jsComplete).length,
    };
    res.json({ summary, students: rows });
  } catch (err) {
    next(err);
  }
}

// @route GET /api/admin/students/export  (protect, adminOnly)
// Downloads an .xlsx file of every student's enrollment + completion data.
export async function exportStudentsExcel(req, res, next) {
  try {
    const rows = await buildStudentRows();

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Students");

    sheet.columns = [
      { header: "Name", key: "name", width: 24 },
      { header: "Email", key: "email", width: 30 },
      { header: "Sign-up Method", key: "provider", width: 14 },
      { header: "Enrolled Date", key: "enrolledAt", width: 20 },
      { header: "Last Login", key: "lastLoginAt", width: 20 },
      { header: "Online Now", key: "onlineLabel", width: 12 },
      { header: "Lessons Done", key: "lessonsLabel", width: 14 },
      { header: "XP", key: "xp", width: 8 },
      { header: "HTML %", key: "htmlPercent", width: 10 },
      { header: "CSS %", key: "cssPercent", width: 10 },
      { header: "JS %", key: "jsPercent", width: 10 },
      { header: "All Courses Complete", key: "allCompleteLabel", width: 20 },
    ];
    sheet.getRow(1).font = { bold: true };

    rows.forEach((r) => {
      sheet.addRow({
        name: r.name,
        email: r.email,
        provider: r.provider,
        enrolledAt: r.enrolledAt ? new Date(r.enrolledAt).toLocaleString() : "",
        lastLoginAt: r.lastLoginAt ? new Date(r.lastLoginAt).toLocaleString() : "Never",
        onlineLabel: r.isOnline ? "Yes" : "No",
        lessonsLabel: `${r.totalLessonsDone}/${r.totalLessons}`,
        xp: r.xp,
        htmlPercent: r.htmlPercent,
        cssPercent: r.cssPercent,
        jsPercent: r.jsPercent,
        allCompleteLabel: r.allComplete ? "Yes" : "No",
      });
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="codelearn-students-${Date.now()}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
}

// @route POST /api/admin/certificate/send  (protect, adminOnly)
// body: { studentId: string, course: "HTML" | "CSS" | "JavaScript" }
// Verifies completion SERVER-SIDE (never trusts the frontend) then emails
// the certificate via EmailJS's REST API, called from the backend so the
// EmailJS credentials never need to live in the admin's browser.
export async function sendCertificateEmail(req, res, next) {
  try {
    const { studentId, course } = req.body;
    if (!studentId || !course) {
      return res.status(400).json({ message: "studentId and course are required" });
    }

    const student = await User.findById(studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });

    const progress = await Progress.findOne({ user: studentId });
    if (!progress) return res.status(404).json({ message: "No progress found for this student" });

    const doneMap = {
      HTML: countDone(progress.statuses) === 10,
      CSS: countDone(progress.cssStatuses) === 12,
      JavaScript: countDone(progress.jsStatuses) === 6,
    };
    if (!doneMap[course]) {
      return res.status(400).json({ message: `${student.name} has not completed the ${course} course yet` });
    }

    const { EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY } = process.env;
    if (!EMAILJS_SERVICE_ID || !EMAILJS_TEMPLATE_ID || !EMAILJS_PUBLIC_KEY) {
      return res.status(500).json({ message: "EmailJS is not configured on the server (.env)" });
    }

    const emailRes = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: EMAILJS_SERVICE_ID,
        template_id: EMAILJS_TEMPLATE_ID,
        user_id: EMAILJS_PUBLIC_KEY,
        template_params: {
          full_name: student.name,
          to_email: student.email,
          college_name: "", // not collected in the admin flow
          course_name: course,
        },
      }),
    });

    if (!emailRes.ok) {
      const text = await emailRes.text();
      return res.status(502).json({ message: `EmailJS failed to send: ${text}` });
    }

    res.json({ message: `Certificate emailed to ${student.email} for ${course}` });
  } catch (err) {
    next(err);
  }
}
