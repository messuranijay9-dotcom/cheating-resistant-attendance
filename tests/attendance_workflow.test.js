import test from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import db, { initDatabase } from '../src/db/database.js';
import { JWT_SECRET } from '../src/middleware/auth.js';
import authRoutes from '../src/routes/authRoutes.js';
import courseRoutes from '../src/routes/courseRoutes.js';
import attendanceRoutes from '../src/routes/attendanceRoutes.js';
import { generateQRStageToken } from '../src/services/qrService.js';
import { seedDatabase } from '../src/db/seed.js';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/attendance', attendanceRoutes);

let profId, s1Id, s2Id, s3Id;
let server, port;
let profToken, student1Token, student2Token, student3Token;
let courseId;

async function apiCall(path, method = 'GET', body = null, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`http://localhost:${port}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null
  });

  const data = await res.json();
  return { status: res.status, data };
}

test.before(async () => {
  initDatabase();

  db.exec('DELETE FROM audit_logs');
  db.exec('DELETE FROM attendance_records');
  db.exec('DELETE FROM attendance_attempts');
  db.exec('DELETE FROM qr_tokens');
  db.exec('DELETE FROM attendance_sessions');
  db.exec('DELETE FROM enrollments');
  db.exec('DELETE FROM courses');
  db.exec('DELETE FROM users');

  const passwordHash = bcrypt.hashSync('password123', 10);

  const profRes = db.prepare(`INSERT INTO users (name, email, password_hash, role) VALUES ('Prof Workflow', 'prof_wf@edu.com', ?, 'PROFESSOR')`).run(passwordHash);
  const s1Res = db.prepare(`INSERT INTO users (name, email, password_hash, role) VALUES ('Alice WF', 'alice_wf@edu.com', ?, 'STUDENT')`).run(passwordHash);
  const s2Res = db.prepare(`INSERT INTO users (name, email, password_hash, role) VALUES ('Bob WF', 'bob_wf@edu.com', ?, 'STUDENT')`).run(passwordHash);
  const s3Res = db.prepare(`INSERT INTO users (name, email, password_hash, role) VALUES ('Charlie WF', 'charlie_wf@edu.com', ?, 'STUDENT')`).run(passwordHash);

  profId = Number(profRes.lastInsertRowid);
  s1Id = Number(s1Res.lastInsertRowid);
  s2Id = Number(s2Res.lastInsertRowid);
  s3Id = Number(s3Res.lastInsertRowid);

  const courseRes = db.prepare(`INSERT INTO courses (course_code, name, professor_id) VALUES ('WF101', 'Workflow Test Course', ?)`).run(profId);
  courseId = Number(courseRes.lastInsertRowid);

  db.prepare(`INSERT INTO enrollments (student_id, course_id) VALUES (?, ?)`).run(s1Id, courseId);
  db.prepare(`INSERT INTO enrollments (student_id, course_id) VALUES (?, ?)`).run(s2Id, courseId);
  db.prepare(`INSERT INTO enrollments (student_id, course_id) VALUES (?, ?)`).run(s3Id, courseId);

  profToken = jwt.sign({ id: profId, email: 'prof_wf@edu.com', name: 'Prof Workflow', role: 'PROFESSOR' }, JWT_SECRET, { expiresIn: '1h' });
  student1Token = jwt.sign({ id: s1Id, email: 'alice_wf@edu.com', name: 'Alice WF', role: 'STUDENT' }, JWT_SECRET, { expiresIn: '1h' });
  student2Token = jwt.sign({ id: s2Id, email: 'bob_wf@edu.com', name: 'Bob WF', role: 'STUDENT' }, JWT_SECRET, { expiresIn: '1h' });
  student3Token = jwt.sign({ id: s3Id, email: 'charlie_wf@edu.com', name: 'Charlie WF', role: 'STUDENT' }, JWT_SECRET, { expiresIn: '1h' });

  await new Promise((resolve) => {
    server = http.createServer(app).listen(0, () => {
      port = server.address().port;
      resolve();
    });
  });
});

test.after(() => {
  if (server) server.close();
  seedDatabase();
});

test('Test 1 & 2: Automatic progression from QR 1 -> QR 2 -> QR 3 -> session ends automatically', async () => {
  // Start session with short stage duration
  const startRes = await apiCall('/api/attendance/session/start', 'POST', {
    course_id: courseId,
    timeout_seconds: 3 // 1s per stage
  }, profToken);

  assert.strictEqual(startRes.status, 201);
  const sessionId = startRes.data.session.id;
  assert.strictEqual(startRes.data.session.current_stage, 1);

  // Wait 1.3s for Stage 1 to expire and auto-advance to Stage 2
  await new Promise(r => setTimeout(r, 1300));
  let sRes = await apiCall('/api/attendance/session/active', 'GET', null, profToken);
  assert.ok(sRes.data.session);
  assert.strictEqual(sRes.data.session.current_stage, 2);

  // Wait 1.3s for Stage 2 to expire and auto-advance to Stage 3
  await new Promise(r => setTimeout(r, 1300));
  sRes = await apiCall('/api/attendance/session/active', 'GET', null, profToken);
  assert.ok(sRes.data.session);
  assert.strictEqual(sRes.data.session.current_stage, 3);

  // Wait 1.3s for Stage 3 to expire and auto-end the session
  await new Promise(r => setTimeout(r, 1300));
  sRes = await apiCall('/api/attendance/session/active', 'GET', null, profToken);
  assert.strictEqual(sRes.data.session, null); // Session automatically completed and no longer ACTIVE

  const dbSession = db.prepare('SELECT status FROM attendance_sessions WHERE id = ?').get(sessionId);
  assert.strictEqual(dbSession.status, 'ENDED');
});

test('Test 3: First QR scan succeeds once and ignores duplicate requests idempotently', async () => {
  const startRes = await apiCall('/api/attendance/session/start', 'POST', {
    course_id: courseId,
    timeout_seconds: 180
  }, profToken);
  const sessionId = startRes.data.session.id;

  // Face token setup & attempt start
  const exp = new Date(Date.now() + 300000).toISOString();
  db.prepare("INSERT OR REPLACE INTO face_tokens (student_id, token, expires_at) VALUES (?, 'face-alice', ?)").run(s1Id, exp);
  await apiCall('/api/attendance/attempt/start', 'POST', { session_id: sessionId, face_token: 'face-alice' }, student1Token);

  const qr1Token = db.prepare('SELECT token FROM qr_tokens WHERE session_id = ? AND stage = 1 AND is_active = 1').get(sessionId).token;

  // Scan 1
  const scan1 = await apiCall('/api/attendance/scan', 'POST', { session_id: sessionId, token: qr1Token }, student1Token);
  assert.strictEqual(scan1.status, 200);
  assert.strictEqual(scan1.data.current_stage, 1);

  // Repeat scan 1 (same token)
  const scan1Repeat = await apiCall('/api/attendance/scan', 'POST', { session_id: sessionId, token: qr1Token }, student1Token);
  assert.strictEqual(scan1Repeat.status, 200);
  assert.strictEqual(scan1Repeat.data.current_stage, 1);
  assert.match(scan1Repeat.data.message, /already scanned/i);
});

test('Test 4: Expired QR code is rejected and cannot be used to record attendance', async () => {
  const activeRes = await apiCall('/api/attendance/session/active', 'GET', null, profToken);
  const sessionId = activeRes.data.session.id;

  // Create an expired QR token directly
  const expiredTime = new Date(Date.now() - 5000).toISOString();
  db.prepare("INSERT INTO qr_tokens (session_id, stage, token, expires_at, is_active) VALUES (?, 2, 'expired-token-123', ?, 1)").run(sessionId, expiredTime);

  const scanRes = await apiCall('/api/attendance/scan', 'POST', { session_id: sessionId, token: 'expired-token-123' }, student1Token);
  assert.strictEqual(scanRes.status, 400);
  assert.match(scanRes.data.error, /expired/i);
});

test('Test 5: Tab switching marks student ABSENT and prevents regaining PRESENT status', async () => {
  const activeRes = await apiCall('/api/attendance/session/active', 'GET', null, profToken);
  const sessionId = activeRes.data.session.id;

  // Student 2 starts attempt
  const exp = new Date(Date.now() + 300000).toISOString();
  db.prepare("INSERT OR REPLACE INTO face_tokens (student_id, token, expires_at) VALUES (?, 'face-bob', ?)").run(s2Id, exp);
  await apiCall('/api/attendance/attempt/start', 'POST', { session_id: sessionId, face_token: 'face-bob' }, student2Token);

  // Student 2 switches tabs -> triggers leave / invalidate
  const leaveRes = await apiCall('/api/attendance/attempt/invalidate', 'POST', { session_id: sessionId }, student2Token);
  assert.strictEqual(leaveRes.status, 200);

  // Verify DB record is persisted as ABSENT
  const rec = db.prepare('SELECT status FROM attendance_records WHERE session_id = ? AND student_id = ?').get(sessionId, s2Id);
  assert.ok(rec);
  assert.strictEqual(rec.status, 'ABSENT');

  // Verify Student 2 cannot scan or restart attempt
  const qr1Token = db.prepare('SELECT token FROM qr_tokens WHERE session_id = ? AND stage = 1 AND is_active = 1').get(sessionId).token;
  const scanAttempt = await apiCall('/api/attendance/scan', 'POST', { session_id: sessionId, token: qr1Token }, student2Token);
  assert.strictEqual(scanAttempt.status, 400);
  assert.match(scanAttempt.data.error, /invalidated|absent/i);

  // Verify restart attempt is rejected
  db.prepare("INSERT OR REPLACE INTO face_tokens (student_id, token, expires_at) VALUES (?, 'face-bob-2', ?)").run(s2Id, exp);
  const restartAttempt = await apiCall('/api/attendance/attempt/start', 'POST', { session_id: sessionId, face_token: 'face-bob-2' }, student2Token);
  assert.strictEqual(restartAttempt.status, 403);
  assert.match(restartAttempt.data.error, /absent/i);
});

test('Test 6: Student Heartbeat tracking', async () => {
  const activeRes = await apiCall('/api/attendance/session/active', 'GET', null, profToken);
  const sessionId = activeRes.data.session.id;

  // Student 3 starts attempt
  const exp = new Date(Date.now() + 300000).toISOString();
  db.prepare("INSERT OR REPLACE INTO face_tokens (student_id, token, expires_at) VALUES (?, 'face-charlie', ?)").run(s3Id, exp);
  await apiCall('/api/attendance/attempt/start', 'POST', { session_id: sessionId, face_token: 'face-charlie' }, student3Token);

  // Send heartbeat
  const hbRes = await apiCall('/api/attendance/heartbeat', 'POST', { session_id: sessionId }, student3Token);
  assert.strictEqual(hbRes.status, 200);
  assert.strictEqual(hbRes.data.ok, true);

  const attempt = db.prepare('SELECT last_heartbeat_at FROM attendance_attempts WHERE session_id = ? AND student_id = ?').get(sessionId, s3Id);
  assert.ok(attempt.last_heartbeat_at);
});

test('Test 7: Refresh and Reconnection restores session state', async () => {
  const activeRes = await apiCall('/api/attendance/session/active', 'GET', null, profToken);
  assert.ok(activeRes.data.session);
  assert.strictEqual(activeRes.data.session.status, 'ACTIVE');
  assert.strictEqual(activeRes.data.session.current_stage, 1);
  assert.ok(activeRes.data.session.qr_stage_expires_at);

  const studentRes = await apiCall('/api/attendance/session/active', 'GET', null, student3Token);
  assert.ok(studentRes.data.session);
  assert.strictEqual(studentRes.data.session.student_attempt.status, 'IN_PROGRESS');
});

test('Test 8, 9 & 10: Multiple students independent tracking, sequential scan completion, and results view', async () => {
  const activeRes = await apiCall('/api/attendance/session/active', 'GET', null, profToken);
  const sessionId = activeRes.data.session.id;

  // Student 1 (Alice) already scanned Stage 1. Now professor advances to Stage 2
  await apiCall('/api/attendance/session/advance', 'POST', { session_id: sessionId, target_stage: 2 }, profToken);
  const qr2Token = db.prepare('SELECT token FROM qr_tokens WHERE session_id = ? AND stage = 2 AND is_active = 1').get(sessionId).token;
  const scan2 = await apiCall('/api/attendance/scan', 'POST', { session_id: sessionId, token: qr2Token }, student1Token);
  assert.strictEqual(scan2.status, 200);
  assert.strictEqual(scan2.data.current_stage, 2);

  // Advance to Stage 3
  await apiCall('/api/attendance/session/advance', 'POST', { session_id: sessionId, target_stage: 3 }, profToken);
  const qr3Token = db.prepare('SELECT token FROM qr_tokens WHERE session_id = ? AND stage = 3 AND is_active = 1').get(sessionId).token;
  const scan3 = await apiCall('/api/attendance/scan', 'POST', { session_id: sessionId, token: qr3Token }, student1Token);
  assert.strictEqual(scan3.status, 200);
  assert.strictEqual(scan3.data.completed, true);

  // Check professor results view
  const resultsRes = await apiCall(`/api/attendance/session/results/${sessionId}`, 'GET', null, profToken);
  assert.strictEqual(resultsRes.status, 200);
  const students = resultsRes.data.students;

  const alice = students.find(s => s.id === s1Id);
  const bob = students.find(s => s.id === s2Id);

  // Alice successfully completed all 3 stages -> PRESENT
  assert.strictEqual(alice.attendance_status, 'PRESENT');
  // Bob switched tabs -> ABSENT
  assert.strictEqual(bob.attendance_status, 'ABSENT');
});

