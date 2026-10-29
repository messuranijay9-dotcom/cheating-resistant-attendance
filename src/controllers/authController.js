import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../db/database.js';
import { JWT_SECRET } from '../middleware/auth.js';
import { logAuditEvent } from '../services/auditService.js';

export function register(req, res) {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'Name, email, password, and role are required.' });
    }

    if (!['PROFESSOR', 'STUDENT'].includes(role.toUpperCase())) {
      return res.status(400).json({ error: 'Role must be PROFESSOR or STUDENT.' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
    if (existingUser) {
      return res.status(400).json({ error: 'An account with this email already exists.' });
    }

    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(password, salt);

    const stmt = db.prepare(`
      INSERT INTO users (name, email, password_hash, role)
      VALUES (?, ?, ?, ?)
    `);

    const result = stmt.run(name.trim(), normalizedEmail, passwordHash, role.toUpperCase());
    const userId = result.lastInsertRowid;

    const token = jwt.sign(
      { id: userId, email: normalizedEmail, name: name.trim(), role: role.toUpperCase() },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    logAuditEvent('USER_REGISTER', userId, null, `User registered as ${role}`, req.ip);

    return res.status(201).json({
      message: 'Registration successful',
      token,
      user: { id: userId, name: name.trim(), email: normalizedEmail, role: role.toUpperCase() }
    });
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({ error: 'Internal server error during registration.' });
  }
}

export function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);

    if (!user) {
      logAuditEvent('LOGIN_FAILED', null, null, `Invalid email: ${normalizedEmail}`, req.ip);
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const isMatch = bcrypt.compareSync(password, user.password_hash);
    if (!isMatch) {
      logAuditEvent('LOGIN_FAILED', user.id, null, 'Invalid password', req.ip);
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    logAuditEvent('USER_LOGIN', user.id, null, `User logged in as ${user.role}`, req.ip);

    return res.json({
      message: 'Login successful',
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error during login.' });
  }
}

export function getMe(req, res) {
  try {
    const user = db.prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?').get(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    return res.json({ user });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to retrieve profile.' });
  }
}
