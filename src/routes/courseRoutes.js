import express from 'express';
import { getCourses, createCourse, enrollStudent } from '../controllers/courseController.js';
import { verifyToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

router.use(verifyToken);

router.get('/', getCourses);
router.post('/create', requireRole('PROFESSOR'), createCourse);
router.post('/enroll', requireRole('STUDENT'), enrollStudent);

export default router;
