import express from "express";
import { getStudents, exportStudentsExcel, sendCertificateEmail } from "../controllers/adminController.js";
import { protect } from "../middleware/authMiddleware.js";
import { adminOnly } from "../middleware/adminMiddleware.js";

const router = express.Router();

router.use(protect, adminOnly); // every route below requires a logged-in admin

router.get("/students", getStudents);
router.get("/students/export", exportStudentsExcel);
router.post("/certificate/send", sendCertificateEmail);

export default router;
