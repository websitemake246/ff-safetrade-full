const express = require('express');
const jwtFunc = require('../middleware/auth');
const db = require('../db');

const { tokenAuth, generateToken, hashPassword, comparePassword } = jwtFunc;

const router = express.Router();

router.post('/register', (req, res) => {
  const { username, email, phone, password, full_name } = req.body || {};
  if (!username || !password || !full_name) return res.status(400).json({ error: 'username, password, and full_name required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  try {
    const passwordHash = hashPassword(password);
    const info = db(
      'INSERT INTO users (username, email, phone, password, full_name, role, verification_status) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run((username || '').toLowerCase(), (email || '').toLowerCase(), phone || '', passwordHash, full_name, 'user', 'unverified');
    const user = db('SELECT id, username, email, phone, full_name, role, verification_status FROM users WHERE id = ?').get(info.lastInsertRowid);
    const token = generateToken(user);
    res.json({ token, user });
  } catch (e) {
    res.status(400).json({ error: 'Username or email already in use' });
  }
});

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db('SELECT * FROM users WHERE username = ?').get((username || '').toLowerCase());
  if (!user || !comparePassword(password, user.password)) return res.status(401).json({ error: 'Invalid credentials' });
  const token = generateToken(user);
  res.json({ token, user: { id: user.id, username: user.username, email: user.email || '', phone: user.phone || '', full_name: user.full_name, role: user.role, verification_status: user.verification_status } });
});

router.get('/me', tokenAuth, (req, res) => {
  res.json({ user: req.user });
});

router.put('/me', tokenAuth, (req, res) => {
  const { phone, full_name, bank_name, account_number, account_name } = req.body || {};
  const allowed = {};
  if (phone) allowed.phone = phone;
  if (full_name) allowed.full_name = full_name;
  if (bank_name) allowed.bank_name = bank_name;
  if (account_number) allowed.account_number = account_number;
  if (account_name) allowed.account_name = account_name;
  
  if (Object.keys(allowed).length === 0) return res.status(400).json({ error: 'No valid fields to update' });
  
  db('UPDATE users SET ' + Object.keys(allowed).map(k => `${k} = ?`).join(', ') + ' WHERE id = ?').run(...Object.values(allowed), req.user.id);
  const user = db('SELECT id, username, email, phone, full_name, role, verification_status, bank_name, account_number, account_name FROM users WHERE id = ?').get(req.user.id);
  res.json({ user });
});

module.exports = router;