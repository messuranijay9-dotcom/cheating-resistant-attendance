import express from 'express';
import { getFaceStatus, enrollFace, verifyFace } from '../controllers/faceController.js';
import { verifyToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

router.use(verifyToken);
router.use(requireRole('STUDENT'));

// Check whether the student has a face enrolled (one-time only)
router.get('/status', getFaceStatus);

// Enroll face descriptor – returns 409 if already enrolled
router.post('/enroll', enrollFace);

// Verify face, receive short-lived face_token
router.post('/verify', verifyFace);

export default router;
