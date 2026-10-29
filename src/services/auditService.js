import db from '../db/database.js';

export function logAuditEvent(eventType, userId = null, sessionId = null, details = '', ipAddress = '') {
  try {
    const stmt = db.prepare(`
      INSERT INTO audit_logs (event_type, user_id, session_id, details, ip_address)
      VALUES (?, ?, ?, ?, ?)
    `);
    const detailsStr = typeof details === 'object' ? JSON.stringify(details) : String(details);
    stmt.run(eventType, userId, sessionId, detailsStr, ipAddress);
  } catch (error) {
    console.error('Failed to log audit event:', error);
  }
}
