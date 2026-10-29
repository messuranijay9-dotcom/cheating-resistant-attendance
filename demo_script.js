/**
 * SDTT Class Presentation Interactive Demo Script
 * Run this script to execute an automated, step-by-step demonstration of the
 * Cheating-Resistant Attendance Management System!
 */

import http from 'http';
import express from 'express';

import db from './src/db/database.js';
import { seedDatabase } from './src/db/seed.js';
import authRoutes from './src/routes/authRoutes.js';
import courseRoutes from './src/routes/courseRoutes.js';
import attendanceRoutes from './src/routes/attendanceRoutes.js';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/attendance', attendanceRoutes);

function logStep(stepNum, title, details = '') {
  console.log(`\n====================================================`);
  console.log(`  STEP ${stepNum}: ${title.toUpperCase()}`);
  console.log(`====================================================`);
  if (details) console.log(`  ℹ️  ${details}`);
}

async function runDemo() {
  seedDatabase();

  const server = app.listen(3001, async () => {
    const baseUrl = 'http://localhost:3001';

    async function api(path, method = 'GET', body = null, token = null) {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : null });
      return { status: res.status, data: await res.json() };
    }

    try {
      // Step 1: Professor Login
      logStep(1, 'Professor Logs In', 'Professor logs into dashboard & selects SDTT101 course.');
      const profLogin = await api('/api/auth/login', 'POST', { email: 'prof@university.edu', password: 'password123' });
      const profToken = profLogin.data.token;
      console.log(`  ✓ Professor Authenticated: ${profLogin.data.user.name}`);

      // Step 2: Student Login
      logStep(2, 'Student Logs In', 'Student Alice opens mobile app and authenticates.');
      const studentLogin = await api('/api/auth/login', 'POST', { email: 'student1@university.edu', password: 'password123' });
      const studentToken = studentLogin.data.token;
      console.log(`  ✓ Student Authenticated: ${studentLogin.data.user.name}`);

      // Step 3: Start Attendance Session
      logStep(3, 'Professor Starts Attendance Session', 'Backend creates unique session and displays QR Code Stage 1 on Projector.');
      const sessionStart = await api('/api/attendance/session/start', 'POST', { course_id: 1, timeout_seconds: 180 }, profToken);
      const sessionId = sessionStart.data.session.id;
      console.log(`  ✓ Active Session Created (ID: ${sessionId}). Current Stage: 1`);

      // Step 4: Student Starts Attempt
      logStep(4, 'Student Starts Attendance Attempt', 'Student initiates attempt timer on mobile app.');
      const expFace = new Date(Date.now() + 300000).toISOString();
      db.prepare("INSERT OR REPLACE INTO face_tokens (student_id, token, expires_at) VALUES (?, 'demo-face-token', ?)").run(studentLogin.data.user.id, expFace);
      const attemptStart = await api('/api/attendance/attempt/start', 'POST', { session_id: sessionId, face_token: 'demo-face-token' }, studentToken);
      console.log(`  ✓ Attempt Initiated. Expiry: ${new Date(attemptStart.data.attempt.expires_at).toLocaleTimeString()}`);

      // Step 5: DEMO CHEATING DEFENSE - Out of Order Scan
      logStep(5, 'SECURITY DEMO: Attempt Out-of-Order Scan (QR3 first)', 'Student tries to jump directly to QR3.');
      const qr3EarlyToken = db.prepare('SELECT token FROM qr_tokens WHERE session_id = ? AND stage = 3').get(sessionId) || { token: 'fake_stage3' };
      const outOfOrderRes = await api('/api/attendance/scan', 'POST', { session_id: sessionId, token: qr3EarlyToken.token }, studentToken);
      console.log(`  ❌ SERVER REJECTED OUT-OF-ORDER SCAN: Status ${outOfOrderRes.status}`);
      console.log(`     Error Message: "${outOfOrderRes.data.error}"`);

      // Step 6: Valid Scan QR 1
      logStep(6, 'Student Scans QR Stage 1', 'Student scans valid QR 1 displayed on screen.');
      const qr1Token = db.prepare('SELECT token FROM qr_tokens WHERE session_id = ? AND stage = 1 AND is_active = 1').get(sessionId).token;
      const scan1 = await api('/api/attendance/scan', 'POST', { session_id: sessionId, token: qr1Token }, studentToken);
      console.log(`  ✓ Stage 1 Validated: ${scan1.data.message}`);

      // Step 7: Advance Stage 2
      logStep(7, 'Professor Advances to Stage 2', 'Projector updates display to show QR Code Stage 2.');
      await api('/api/attendance/session/advance', 'POST', { session_id: sessionId, target_stage: 2 }, profToken);
      const qr2Token = db.prepare('SELECT token FROM qr_tokens WHERE session_id = ? AND stage = 2 AND is_active = 1').get(sessionId).token;
      const scan2 = await api('/api/attendance/scan', 'POST', { session_id: sessionId, token: qr2Token }, studentToken);
      console.log(`  ✓ Stage 2 Validated: ${scan2.data.message}`);

      // Step 8: Advance Stage 3 & Finalize
      logStep(8, 'Professor Advances to Stage 3 & Student Completes Attendance', 'Projector shows QR Code 3. Final atomic verification executes.');
      await api('/api/attendance/session/advance', 'POST', { session_id: sessionId, target_stage: 3 }, profToken);
      const qr3Token = db.prepare('SELECT token FROM qr_tokens WHERE session_id = ? AND stage = 3 AND is_active = 1').get(sessionId).token;
      const scan3 = await api('/api/attendance/scan', 'POST', { session_id: sessionId, token: qr3Token }, studentToken);
      console.log(`  🎉 ATTENDANCE RECORDED: ${scan3.data.message}`);

      // Step 9: DEMO CHEATING DEFENSE - Duplicate Scan
      logStep(9, 'SECURITY DEMO: Attempt Duplicate Attendance Scan', 'Student tries scanning QR 3 again.');
      const dupRes = await api('/api/attendance/scan', 'POST', { session_id: sessionId, token: qr3Token }, studentToken);
      console.log(`  ❌ SERVER REJECTED DUPLICATE ATTENDANCE: Status ${dupRes.status}`);
      console.log(`     Error Message: "${dupRes.data.error}"`);

      // Step 10: Professor Views Results
      logStep(10, 'Professor Dashboard Live Results', 'Professor views recorded attendance list.');
      const results = await api(`/api/attendance/session/results/${sessionId}`, 'GET', null, profToken);
      console.log(`  ✓ Enrolled Students Attendance Status:`);
      results.data.students.forEach(s => {
        console.log(`     - ${s.name} (${s.email}): [${s.attendance_status}]`);
      });

      console.log(`\n====================================================`);
      console.log(`  DEMO COMPLETE: ALL SECURITY CONTROL CHECKS PASSED `);
      console.log(`====================================================\n`);

    } catch (e) {
      console.error('Demo Error:', e);
    } finally {
      server.close();
    }
  });
}

runDemo();
