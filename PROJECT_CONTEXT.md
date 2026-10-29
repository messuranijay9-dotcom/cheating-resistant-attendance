# Cheating-Resistant Attendance Management System - Master Context

## 1. Project Purpose & Overview
This system is designed for the Software Design and Technology (SDTT) class project to create a practical, demonstrable, multi-layered cheating-resistant attendance management system.
The system is divided into two main components:
1. **Professor/Admin Web Application**: Web dashboard for starting sessions, projecting 3 sequential dynamic QR codes, monitoring real-time student check-ins, and managing session histories.
2. **Student Mobile Web Application**: Mobile-optimized scanner interface allowing students to authenticate, join active attendance sessions, scan 3 sequential QR codes (QR1 -> QR2 -> QR3) within a strict countdown window, and submit attendance securely.

---

## 2. Core Architecture & Technology Stack
- **Backend Framework**: Node.js with Express (ES Modules)
- **Real-Time Communication**: Socket.io / WebSockets (for live QR code stage updates & real-time professor dashboard stats)
- **Database**: SQLite3 via native `node:sqlite` (`DatabaseSync` driver) for zero-dependency, transactional relational storage.
- **Authentication**: JSON Web Tokens (JWT) stored in HttpOnly cookies / Authorization headers, password hashing with `bcryptjs`.
- **QR Code Generation & Scanning**: `qrcode` library on backend; HTML5 Canvas & Camera library (`html5-qrcode`) on student frontend.
- **Frontend Framework**: Modern Vanilla HTML5 / CSS3 / JavaScript (Glassmorphism, Projector-friendly full screen mode, Mobile PWA design system).

---

## 3. Key Security & Verification Mechanisms
1. **Server as Single Source of Truth**: The client is completely untrusted. Client-submitted stage numbers, verification flags, or timers are ignored. Server derives identity from JWT and enforces valid transitions (`0 -> 1 -> 2 -> 3`).
2. **3-Stage Sequential Verification**: Student must scan QR1, then QR2, then QR3 in precise sequence. Out-of-order scans are rejected.
3. **Dynamic / Temporary QR Tokens**: Each stage generates short-lived, session-bound cryptographic tokens. Static plain-text strings are strictly forbidden.
4. **Attempt Expiration & App-Exit Invalidation**: Attendance attempts have configurable expiration timers (1–3 mins). Leaving the application or hiding the tab fires lifecycle events to invalidate active attempts on server.
5. **Database Uniqueness & Race Condition Defense**: DB schema enforces `UNIQUE(student_id, attendance_session_id)`. Scan requests execute inside SQLite atomic transactions.
6. **Audit Trail & Logging**: System logs all security-relevant events (scans, invalid order attempts, expired tokens, attempt invalidations, logins).

---

## 4. Database Schema (Normalized)
- `users`: (id, name, email, password_hash, role ['PROFESSOR', 'STUDENT'], created_at)
- `courses`: (id, course_code, name, professor_id, created_at)
- `enrollments`: (student_id, course_id, enrolled_at)
- `attendance_sessions`: (id, course_id, started_by, start_time, expiry_time, status ['ACTIVE', 'ENDED', 'EXPIRED'], current_stage [1, 2, 3], total_timeout_seconds)
- `qr_tokens`: (id, session_id, stage, token, expires_at, created_at)
- `attendance_attempts`: (id, session_id, student_id, current_stage, started_at, expires_at, status ['IN_PROGRESS', 'COMPLETED', 'EXPIRED', 'INVALIDATED'])
- `attendance_records`: (id, session_id, student_id, marked_at, status ['PRESENT'])
- `audit_logs`: (id, event_type, user_id, session_id, details, ip_address, created_at)

---

## 5. Implementation Roadmap / Phases
- [x] Phase 1: Project Architecture & Master Context Setup
- [x] Phase 2: Backend Core, Database Schema, & Authentication (JWT + Bcrypt)
- [x] Phase 3: Course Management & Enrollment Endpoints
- [x] Phase 4: Attendance Session Engine & Real-Time Socket Gateway
- [x] Phase 5: Dynamic 3-Stage QR Token Generator & Server Validation Logic
- [x] Phase 6: Student Attendance Workflow & Lifecycle Invalidation Handler
- [x] Phase 7: Professor Dashboard (Projector UI & Real-Time Monitor)
- [x] Phase 8: Student Mobile Application (Camera QR Scanner UI & History)
- [x] Phase 9: Comprehensive Audit Logging & Security Hardening
- [x] Phase 10: Automated & Security Unit/Integration Testing Suite (6/6 Passed)
- [x] Phase 11: Demo Mode Setup & Walkthrough Documentation

---

## 6. Known Limitations (Honest Disclosure)
- Does not prevent physical phone hand-off if one student hands their physical device to another student while remaining in classroom.
- Does not block hardware-level device cloning or rooted device hooks without dedicated native OS attestation (e.g. Play Integrity).
- Network IP restrictions can be bypassed using VPNs or local mobile hotspots.
