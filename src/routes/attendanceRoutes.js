import express from 'express';
import {
  startSession,
  advanceStage,
  endSession,
  startAttempt,
  processScan,
  invalidateAttempt,
  getActiveSession,
  getSessionResults,
  getStudentHistory,
  studentHeartbeat,
  markAbsentBeacon
} from '../controllers/attendanceController.js';
import { verifyToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

router.use(verifyToken);

// Session Management (Professor)
router.post('/session/start', requireRole('PROFESSOR'), startSession);
router.post('/session/advance', requireRole('PROFESSOR'), advanceStage);
router.post('/session/end', requireRole('PROFESSOR'), endSession);
router.get('/session/results/:session_id', requireRole('PROFESSOR'), getSessionResults);

// Student Attendance Attempt & Scan
router.post('/attempt/start', requireRole('STUDENT'), startAttempt);
router.post('/attempt/invalidate', requireRole('STUDENT'), invalidateAttempt);
router.post('/scan', requireRole('STUDENT'), processScan);
router.get('/my-history', requireRole('STUDENT'), getStudentHistory);

// Heartbeat & Absence (Student)
router.post('/heartbeat', requireRole('STUDENT'), studentHeartbeat);
// Accept text/plain for sendBeacon compatibility
router.post(
  '/session/mark-absent',
  requireRole('STUDENT'),
  express.text({ type: 'text/plain' }),
  markAbsentBeacon
);

// Shared
router.get('/session/active', getActiveSession);

export default router;

