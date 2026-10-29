import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'attendance.db');
const db = new DatabaseSync(dbPath);

// Enable WAL mode and foreign key constraints
try {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
} catch (e) {
  console.warn('Pragma setup warning:', e.message);
}

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('PROFESSOR', 'STUDENT')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      professor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS enrollments (
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      enrolled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (student_id, course_id)
    );

    CREATE TABLE IF NOT EXISTS attendance_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      started_by INTEGER NOT NULL REFERENCES users(id),
      start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      expiry_time DATETIME NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'ENDED', 'EXPIRED')),
      current_stage INTEGER NOT NULL DEFAULT 1 CHECK(current_stage IN (1, 2, 3)),
      total_timeout_seconds INTEGER NOT NULL DEFAULT 180
    );

    CREATE TABLE IF NOT EXISTS qr_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
      stage INTEGER NOT NULL CHECK(stage IN (1, 2, 3)),
      token TEXT UNIQUE NOT NULL,
      expires_at DATETIME NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS attendance_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      current_stage INTEGER NOT NULL DEFAULT 0 CHECK(current_stage IN (0, 1, 2, 3)),
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      status TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK(status IN ('IN_PROGRESS', 'COMPLETED', 'EXPIRED', 'INVALIDATED')),
      UNIQUE(student_id, session_id)
    );

    CREATE TABLE IF NOT EXISTS attendance_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      marked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT NOT NULL DEFAULT 'PRESENT',
      UNIQUE(student_id, session_id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      session_id INTEGER REFERENCES attendance_sessions(id) ON DELETE SET NULL,
      details TEXT,
      ip_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Face Recognition: one profile per student (enforced by UNIQUE)
    CREATE TABLE IF NOT EXISTS face_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      descriptor TEXT NOT NULL,
      enrolled_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Face tokens: short-lived token issued after a successful live verification
    CREATE TABLE IF NOT EXISTS face_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  runMigrations();
  migrateAttendanceRecords();
  console.log('SQLite Database initialized successfully via node:sqlite.');
}

/**
 * Add new columns to existing tables without losing data.
 * Each ALTER TABLE is wrapped in try/catch so repeated runs are safe.
 */
export function runMigrations() {
  const migrations = [
    // Per-stage timeout stored on the session
    `ALTER TABLE attendance_sessions ADD COLUMN stage_timeout_seconds INTEGER NOT NULL DEFAULT 60`,
    // Server-authoritative expiry for the CURRENT stage
    `ALTER TABLE attendance_sessions ADD COLUMN qr_stage_expires_at DATETIME`,
    // Heartbeat tracking on in-progress attempts
    `ALTER TABLE attendance_attempts ADD COLUMN last_heartbeat_at DATETIME`,
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch (_e) { /* Column already exists – safe to ignore */ }
  }
}

/**
 * Recreate attendance_records with a CHECK constraint that allows both
 * 'PRESENT' and 'ABSENT' statuses. SQLite cannot ALTER a CHECK constraint,
 * so we use the standard rename-copy-rename pattern.
 */
function migrateAttendanceRecords() {
  try {
    const tbl = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='attendance_records'"
    ).get();
    if (tbl && tbl.sql && !tbl.sql.includes('ABSENT')) {
      db.exec(`
        PRAGMA foreign_keys = OFF;
        CREATE TABLE IF NOT EXISTS attendance_records_v2 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id INTEGER NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
          student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          marked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          status TEXT NOT NULL DEFAULT 'PRESENT' CHECK(status IN ('PRESENT', 'ABSENT')),
          UNIQUE(student_id, session_id)
        );
        INSERT OR IGNORE INTO attendance_records_v2 SELECT * FROM attendance_records;
        DROP TABLE attendance_records;
        ALTER TABLE attendance_records_v2 RENAME TO attendance_records;
        PRAGMA foreign_keys = ON;
      `);
    }
  } catch (e) {
    console.warn('attendance_records migration warning:', e.message);
  }
}

export default db;
