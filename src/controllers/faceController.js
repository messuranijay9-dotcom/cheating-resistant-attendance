import { randomUUID } from 'crypto';
import db from '../db/database.js';
import { logAuditEvent } from '../services/auditService.js';

const FACE_MATCH_THRESHOLD = 0.5;   // Euclidean distance threshold (lower = stricter)
const FACE_TOKEN_TTL_SECONDS = 180; // Face token valid for 3 minutes

/**
 * Compute Euclidean distance between two descriptor arrays
 */
function euclideanDistance(a, b) {
    if (a.length !== b.length) return Infinity;
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        sum += (a[i] - b[i]) ** 2;
    }
    return Math.sqrt(sum);
}

/**
 * STUDENT: Get face enrollment status
 * Tells the frontend whether the student already has a face enrolled.
 */
export function getFaceStatus(req, res) {
    try {
        const studentId = req.user.id;
        const profile = db.prepare(
            'SELECT id, enrolled_at FROM face_profiles WHERE student_id = ?'
        ).get(studentId);

        return res.json({
            enrolled: !!profile,
            enrolled_at: profile ? profile.enrolled_at : null
        });
    } catch (error) {
        console.error('getFaceStatus error:', error);
        return res.status(500).json({ error: 'Failed to retrieve face status.' });
    }
}

/**
 * STUDENT: Enroll face (one-time only)
 * Accepts a 128-float face descriptor array from the browser.
 * Returns 409 if the student already has a face enrolled – no re-enrollment allowed.
 */
export function enrollFace(req, res) {
    try {
        const studentId = req.user.id;
        const { descriptor } = req.body;

        // --- Input Validation ---
        if (!descriptor || !Array.isArray(descriptor) || descriptor.length !== 128) {
            return res.status(400).json({
                error: 'Invalid face descriptor. Expected an array of 128 numbers.'
            });
        }

        const isValidDescriptor = descriptor.every(
            (v) => typeof v === 'number' && isFinite(v)
        );
        if (!isValidDescriptor) {
            return res.status(400).json({ error: 'Face descriptor contains invalid values.' });
        }

        // --- One-time enrollment enforcement ---
        const existing = db.prepare(
            'SELECT id FROM face_profiles WHERE student_id = ?'
        ).get(studentId);

        if (existing) {
            return res.status(409).json({
                error: 'Face already enrolled. Each student can only enroll one face, one time.'
            });
        }

        // --- Store descriptor ---
        db.prepare(
            'INSERT INTO face_profiles (student_id, descriptor) VALUES (?, ?)'
        ).run(studentId, JSON.stringify(descriptor));

        logAuditEvent('FACE_ENROLLED', studentId, null, 'Student enrolled face descriptor', req.ip);

        return res.status(201).json({ message: 'Face enrolled successfully.' });
    } catch (error) {
        console.error('enrollFace error:', error);
        return res.status(500).json({ error: 'Failed to enroll face.' });
    }
}

/**
 * STUDENT: Verify face and receive a short-lived face_token
 * The face_token must be submitted with /api/attendance/attempt/start.
 */
export function verifyFace(req, res) {
    try {
        const studentId = req.user.id;
        const { descriptor } = req.body;

        // --- Input Validation ---
        if (!descriptor || !Array.isArray(descriptor) || descriptor.length !== 128) {
            return res.status(400).json({
                error: 'Invalid face descriptor. Expected an array of 128 numbers.'
            });
        }

        // --- Check enrollment ---
        const profile = db.prepare(
            'SELECT descriptor FROM face_profiles WHERE student_id = ?'
        ).get(studentId);

        if (!profile) {
            return res.status(403).json({
                error: 'No face enrolled for this student. Please enroll your face first.'
            });
        }

        // --- Compare descriptors ---
        const stored = JSON.parse(profile.descriptor);
        const distance = euclideanDistance(descriptor, stored);

        if (distance > FACE_MATCH_THRESHOLD) {
            logAuditEvent(
                'FACE_VERIFY_FAILED',
                studentId,
                null,
                `Face mismatch: distance=${distance.toFixed(4)}`,
                req.ip
            );
            return res.status(401).json({
                error: 'Face verification failed. Face does not match enrolled profile.'
            });
        }

        // --- Issue face_token (upsert – valid for 3 minutes) ---
        const token = randomUUID();
        const expiresAt = new Date(Date.now() + FACE_TOKEN_TTL_SECONDS * 1000).toISOString();

        db.prepare(`
      INSERT INTO face_tokens (student_id, token, expires_at)
      VALUES (?, ?, ?)
      ON CONFLICT(student_id) DO UPDATE SET
        token = excluded.token,
        expires_at = excluded.expires_at,
        created_at = CURRENT_TIMESTAMP
    `).run(studentId, token, expiresAt);

        logAuditEvent(
            'FACE_VERIFY_SUCCESS',
            studentId,
            null,
            `Face verified: distance=${distance.toFixed(4)}`,
            req.ip
        );

        return res.json({
            message: 'Face verified successfully.',
            face_token: token,
            expires_at: expiresAt
        });
    } catch (error) {
        console.error('verifyFace error:', error);
        return res.status(500).json({ error: 'Failed to verify face.' });
    }
}
