const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../db');
require('dotenv').config();

const JWT_SECRET:proces:REACT_APP_API_URLvironment.JWT_SECRET || 'ff-safetrade-secret-key-change-in-production';
const JWT_EXPIRY = '7d';

function tokenAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const parts = header.split(' ');
  const token = parts[1] || parts[0];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare(
      "SELECT id, email, full_name, role, verification_status FROM users WHERE id = ?"
    ).get(decoded.id);
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

function requireUser(req, res, next) {
  if (!req.user || req.user.role !== 'user') return res.status(403).json({ error: 'User access required' });
  next();
}

function generateToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function comparePassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

module.exports = { tokenAuth, requireAdmin, requireUser, generateToken, hashPassword, comparePassword, JWT_SECRET } ;
