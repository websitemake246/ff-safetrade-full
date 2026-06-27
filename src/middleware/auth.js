const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../db');

const SECRET = process.env.JWT_SECRET || 'ff-safetrade-secret-key-change-in-production';
const EXPIRE = '7d';

function tokenAuth(req, res, next) {
  const header = req.headers['x-ff-token'] || req.headers.authorization || '';
  const token = String(header).replace(/^Bearer\s+/i, '').trim();
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, SECRET);
    const user = db.prepare('SELECT id, username, email, phone, full_name, role, verification_status FROM users WHERE id = ?').get(decoded.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

function generateToken(user) {
  return jwt.sign({ id: user.id, username: user.username, email: user.email, role: user.role }, SECRET, { expiresIn: EXPIRE });
}

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function comparePassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

module.exports = { tokenAuth, requireAdmin, generateToken, hashPassword, comparePassword };