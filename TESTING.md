# Testing Plan & Test Cases

## 1. Test Strategy Overview
The system will be validated using automated integration tests (Node.js test runner / Vitest / Jest / Supertest) and manual acceptance scenarios.

---

## 2. Test Cases Matrix

### Normal Flow Tests
- [ ] **TC-NORM-01**: Successful sequential scan (QR1 -> QR2 -> QR3) completes attendance.
- [ ] **TC-NORM-02**: Student attendance history reflects newly completed session.
- [ ] **TC-NORM-03**: Professor real-time dashboard updates completed student count instantly.

### Security & Order Validation Tests
- [ ] **TC-SEC-01 (Wrong Sequence - QR2 First)**: Attempting to scan QR2 before QR1 returns HTTP 400 (Invalid sequence stage).
- [ ] **TC-SEC-02 (Wrong Sequence - QR3 First)**: Attempting to scan QR3 before QR1/QR2 returns HTTP 400.
- [ ] **TC-SEC-03 (Expired QR Token)**: Scanning a QR token past its `expires_at` timestamp is rejected.
- [ ] **TC-SEC-04 (Cross-Session QR Token)**: Scanning QR token from Session A while participating in Session B is rejected.
- [ ] **TC-SEC-05 (Attempt Expiration)**: Submitting scans after the student's attempt timer (e.g. 120 seconds) expires returns HTTP 408 / 400.
- [ ] **TC-SEC-06 (Duplicate Attendance)**: Scanning QR3 again after completing attendance returns HTTP 409 (Attendance already recorded).
- [ ] **TC-SEC-07 (Role Authorization)**: Student accessing `POST /api/attendance/session/start` receives HTTP 403 Forbidden.
- [ ] **TC-SEC-08 (API Param Tampering)**: Sending raw body `{ stage: 3, student_id: 999 }` ignores body params and validates strictly against verified JWT token and server DB state.
- [ ] **TC-SEC-09 (Attempt Invalidation on Exit)**: Calling `/api/attendance/attempt/invalidate` sets attempt state to `INVALIDATED` and blocks further scans.

### Edge Case Tests
- [ ] **TC-EDGE-01**: Professor ends session while student is midway through scanning -> stage scan rejected with "Session ended".
- [ ] **TC-EDGE-02**: Duplicate scan of QR1 while at stage 1 -> handled gracefully without error.
