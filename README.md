# 🛡️ Cheating-Resistant Attendance Management System

A multi-layer, cheating-resistant attendance management application built for the **Software Design and Technology (SDTT)** course project.

The application mitigates common attendance cheating techniques (screenshot sharing, proxy scanning, out-of-sequence scanning, token replaying, duplicate submissions, and extended phone hand-offs) through server-enforced sequential validation, dynamic short-lived cryptographic QR tokens, attempt countdown timers, and client-side lifecycle invalidation.

---

## 🌟 Key Features

### 👨‍🏫 Professor / Admin Portal
- **Course Selection & Management**: Create courses and enroll students.
- **Session Control**: Initiate attendance sessions with custom timeout windows (1–5 mins).
- **Projector View**: Large, high-contrast, projector-friendly view showing current stage (`Stage 1 of 3`, `Stage 2 of 3`, `Stage 3 of 3`), live time countdown, and dynamic QR Code.
- **Stage Control**: Sequentially advance QR stages (`1 → 2 → 3`) or end session.
- **Real-Time Attendees Feed**: Instant WebSocket updates whenever a student successfully completes attendance.
- **Attendance Results & Export**: View attendee list and export records.

### 📱 Student Mobile Application
- **Course Dashboard**: View active sessions and enrollment status.
- **Sequential QR Scanner**: Integrated camera QR scanner (`html5-qrcode`) with real-time 3-step progress pills (`Step 1 of 3` → `Step 2 of 3` → `Step 3 of 3`).
- **Lifecycle Invalidation (App Exit / Tab Switch)**: Listens for HTML5 `visibilitychange` & `blur` events; automatically invalidates active attempt if the student background/exits the app.
- **Attendance History**: View past attendance records across all courses.

---

## 🔒 Security & Defense Strategy

| Threat Vector | Defense Mechanism | Server Enforcement |
| :--- | :--- | :--- |
| **Screenshot / Image Sharing** | Short-lived QR nonces (10–15s TTL), 3 sequential stages required within short global attempt window (1–3 mins). | Tokens bound to session + stage in DB table `qr_tokens`. |
| **Out-of-Order Scanning** | Student cannot skip stages or scan QR3 first. | Server state machine rejects scan if token stage != `attempt.current_stage + 1`. |
| **API Payload Forgery** | Student posts raw JSON claiming completion. | Server derives student ID strictly from verified JWT cookie/header and ignores client-submitted stage/status flags. |
| **Duplicate Attendance** | Student attempts multiple check-ins. | Database table `attendance_records` enforces `UNIQUE(student_id, session_id)`. |
| **Phone Hand-off / Extended Attempt** | Student starts attempt and hands phone to a friend later. | Strict attempt timeout countdown + client app backgrounding invalidation ping (`/api/attendance/attempt/invalidate`). |

---

## 🚀 Quick Start & Installation

### Prerequisites
- **Node.js**: v22.0.0 or higher (v24 tested)
- **npm**: 10.0+

### Setup Instructions

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Seed Initial Database & Test Accounts**:
   ```bash
   npm run seed
   ```

3. **Start Application Server**:
   ```bash
   npm start
   ```
   Open your browser at: `http://localhost:3000`

---

## 🔑 Default Accounts (Seeded)

| Role | Email | Password |
| :--- | :--- | :--- |
| **Professor** | `prof@university.edu` | `password123` |
| **Student 1** | `student1@university.edu` | `password123` |
| **Student 2** | `student2@university.edu` | `password123` |
| **Student 3** | `student3@university.edu` | `password123` |

---

## 🧪 Testing & Demo Modes

### 1. Run Automated Test Suite
Executes integration tests verifying sequential stage progression, out-of-order rejection, expired tokens, duplicate attempts, and app invalidation:
```bash
npm test
```

### 2. Run Interactive Presentation Demo
Runs an automated CLI walkthrough demonstrating classroom scenarios and security defense controls:
```bash
node demo_script.js
```

---

## 📁 Repository Structure

```
d:/Attendance app/
├── server.js                   # Express + Socket.io Server Entrypoint
├── package.json                # Project Dependencies & Scripts
├── PROJECT_CONTEXT.md          # Master Architecture & Context
├── SECURITY.md                 # Threat Vector & Defense Model
├── TESTING.md                  # Test Strategy & Test Matrix
├── TODO.md                     # Phase Execution Progress Tracker
├── demo_script.js              # Interactive Presentation Demo Script
├── src/
│   ├── db/
│   │   ├── database.js         # SQLite Initialization (node:sqlite)
│   │   └── seed.js             # Initial Account & Course Seed Script
│   ├── middleware/
│   │   └── auth.js             # JWT Verification & Role Authorization
│   ├── controllers/
│   │   ├── authController.js   # User Auth & Profile APIs
│   │   ├── courseController.js # Course & Enrollment APIs
│   │   └── attendanceController.js # 3-Stage Attendance Engine & Logic
│   ├── services/
│   │   ├── qrService.js        # Cryptographic Token & QR Image Generator
│   │   └── auditService.js     # Structured Security Audit Logging
│   └── routes/
│       ├── authRoutes.js       # Auth Routes
│       ├── courseRoutes.js     # Course Routes
│       └── attendanceRoutes.js # Attendance Routes
├── public/                     # Frontend Single Page Web App
│   ├── index.html              # Unified Dashboard & Projector Layout
│   ├── css/styles.css          # Glassmorphic Styling System
│   └── js/
│       ├── app.js              # Core Auth & Socket.io Handlers
│       ├── professor.js        # Professor & Projector Mode Controller
│       └── student.js          # Student Mobile & Camera Scanner Logic
└── tests/
    └── attendance.test.js      # Automated Integration Test Suite
```

---

## 📄 Honest System Limitations
1. **Physical Phone Delegation**: Does not prevent a student from physically giving their unlocked device to a classmate seated in the lecture hall.
2. **Camera Streaming**: Does not prevent a student with ultra-fast video relay from scanning a projected screen if scanned within 5–10 seconds.
