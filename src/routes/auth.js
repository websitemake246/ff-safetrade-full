const express = require('express');
const jwtFunc = require('../middleware/auth');
require('dotenv').config();

const db = require('../db');
const { tokenAuth, requireAdmin, generateToken, hashPassword, comparePassword } = jwtFunc;

const router = express.Router();

router.post('/register', (req, res) => {
  const { email, password, full_name } = req.body || {};
  if (!email || !password || !full_name) return res.status(400).json({ error: 'email, password, and full_name required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  try {
    const passwordHash = hashPassword(password);
    const info = db.prepare(
      'INSERT INTO users (email, password, full_name, role, verification_status) VALUES (?, ?, ?, ?, ?)'
    ).run(email.toLowerCase(), passwordHash, full_name, 'user', 'unverified');
    const user = db.prepare('SELECT id, email, full_name, role, verification_status FROM users WHERE id = ?').get(info.lastInsertRowid);
    const token = generateToken(user);
    res.json({ token, user });
  } catch (e) {
    res.status(400).json({ error: 'Email already in use' });
  }
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user || !comparePassword(password, user.password)) return res.status(401).json({ error: 'Invalid credentials' });
  const token = generateToken(user);
  res.json({ token, user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role, verification_status: user.verification_status } });
});

router.get('/me', tokenAuth, (req, res) => {
  res.json({ user: req.user });
});

router.post('/refresh', tokenAuth, (req, res) => {
  const user = db.prepare('SELECT id, email, full_name, role, verification_status FROM users WHERE id = ?').get(req.user.id);
  const token = generateToken(user);
  res.json({ token, user });
});

module.exports = router;
