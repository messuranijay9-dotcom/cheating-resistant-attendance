import db from '../db/database.js';
import { logAuditEvent } from '../services/auditService.js';

export function getCourses(req, res) {
  try {
    const { role, id: userId } = req.user;
    let courses = [];

    if (role === 'PROFESSOR') {
      courses = db.prepare(`
        SELECT c.*, 
          (SELECT COUNT(*) FROM enrollments WHERE course_id = c.id) AS enrolled_students_count
        FROM courses c
        WHERE c.professor_id = ?
        ORDER BY c.created_at DESC
      `).all(userId);
    } else {
      // Student: return courses they are enrolled in, plus un-enrolled courses available
      courses = db.prepare(`
        SELECT c.*, u.name as professor_name,
          CASE WHEN e.student_id IS NOT NULL THEN 1 ELSE 0 END AS is_enrolled
        FROM courses c
        JOIN users u ON c.professor_id = u.id
        LEFT JOIN enrollments e ON c.id = e.course_id AND e.student_id = ?
        ORDER BY c.name ASC
      `).all(userId);
    }

    return res.json({ courses });
  } catch (error) {
    console.error('getCourses error:', error);
    return res.status(500).json({ error: 'Failed to fetch courses.' });
  }
}

export function createCourse(req, res) {
  try {
    const { course_code, name } = req.body;
    const professorId = req.user.id;

    if (!course_code || !name) {
      return res.status(400).json({ error: 'Course code and name are required.' });
    }

    const normalizedCode = course_code.trim().toUpperCase();

    const existing = db.prepare('SELECT id FROM courses WHERE course_code = ?').get(normalizedCode);
    if (existing) {
      return res.status(400).json({ error: 'A course with this code already exists.' });
    }

    const stmt = db.prepare(`
      INSERT INTO courses (course_code, name, professor_id)
      VALUES (?, ?, ?)
    `);
    const result = stmt.run(normalizedCode, name.trim(), professorId);

    logAuditEvent('COURSE_CREATE', professorId, null, `Created course ${normalizedCode}`, req.ip);

    return res.status(201).json({
      message: 'Course created successfully',
      course: { id: result.lastInsertRowid, course_code: normalizedCode, name: name.trim(), professor_id: professorId }
    });
  } catch (error) {
    console.error('createCourse error:', error);
    return res.status(500).json({ error: 'Failed to create course.' });
  }
}

export function enrollStudent(req, res) {
  try {
    const { course_id } = req.body;
    const studentId = req.user.id;

    if (!course_id) {
      return res.status(400).json({ error: 'Course ID is required.' });
    }

    const course = db.prepare('SELECT id FROM courses WHERE id = ?').get(course_id);
    if (!course) {
      return res.status(404).json({ error: 'Course not found.' });
    }

    const stmt = db.prepare(`
      INSERT OR IGNORE INTO enrollments (student_id, course_id)
      VALUES (?, ?)
    `);
    stmt.run(studentId, course_id);

    logAuditEvent('COURSE_ENROLL', studentId, null, `Student enrolled in course ID ${course_id}`, req.ip);

    return res.json({ message: 'Successfully enrolled in course.' });
  } catch (error) {
    console.error('enrollStudent error:', error);
    return res.status(500).json({ error: 'Failed to enroll in course.' });
  }
}
