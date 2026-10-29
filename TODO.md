# Project Todo List

## Phase 1: Project Setup & Architecture
- [x] Create project specification and architectural documentation (`PROJECT_CONTEXT.md`)
- [x] Create initial `TODO.md`, `SECURITY.md`, and `TESTING.md` files
- [x] Initialize `package.json` and install core dependencies

## Phase 2: Database & Backend Auth
- [x] Configure SQLite database connection & initialize tables (`src/db/database.js`)
- [x] Implement password hashing utilities (`bcryptjs`)
- [x] Build user registration & login APIs with JWT authentication (`authController.js`)
- [x] Create role-based authorization middleware (`requireRole('PROFESSOR')`, `requireRole('STUDENT')`)

## Phase 3: Course & Enrollment Management
- [x] Create endpoints to manage courses and student enrollments (`courseController.js`)
- [x] Implement seed script for sample courses, professor, and students (`src/db/seed.js`)

## Phase 4 & 5: Attendance Session & QR Engine
- [x] Implement attendance session lifecycle APIs (start, advance stage, end)
- [x] Build dynamic 3-stage cryptographic QR token generation logic (`qrService.js`)
- [x] Implement real-time WebSocket / Socket.io events for instant stage transitions
- [x] Implement scan validation logic (order check, attempt expiry check, stage check)

## Phase 6: Student Attempt & Lifecycle Invalidation
- [x] Build attendance attempt initiation API
- [x] Implement client-side lifecycle detection (Page Visibility / Blur event API) to send attempt invalidation
- [x] Build atomic transaction to record attendance on stage 3 scan

## Phase 7 & 8: Professor & Student Interfaces
- [x] Build projector-friendly Professor Dashboard with full-screen QR view & real-time attendance feed
- [x] Build Mobile-friendly Student UI with integrated HTML5 camera QR scanner

## Phase 9 & 10: Security Hardening & Automated Testing
- [x] Build audit logging system for suspicious scan attempts (`auditService.js`)
- [x] Create comprehensive automated test suite (`tests/attendance.test.js`) - ALL 6 TESTS PASSED!

## Phase 11: Demo Mode & Documentation
- [x] Create interactive quick-demo script / mode for class presentation (`demo_script.js`)
- [x] Write user guide & README setup instructions (`README.md`)
