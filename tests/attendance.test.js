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

// Setup Test Server
const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/attendance', attendanceRoutes);

let profId;
let s1Id;
let s2Id;
let server;
let port;
let profToken;
let student1Token;
let student2Token;
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

  // Reset Test Tables
  db.exec('DELETE FROM audit_logs');
  db.exec('DELETE FROM attendance_records');
  db.exec('DELETE FROM attendance_attempts');
  db.exec('DELETE FROM qr_tokens');
  db.exec('DELETE FROM attendance_sessions');
  db.exec('DELETE FROM enrollments');
  db.exec('DELETE FROM courses');
  db.exec('DELETE FROM users');

  const passwordHash = bcrypt.hashSync('password123', 10);

  // Insert Users
  const profRes = db.prepare(`INSERT INTO users (name, email, password_hash, role) VALUES ('Prof Test', 'prof_test@edu.com', ?, 'PROFESSOR')`).run(passwordHash);
  const s1Res = db.prepare(`INSERT INTO users (name, email, password_hash, role) VALUES ('Student Test 1', 's1_test@edu.com', ?, 'STUDENT')`).run(passwordHash);
  const s2Res = db.prepare(`INSERT INTO users (name, email, password_hash, role) VALUES ('Student Test 2', 's2_test@edu.com', ?, 'STUDENT')`).run(passwordHash);

  profId = Number(profRes.lastInsertRowid);
  s1Id = Number(s1Res.lastInsertRowid);
  s2Id = Number(s2Res.lastInsertRowid);

  // Insert Course
  const courseRes = db.prepare(`INSERT INTO courses (course_code, name, professor_id) VALUES ('TEST101', 'Test Course', ?)`).run(profId);
  courseId = Number(courseRes.lastInsertRowid);

  // Enroll Students
  db.prepare(`INSERT INTO enrollments (student_id, course_id) VALUES (?, ?)`).run(s1Id, courseId);
  db.prepare(`INSERT INTO enrollments (student_id, course_id) VALUES (?, ?)`).run(s2Id, courseId);

  // Generate Tokens
  profToken = jwt.sign({ id: profId, email: 'prof_test@edu.com', name: 'Prof Test', role: 'PROFESSOR' }, JWT_SECRET, { expiresIn: '1h' });
  student1Token = jwt.sign({ id: s1Id, email: 's1_test@edu.com', name: 'Student Test 1', role: 'STUDENT' }, JWT_SECRET, { expiresIn: '1h' });
  student2Token = jwt.sign({ id: s2Id, email: 's2_test@edu.com', name: 'Student Test 2', role: 'STUDENT' }, JWT_SECRET, { expiresIn: '1h' });

  // Start HTTP server on random free port
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

test('1. Role Authorization: Student cannot start attendance session', async () => {
  const { status } = await apiCall('/api/attendance/session/start', 'POST', { course_id: courseId }, student1Token);
  assert.strictEqual(status, 403);
});

test('2. Professor starts attendance session & generates Stage 1 QR code', async () => {
  const { status, data } = await apiCall('/api/attendance/session/start', 'POST', { course_id: courseId, timeout_seconds: 120 }, profToken);
  assert.strictEqual(status, 201);
  assert.strictEqual(data.session.current_stage, 1);
  assert.ok(data.session.qr.token);
});

test('3. Security Check: Out of order scan (QR 2 before QR 1)', async () => {
  const activeSessionRes = await apiCall('/api/attendance/session/active', 'GET', null, student1Token);
  const sessionId = activeSessionRes.data.session.id;

  // Student 1 face token & starts attempt
  const exp = new Date(Date.now() + 300000).toISOString();
  db.prepare("INSERT OR REPLACE INTO face_tokens (student_id, token, expires_at) VALUES (?, 'face-token-s1', ?)").run(s1Id, exp);
  await apiCall('/api/attendance/attempt/start', 'POST', { session_id: sessionId, face_token: 'face-token-s1' }, student1Token);

  // Generate fake QR 2 token
  const qr2Data = await generateQRStageToken(sessionId, 2, 60);

  // Attempt scan QR 2 while current_stage is 0
  const scanRes = await apiCall('/api/attendance/scan', 'POST', {
    session_id: sessionId,
    token: qr2Data.token
  }, student1Token);

  assert.strictEqual(scanRes.status, 400);
  assert.match(scanRes.data.error, /Sequence error/i);
});

test('4. Sequential Scan Flow: QR1 -> QR2 -> QR3 Success', async () => {
  const activeSessionRes = await apiCall('/api/attendance/session/active', 'GET', null, student1Token);
  const sessionId = activeSessionRes.data.session.id;

  // 1. Scan Stage 1
  const qr1Data = db.prepare('SELECT token FROM qr_tokens WHERE session_id = ? AND stage = 1 AND is_active = 1').get(sessionId);
  const scan1 = await apiCall('/api/attendance/scan', 'POST', { session_id: sessionId, token: qr1Data.token }, student1Token);
  assert.strictEqual(scan1.status, 200);
  assert.strictEqual(scan1.data.current_stage, 1);

  // 2. Professor advances to Stage 2
  await apiCall('/api/attendance/session/advance', 'POST', { session_id: sessionId, target_stage: 2 }, profToken);
  const qr2Data = db.prepare('SELECT token FROM qr_tokens WHERE session_id = ? AND stage = 2 AND is_active = 1').get(sessionId);
  const scan2 = await apiCall('/api/attendance/scan', 'POST', { session_id: sessionId, token: qr2Data.token }, student1Token);
  assert.strictEqual(scan2.status, 200);
  assert.strictEqual(scan2.data.current_stage, 2);

  // 3. Professor advances to Stage 3
  await apiCall('/api/attendance/session/advance', 'POST', { session_id: sessionId, target_stage: 3 }, profToken);
  const qr3Data = db.prepare('SELECT token FROM qr_tokens WHERE session_id = ? AND stage = 3 AND is_active = 1').get(sessionId);
  const scan3 = await apiCall('/api/attendance/scan', 'POST', { session_id: sessionId, token: qr3Data.token }, student1Token);
  assert.strictEqual(scan3.status, 200);
  assert.strictEqual(scan3.data.completed, true);
  assert.match(scan3.data.message, /Attendance marked successfully/i);
});

test('5. Duplicate Attendance Security Check', async () => {
  const activeSessionRes = await apiCall('/api/attendance/session/active', 'GET', null, student1Token);
  const sessionId = activeSessionRes.data.session.id;

  const qr3Data = db.prepare('SELECT token FROM qr_tokens WHERE session_id = ? AND stage = 3').get(sessionId);
  const scanRes = await apiCall('/api/attendance/scan', 'POST', { session_id: sessionId, token: qr3Data.token }, student1Token);

  assert.strictEqual(scanRes.status, 409);
  assert.match(scanRes.data.error, /already been recorded/i);
});

test('6. Attempt Invalidation Security Check on App Backgrounding', async () => {
  const activeSessionRes = await apiCall('/api/attendance/session/active', 'GET', null, student2Token);
  const sessionId = activeSessionRes.data.session.id;

  // Student 2 face token & starts attempt
  const exp2 = new Date(Date.now() + 300000).toISOString();
  db.prepare("INSERT OR REPLACE INTO face_tokens (student_id, token, expires_at) VALUES (?, 'face-token-s2', ?)").run(s2Id, exp2);
  await apiCall('/api/attendance/attempt/start', 'POST', { session_id: sessionId, face_token: 'face-token-s2' }, student2Token);

  // Student 2 triggers backgrounding invalidation ping
  const invRes = await apiCall('/api/attendance/attempt/invalidate', 'POST', { session_id: sessionId }, student2Token);
  assert.strictEqual(invRes.status, 200);

  // Student 2 tries to scan QR token after invalidation -> rejected
  const qr3Data = db.prepare('SELECT token FROM qr_tokens WHERE session_id = ? AND stage = 3').get(sessionId);
  const scanRes = await apiCall('/api/attendance/scan', 'POST', { session_id: sessionId, token: qr3Data.token }, student2Token);

  assert.strictEqual(scanRes.status, 400);
  assert.match(scanRes.data.error, /invalidated/i);
});
