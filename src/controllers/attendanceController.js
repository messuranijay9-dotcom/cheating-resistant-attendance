import QRCode from 'qrcode';
import db from '../db/database.js';
import { generateQRStageToken, parseQRScannedData } from '../services/qrService.js';
import { logAuditEvent } from '../services/auditService.js';

let ioInstance = null;
export function setSocketIO(io) {
  ioInstance = io;
}

// ---------------------------------------------------------------------------
// Server-side per-stage timer management
// ---------------------------------------------------------------------------

/** Map<sessionId, { timer: NodeJS.Timeout, stage: number }> */
const sessionTimers = new Map();

function clearSessionTimer(sessionId) {
  if (sessionTimers.has(sessionId)) {
    clearTimeout(sessionTimers.get(sessionId).timer);
    sessionTimers.delete(sessionId);
  }
}

function scheduleStageExpiry(sessionId, stage, delayMs) {
  clearSessionTimer(sessionId);
  const timer = setTimeout(() => {
    handleStageExpiry(sessionId, stage);
  }, delayMs);
  if (timer.unref) timer.unref();
  sessionTimers.set(sessionId, { timer, stage });
}

async function handleStageExpiry(sessionId, stage) {
  try {
    const session = db.prepare(
      `SELECT * FROM attendance_sessions WHERE id = ? AND status = 'ACTIVE' AND current_stage = ?`
    ).get(sessionId, stage);

    if (!session) {
      // Session already advanced, ended, or doesn't match — do nothing
      return;
    }

    if (stage < 3) {
      const nextStage = stage + 1;
      const stageTimeout = session.stage_timeout_seconds || 60;
      const now = new Date();
      const stageExpiresAt = new Date(now.getTime() + stageTimeout * 1000).toISOString();

      db.prepare(`
        UPDATE attendance_sessions
        SET current_stage = ?, qr_stage_expires_at = ?
        WHERE id = ? AND status = 'ACTIVE' AND current_stage = ?
      `).run(nextStage, stageExpiresAt, sessionId, stage);

      const qrStageData = await generateQRStageToken(sessionId, nextStage, stageTimeout);

      logAuditEvent('STAGE_AUTO_ADVANCED', null, sessionId,
        `Auto-advanced session from stage ${stage} to ${nextStage}`, null);

      const payload = {
        id: sessionId,
        course_id: session.course_id,
        status: 'ACTIVE',
        current_stage: nextStage,
        qr_stage_expires_at: stageExpiresAt,
        stage_timeout_seconds: stageTimeout,
        qr: qrStageData
      };

      if (ioInstance) ioInstance.emit('stage_changed', payload);

      scheduleStageExpiry(sessionId, nextStage, stageTimeout * 1000);
    } else {
      // Final stage expired — end session
      const changed = db.prepare(`
        UPDATE attendance_sessions
        SET status = 'ENDED'
        WHERE id = ? AND status = 'ACTIVE' AND current_stage = 3
      `).run(sessionId);

      if (changed.changes > 0) {
        db.prepare(`UPDATE qr_tokens SET is_active = 0 WHERE session_id = ?`).run(sessionId);
        logAuditEvent('SESSION_AUTO_ENDED', null, sessionId,
          'Session auto-ended after final stage expiry', null);

        if (ioInstance) {
          ioInstance.emit('session_ended', { session_id: sessionId, reason: 'TIMER_EXPIRED' });
        }
      }

      clearSessionTimer(sessionId);
    }
  } catch (err) {
    console.error(`[StageExpiry] Error handling stage ${stage} expiry for session ${sessionId}:`, err);
  }
}

// ---------------------------------------------------------------------------
// Absent / heartbeat helpers
// ---------------------------------------------------------------------------

/**
 * Mark a student ABSENT for a session.
 * - Only acts if the student has an IN_PROGRESS attempt and no existing record.
 * - Emits attendance_updated socket event.
 */
function markStudentAbsent(sessionId, studentId, reason, ip) {
  try {
    // Don't change an existing PRESENT record
    const existing = db.prepare(
      'SELECT status FROM attendance_records WHERE session_id = ? AND student_id = ?'
    ).get(sessionId, studentId);
    if (existing && existing.status === 'PRESENT') return;

    db.prepare(
      `UPDATE attendance_attempts SET status = 'INVALIDATED' WHERE session_id = ? AND student_id = ?`
    ).run(sessionId, studentId);

    db.prepare(`
      INSERT INTO attendance_records (session_id, student_id, status, marked_at)
      VALUES (?, ?, 'ABSENT', ?)
      ON CONFLICT(student_id, session_id) DO UPDATE SET
        status = 'ABSENT'
        WHERE status != 'PRESENT'
    `).run(sessionId, studentId, new Date().toISOString());

    logAuditEvent('MARKED_ABSENT', studentId, sessionId, `Student marked ABSENT: ${reason}`, ip);

    if (ioInstance) {
      ioInstance.emit('attendance_updated', {
        session_id: sessionId,
        student_id: studentId,
        status: 'ABSENT'
      });
    }
  } catch (e) {
    console.error('markStudentAbsent error:', e);
  }
}

// ---------------------------------------------------------------------------
// Heartbeat monitor (runs every 30 s, marks absent after 60 s silence)
// ---------------------------------------------------------------------------

export function startHeartbeatMonitor() {
  const hbInterval = setInterval(() => {
    try {
      const threshold = new Date(Date.now() - 60000).toISOString();
      const stale = db.prepare(`
        SELECT aa.id, aa.session_id, aa.student_id
        FROM attendance_attempts aa
        JOIN attendance_sessions s ON aa.session_id = s.id
        WHERE aa.status = 'IN_PROGRESS'
          AND aa.last_heartbeat_at IS NOT NULL
          AND aa.last_heartbeat_at < ?
          AND s.status = 'ACTIVE'
      `).all(threshold);

      for (const a of stale) {
        markStudentAbsent(a.session_id, a.student_id,
          'Heartbeat timeout - student disconnected', null);
      }
    } catch (e) {
      console.error('[HeartbeatMonitor] Error:', e);
    }
  }, 30000);
  if (hbInterval.unref) hbInterval.unref();
}

/**
 * PROFESSOR: Start an attendance session
 */
export async function startSession(req, res) {
  try {
    const { course_id, timeout_seconds = 180, stage_timeout_seconds } = req.body;
    const professorId = req.user.id;

    if (!course_id) {
      return res.status(400).json({ error: 'Course ID is required.' });
    }

    const course = db.prepare('SELECT * FROM courses WHERE id = ? AND professor_id = ?').get(course_id, professorId);
    if (!course) {
      return res.status(403).json({ error: 'Course not found or unauthorized.' });
    }

    // End any existing active session for this course (cancel its timer too)
    const oldSession = db.prepare(
      `SELECT id FROM attendance_sessions WHERE course_id = ? AND status = 'ACTIVE'`
    ).get(course_id);
    if (oldSession) clearSessionTimer(Number(oldSession.id));

    db.prepare(`
      UPDATE attendance_sessions
      SET status = 'ENDED'
      WHERE course_id = ? AND status = 'ACTIVE'
    `).run(course_id);

    // Compute per-stage timeout
    const stageTimeoutSeconds = stage_timeout_seconds
      ? Number(stage_timeout_seconds)
      : Math.max(1, Math.floor(timeout_seconds / 3));

    const now = new Date();
    const expiryTime = new Date(now.getTime() + timeout_seconds * 1000).toISOString();
    const stageExpiresAt = new Date(now.getTime() + stageTimeoutSeconds * 1000).toISOString();

    const stmt = db.prepare(`
      INSERT INTO attendance_sessions
        (course_id, started_by, start_time, expiry_time, status, current_stage,
         total_timeout_seconds, stage_timeout_seconds, qr_stage_expires_at)
      VALUES (?, ?, ?, ?, 'ACTIVE', 1, ?, ?, ?)
    `);
    const result = stmt.run(
      course_id, professorId, now.toISOString(), expiryTime,
      timeout_seconds, stageTimeoutSeconds, stageExpiresAt
    );
    const sessionId = Number(result.lastInsertRowid);

    // Generate Stage 1 QR token with per-stage TTL
    const qrStageData = await generateQRStageToken(sessionId, 1, stageTimeoutSeconds);

    // Schedule auto-advance after stage timeout
    scheduleStageExpiry(sessionId, 1, stageTimeoutSeconds * 1000);

    logAuditEvent('SESSION_START', professorId, sessionId, `Started session for course ${course.course_code}`, req.ip);

    const sessionPayload = {
      id: sessionId,
      course_id: course_id,
      course_name: course.name,
      course_code: course.course_code,
      status: 'ACTIVE',
      current_stage: 1,
      expiry_time: expiryTime,
      total_timeout_seconds: timeout_seconds,
      stage_timeout_seconds: stageTimeoutSeconds,
      qr_stage_expires_at: stageExpiresAt,
      qr: qrStageData
    };

    if (ioInstance) {
      ioInstance.emit('session_updated', sessionPayload);
    }

    return res.status(201).json({
      message: 'Attendance session started successfully.',
      session: sessionPayload
    });
  } catch (error) {
    console.error('startSession error:', error);
    return res.status(500).json({ error: 'Failed to start attendance session.' });
  }
}

/**
 * PROFESSOR: Advance session stage (1 -> 2 -> 3)
 */
export async function advanceStage(req, res) {
  try {
    const { session_id, target_stage } = req.body;
    const professorId = req.user.id;

    const session = db.prepare(`
      SELECT s.*, c.course_code
      FROM attendance_sessions s
      JOIN courses c ON s.course_id = c.id
      WHERE s.id = ? AND s.started_by = ?
    `).get(session_id, professorId);

    if (!session) {
      return res.status(404).json({ error: 'Attendance session not found or unauthorized.' });
    }

    if (session.status !== 'ACTIVE') {
      return res.status(400).json({ error: `Cannot advance stage. Session is ${session.status}.` });
    }

    const nextStage = target_stage ? Number(target_stage) : session.current_stage + 1;
    if (nextStage < 1 || nextStage > 3) {
      return res.status(400).json({ error: 'Invalid stage. Stage must be 1, 2, or 3.' });
    }

    const stageTimeout = session.stage_timeout_seconds || 60;
    const now = new Date();
    const stageExpiresAt = new Date(now.getTime() + stageTimeout * 1000).toISOString();

    // Update session current_stage and new stage expiry
    db.prepare(`
      UPDATE attendance_sessions
      SET current_stage = ?, qr_stage_expires_at = ?
      WHERE id = ?
    `).run(nextStage, stageExpiresAt, session_id);

    const qrStageData = await generateQRStageToken(session_id, nextStage, stageTimeout);

    // Reschedule server-side auto-advance for the new stage
    scheduleStageExpiry(Number(session_id), nextStage, stageTimeout * 1000);

    logAuditEvent('STAGE_ADVANCED', professorId, session_id, `Advanced session to stage ${nextStage}`, req.ip);

    const updatedSessionPayload = {
      id: session_id,
      course_id: session.course_id,
      status: 'ACTIVE',
      current_stage: nextStage,
      expiry_time: session.expiry_time,
      stage_timeout_seconds: stageTimeout,
      qr_stage_expires_at: stageExpiresAt,
      qr: qrStageData
    };

    if (ioInstance) {
      ioInstance.emit('stage_changed', updatedSessionPayload);
    }

    return res.json({
      message: `Advanced to stage ${nextStage}`,
      session: updatedSessionPayload
    });
  } catch (error) {
    console.error('advanceStage error:', error);
    return res.status(500).json({ error: 'Failed to advance session stage.' });
  }
}

/**
 * PROFESSOR: End attendance session
 */
export function endSession(req, res) {
  try {
    const { session_id } = req.body;
    const professorId = req.user.id;

    const session = db.prepare('SELECT * FROM attendance_sessions WHERE id = ? AND started_by = ?').get(session_id, professorId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found or unauthorized.' });
    }

    // Cancel server-side stage timer
    clearSessionTimer(Number(session_id));

    db.prepare("UPDATE attendance_sessions SET status = 'ENDED' WHERE id = ?").run(session_id);
    db.prepare("UPDATE qr_tokens SET is_active = 0 WHERE session_id = ?").run(session_id);

    logAuditEvent('SESSION_END', professorId, session_id, 'Ended session', req.ip);

    if (ioInstance) {
      ioInstance.emit('session_ended', { session_id });
    }

    return res.json({ message: 'Attendance session ended successfully.' });
  } catch (error) {
    console.error('endSession error:', error);
    return res.status(500).json({ error: 'Failed to end session.' });
  }
}

/**
 * STUDENT: Start attendance attempt
 */
export function startAttempt(req, res) {
  try {
    const { session_id, face_token } = req.body;
    const studentId = req.user.id;

    if (!session_id) {
      return res.status(400).json({ error: 'Session ID is required.' });
    }

    // --- Face Token Verification (required before every attempt) ---
    if (!face_token) {
      return res.status(403).json({
        error: 'Face verification required. Please verify your face before starting attendance.'
      });
    }
    const now = new Date();
    const faceTokenRecord = db.prepare(
      'SELECT token, expires_at FROM face_tokens WHERE student_id = ?'
    ).get(studentId);

    if (!faceTokenRecord || faceTokenRecord.token !== face_token) {
      return res.status(403).json({
        error: 'Invalid face token. Please verify your face again.'
      });
    }
    if (new Date(faceTokenRecord.expires_at) < now) {
      return res.status(403).json({
        error: 'Face token expired. Please verify your face again.'
      });
    }
    // Immediately invalidate the token after use (one-use)
    db.prepare('DELETE FROM face_tokens WHERE student_id = ?').run(studentId);
    // ---

    const session = db.prepare(`
      SELECT s.*, c.name as course_name, c.course_code
      FROM attendance_sessions s
      JOIN courses c ON s.course_id = c.id
      WHERE s.id = ?
    `).get(session_id);

    if (!session) {
      return res.status(404).json({ error: 'Attendance session not found.' });
    }

    if (session.status !== 'ACTIVE') {
      return res.status(400).json({ error: 'This attendance session has ended or is inactive.' });
    }

    if (new Date(session.expiry_time) < now) {
      db.prepare("UPDATE attendance_sessions SET status = 'EXPIRED' WHERE id = ?").run(session_id);
      return res.status(400).json({ error: 'This attendance session has expired.' });
    }

    // Verify enrollment
    const enrollment = db.prepare('SELECT 1 FROM enrollments WHERE student_id = ? AND course_id = ?').get(studentId, session.course_id);
    if (!enrollment) {
      return res.status(403).json({ error: 'You are not enrolled in this course.' });
    }

    // Check if already completed attendance or marked absent
    const existingRecord = db.prepare('SELECT id, status FROM attendance_records WHERE session_id = ? AND student_id = ?').get(session_id, studentId);
    if (existingRecord) {
      if (existingRecord.status === 'ABSENT') {
        return res.status(403).json({ error: 'You have been marked absent because you left the attendance page.' });
      }
      return res.status(409).json({ error: 'Attendance has already been recorded for this session.' });
    }

    // Expiry for individual attempt is capped at session expiry
    const attemptTimeoutSeconds = Math.min(180, Math.floor((new Date(session.expiry_time) - now) / 1000));
    const attemptExpiry = new Date(now.getTime() + attemptTimeoutSeconds * 1000).toISOString();

    // Create or reset active attempt
    db.prepare(`
      INSERT INTO attendance_attempts (session_id, student_id, current_stage, started_at, expires_at, status)
      VALUES (?, ?, 0, ?, ?, 'IN_PROGRESS')
      ON CONFLICT(student_id, session_id) DO UPDATE SET
        current_stage = 0,
        started_at = excluded.started_at,
        expires_at = excluded.expires_at,
        status = 'IN_PROGRESS'
    `).run(session_id, studentId, now.toISOString(), attemptExpiry);

    logAuditEvent('ATTEMPT_START', studentId, session_id, 'Started attendance attempt', req.ip);

    return res.status(201).json({
      message: 'Attendance attempt started.',
      attempt: {
        session_id,
        student_id: studentId,
        current_stage: 0,
        expires_at: attemptExpiry,
        status: 'IN_PROGRESS'
      }
    });
  } catch (error) {
    console.error('startAttempt error:', error);
    return res.status(500).json({ error: 'Failed to start attendance attempt.' });
  }
}

/**
 * STUDENT: Process scanned QR token
 */
export function processScan(req, res) {
  try {
    const { scanned_data, token: rawToken, session_id: reqSessionId } = req.body;
    const studentId = req.user.id;

    let scannedObj = parseQRScannedData(scanned_data);
    let tokenStr = rawToken;
    let sessionId = reqSessionId;
    let scannedStage = null;

    if (scannedObj) {
      tokenStr = scannedObj.token;
      sessionId = scannedObj.session_id;
      scannedStage = Number(scannedObj.stage);
    }

    if (!tokenStr || !sessionId) {
      logAuditEvent('SCAN_INVALID_FORMAT', studentId, sessionId, 'Unparseable QR code scan payload', req.ip);
      return res.status(400).json({ error: 'Invalid QR code format.' });
    }

    const now = new Date();

    // 1. Fetch Session
    const session = db.prepare('SELECT * FROM attendance_sessions WHERE id = ?').get(sessionId);
    if (!session) {
      logAuditEvent('SCAN_SESSION_NOT_FOUND', studentId, sessionId, 'QR belongs to non-existent session', req.ip);
      return res.status(404).json({ error: 'Attendance session not found.' });
    }

    if (session.status !== 'ACTIVE') {
      return res.status(400).json({ error: `This attendance session is ${session.status.toLowerCase()}.` });
    }

    // 2. Fetch Student Attempt & Status
    const attempt = db.prepare('SELECT * FROM attendance_attempts WHERE session_id = ? AND student_id = ?').get(sessionId, studentId);
    if (!attempt) {
      return res.status(400).json({ error: 'No active attendance attempt found. Please start attendance attempt first.' });
    }

    if (attempt.status === 'INVALIDATED') {
      return res.status(400).json({ error: 'Your attendance attempt was invalidated (app closed or tab switched). You have been marked absent.' });
    }

    if (attempt.status === 'COMPLETED') {
      return res.status(409).json({ error: 'Attendance has already been recorded for this session.' });
    }

    const existingRecord = db.prepare('SELECT status FROM attendance_records WHERE session_id = ? AND student_id = ?').get(sessionId, studentId);
    if (existingRecord && existingRecord.status === 'ABSENT') {
      return res.status(403).json({ error: 'You have been marked absent because you left the attendance page.' });
    }
    if (existingRecord && existingRecord.status === 'PRESENT') {
      return res.status(409).json({ error: 'Attendance has already been recorded for this session.' });
    }

    if (new Date(attempt.expires_at) < now) {
      db.prepare("UPDATE attendance_attempts SET status = 'EXPIRED' WHERE id = ?").run(attempt.id);
      logAuditEvent('SCAN_ATTEMPT_EXPIRED', studentId, sessionId, 'Attempt expired before scan completion', req.ip);
      return res.status(408).json({ error: 'This attendance attempt has expired. Please restart.' });
    }

    // 3. Verify Token from DB
    const qrTokenRecord = db.prepare('SELECT * FROM qr_tokens WHERE token = ? AND session_id = ? AND is_active = 1').get(tokenStr, sessionId);
    if (!qrTokenRecord) {
      logAuditEvent('SCAN_INVALID_TOKEN', studentId, sessionId, `Token not active or invalid: ${tokenStr}`, req.ip);
      return res.status(400).json({ error: 'Invalid or old QR code. Please scan the current code displayed on screen.' });
    }

    if (new Date(qrTokenRecord.expires_at) < now) {
      logAuditEvent('SCAN_EXPIRED_TOKEN', studentId, sessionId, 'QR Token expired', req.ip);
      return res.status(400).json({ error: 'This QR code has expired. Please scan the newly generated QR code.' });
    }

    const tokenStage = Number(qrTokenRecord.stage);

    // 4. SEQUENCE VALIDATION Logic
    const expectedStage = attempt.current_stage + 1;

    // Rescan of currently validated stage
    if (tokenStage === attempt.current_stage && tokenStage > 0) {
      return res.json({
        message: `Stage ${tokenStage} already scanned successfully.`,
        current_stage: attempt.current_stage,
        completed: false
      });
    }

    // Wrong stage sequence
    if (tokenStage !== expectedStage) {
      logAuditEvent('SCAN_WRONG_SEQUENCE', studentId, sessionId, `Attempted stage ${tokenStage} while expected ${expectedStage}`, req.ip);
      return res.status(400).json({
        error: `Sequence error! You must scan QR Stage ${expectedStage} next (Scanned Stage ${tokenStage}).`
      });
    }

    // 5. STAGE TRANSITION (1 -> 2 -> 3)
    if (tokenStage < 3) {
      db.prepare(`
        UPDATE attendance_attempts
        SET current_stage = ?
        WHERE id = ?
      `).run(tokenStage, attempt.id);

      logAuditEvent('STAGE_COMPLETED', studentId, sessionId, `Student completed stage ${tokenStage}`, req.ip);

      return res.json({
        message: `Stage ${tokenStage} of 3 completed! Now scan Stage ${tokenStage + 1}.`,
        current_stage: tokenStage,
        completed: false
      });
    }

    // STAGE 3 SUCCESS -> ATOMIC ATTENDANCE COMMIT
    if (tokenStage === 3) {
      // Execute in isolated atomic step
      db.prepare(`
        UPDATE attendance_attempts
        SET current_stage = 3, status = 'COMPLETED'
        WHERE id = ?
      `).run(attempt.id);

      db.prepare(`
        INSERT INTO attendance_records (session_id, student_id, marked_at, status)
        VALUES (?, ?, ?, 'PRESENT')
      `).run(sessionId, studentId, now.toISOString());

      logAuditEvent('ATTENDANCE_MARKED', studentId, sessionId, 'Successfully completed 3-stage sequence and marked present', req.ip);

      const studentUser = db.prepare('SELECT name, email FROM users WHERE id = ?').get(studentId);

      // Broadcast live event to Professor dashboard
      if (ioInstance) {
        ioInstance.emit('attendance_recorded', {
          session_id: sessionId,
          student_id: studentId,
          student_name: studentUser.name,
          student_email: studentUser.email,
          marked_at: now.toISOString()
        });
      }

      return res.json({
        message: 'Attendance marked successfully!',
        current_stage: 3,
        completed: true,
        marked_at: now.toISOString()
      });
    }
  } catch (error) {
    console.error('processScan error:', error);
    return res.status(500).json({ error: 'Failed to process QR scan.' });
  }
}

/**
 * STUDENT: Invalidate attempt on app background/exit/tab-switch
 */
export function invalidateAttempt(req, res) {
  try {
    const { session_id } = req.body;
    const studentId = req.user.id;

    if (!session_id) {
      return res.status(400).json({ error: 'Session ID is required.' });
    }

    const result = db.prepare(`
      UPDATE attendance_attempts
      SET status = 'INVALIDATED'
      WHERE session_id = ? AND student_id = ? AND status = 'IN_PROGRESS'
    `).run(session_id, studentId);

    if (result.changes > 0) {
      logAuditEvent('ATTEMPT_INVALIDATED', studentId, session_id, 'Attempt invalidated due to app backgrounding / tab blur', req.ip);
      // Mark the student ABSENT (only if not already PRESENT)
      markStudentAbsent(Number(session_id), studentId, 'Tab switched or app closed', req.ip);
    }

    return res.json({ message: 'Attendance attempt invalidated.' });
  } catch (error) {
    console.error('invalidateAttempt error:', error);
    return res.status(500).json({ error: 'Failed to invalidate attempt.' });
  }
}

/**
 * STUDENT: Heartbeat ping to prove continued presence
 */
export function studentHeartbeat(req, res) {
  try {
    const { session_id } = req.body;
    const studentId = req.user.id;

    if (!session_id) return res.status(400).json({ error: 'session_id required.' });

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE attendance_attempts
      SET last_heartbeat_at = ?
      WHERE session_id = ? AND student_id = ? AND status = 'IN_PROGRESS'
    `).run(now, session_id, studentId);

    return res.json({ ok: true });
  } catch (e) {
    console.error('heartbeat error:', e);
    return res.status(500).json({ error: 'Heartbeat failed.' });
  }
}

/**
 * STUDENT: Mark self absent via sendBeacon on tab unload.
 * Accepts both application/json and text/plain (sendBeacon compatible).
 */
export function markAbsentBeacon(req, res) {
  try {
    let session_id = req.body && req.body.session_id;

    // sendBeacon may send raw text/plain body
    if (!session_id && typeof req.body === 'string') {
      try { session_id = JSON.parse(req.body).session_id; } catch (_) { session_id = req.body.trim(); }
    }

    const studentId = req.user.id;

    if (!session_id) return res.status(400).json({ error: 'session_id required.' });

    markStudentAbsent(Number(session_id), studentId, 'Tab-switch beacon fired', req.ip);
    return res.json({ ok: true });
  } catch (e) {
    console.error('markAbsentBeacon error:', e);
    return res.status(500).json({ error: 'Failed to mark absent.' });
  }
}

/**
 * Get active session for course or student
 */
export async function getActiveSession(req, res) {
  try {
    const { course_id } = req.query;
    const userId = req.user.id;
    const userRole = req.user.role;

    let session = null;
    if (course_id) {
      session = db.prepare(`
        SELECT s.*, c.name as course_name, c.course_code
        FROM attendance_sessions s
        JOIN courses c ON s.course_id = c.id
        WHERE s.course_id = ? AND s.status = 'ACTIVE'
      `).get(course_id);
    } else {
      // Find active session for any enrolled course
      if (userRole === 'STUDENT') {
        session = db.prepare(`
          SELECT s.*, c.name as course_name, c.course_code
          FROM attendance_sessions s
          JOIN courses c ON s.course_id = c.id
          JOIN enrollments e ON c.id = e.course_id
          WHERE e.student_id = ? AND s.status = 'ACTIVE'
          ORDER BY s.start_time DESC LIMIT 1
        `).get(userId);
      } else {
        session = db.prepare(`
          SELECT s.*, c.name as course_name, c.course_code
          FROM attendance_sessions s
          JOIN courses c ON s.course_id = c.id
          WHERE s.started_by = ? AND s.status = 'ACTIVE'
          ORDER BY s.start_time DESC LIMIT 1
        `).get(userId);
      }
    }

    if (!session) {
      return res.json({ session: null });
    }

    // Auto-advance if server wall clock has passed stage expiry
    if (session.status === 'ACTIVE' && session.qr_stage_expires_at) {
      const now = new Date();
      if (new Date(session.qr_stage_expires_at) <= now) {
        await handleStageExpiry(session.id, session.current_stage);
        // Reload session after transition
        session = db.prepare(`
          SELECT s.*, c.name as course_name, c.course_code
          FROM attendance_sessions s
          JOIN courses c ON s.course_id = c.id
          WHERE s.id = ? AND s.status = 'ACTIVE'
        `).get(session.id);
      } else if (!sessionTimers.has(session.id)) {
        // Restore timer if server restarted
        const remainingMs = Math.max(0, new Date(session.qr_stage_expires_at) - now);
        scheduleStageExpiry(session.id, session.current_stage, remainingMs);
      }
    }

    if (!session) {
      return res.json({ session: null });
    }

    // Fetch active QR code
    const activeToken = db.prepare('SELECT * FROM qr_tokens WHERE session_id = ? AND stage = ? AND is_active = 1').get(session.id, session.current_stage);

    let qrObj = null;
    if (activeToken) {
      try {
        const payload = JSON.stringify({
          session_id: session.id,
          stage: session.current_stage,
          token: activeToken.token,
          expires_at: activeToken.expires_at
        });
        const qrDataUrl = await QRCode.toDataURL(payload, {
          errorCorrectionLevel: 'H',
          margin: 2,
          width: 380,
          color: { dark: '#0f172a', light: '#ffffff' }
        });
        qrObj = {
          token: activeToken.token,
          stage: session.current_stage,
          expires_at: activeToken.expires_at,
          qrDataUrl
        };
      } catch (qrErr) {
        console.warn('Failed to generate active QR data URL:', qrErr);
      }
    }

    let studentAttempt = null;
    let isMarked = false;
    let studentRecord = null;

    if (userRole === 'STUDENT') {
      studentAttempt = db.prepare('SELECT * FROM attendance_attempts WHERE session_id = ? AND student_id = ?').get(session.id, userId);
      studentRecord = db.prepare('SELECT marked_at, status FROM attendance_records WHERE session_id = ? AND student_id = ?').get(session.id, userId);
      if (studentRecord && studentRecord.status === 'PRESENT') isMarked = true;
    }

    // Count completed attendance
    const completedCount = db.prepare("SELECT COUNT(*) as count FROM attendance_records WHERE session_id = ? AND status = 'PRESENT'").get(session.id).count;

    return res.json({
      session: {
        ...session,
        qr: qrObj,
        qr_token: activeToken ? activeToken.token : null,
        qr_expires_at: activeToken ? activeToken.expires_at : null,
        qr_stage_expires_at: session.qr_stage_expires_at || null,
        stage_timeout_seconds: session.stage_timeout_seconds || null,
        completed_count: completedCount,
        student_attempt: studentAttempt,
        student_record: studentRecord,
        is_absent: studentRecord ? studentRecord.status === 'ABSENT' : false,
        is_marked: isMarked
      }
    });
  } catch (error) {
    console.error('getActiveSession error:', error);
    return res.status(500).json({ error: 'Failed to fetch active session.' });
  }
}

/**
 * PROFESSOR: Get Session Results & Attendee list
 */
export function getSessionResults(req, res) {
  try {
    const { session_id } = req.params;
    const professorId = req.user.id;

    const session = db.prepare(`
      SELECT s.*, c.name as course_name, c.course_code
      FROM attendance_sessions s
      JOIN courses c ON s.course_id = c.id
      WHERE s.id = ? AND s.started_by = ?
    `).get(session_id, professorId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found or unauthorized.' });
    }

    const enrolledStudents = db.prepare(`
      SELECT u.id, u.name, u.email,
        r.marked_at,
        COALESCE(r.status, 'ABSENT') AS attendance_status,
        a.current_stage AS attempt_stage,
        a.status AS attempt_status
      FROM enrollments e
      JOIN users u ON e.student_id = u.id
      LEFT JOIN attendance_records r ON r.session_id = ? AND r.student_id = u.id
      LEFT JOIN attendance_attempts a ON a.session_id = ? AND a.student_id = u.id
      WHERE e.course_id = ?
      ORDER BY u.name ASC
    `).all(session_id, session_id, session.course_id);

    return res.json({
      session,
      students: enrolledStudents
    });
  } catch (error) {
    console.error('getSessionResults error:', error);
    return res.status(500).json({ error: 'Failed to fetch session results.' });
  }
}

/**
 * STUDENT: Get my attendance history
 */
export function getStudentHistory(req, res) {
  try {
    const studentId = req.user.id;

    const history = db.prepare(`
      SELECT r.id, r.marked_at, r.status,
             c.course_code, c.name as course_name,
             s.start_time as session_date
      FROM attendance_records r
      JOIN attendance_sessions s ON r.session_id = s.id
      JOIN courses c ON s.course_id = c.id
      WHERE r.student_id = ?
      ORDER BY r.marked_at DESC
    `).all(studentId);

    return res.json({ history });
  } catch (error) {
    console.error('getStudentHistory error:', error);
    return res.status(500).json({ error: 'Failed to fetch attendance history.' });
  }
}
