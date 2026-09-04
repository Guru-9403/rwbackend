import express from "express";
import { getProgress, updateLessonProgress, resetProgress, heartbeat } from "../controllers/progressController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect); // every route below requires a valid token

router.get("/", getProgress);
router.patch("/lesson", updateLessonProgress);
router.post("/reset", resetProgress);
router.patch("/heartbeat", heartbeat);

export default router;
