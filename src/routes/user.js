const express = require('express');
const jwtFunc = require('../middleware/auth');
const db = require('../db');

const { tokenAuth } = jwtFunc;

const router = express.Router();

// Get user's deals (as buyer or seller)
router.get('/deals', tokenAuth, (req, res) => {
  const rows = db.prepare(
    "SELECT d.*, l.title, l.platform, l.price_kobo FROM deals d JOIN listings l ON d.listing_id = l.id WHERE d.buyer_id = ? OR d.seller_id = ?"
  ).all(req.user.id, req.user.id);
  res.json(rows);
});

// Get user's listings
router.get('/listings', tokenAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM listings WHERE user_id = ?').all(req.user.id);
  rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(rows);
});

// Get user profile with bank details
router.get('/profile', tokenAuth, (req, res) => {
  const user = db.prepare('SELECT id, username, email, phone, full_name, role, verification_status, bank_name, account_number, account_name FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

// Update user profile (bank details, phone, etc.)
router.put('/profile', tokenAuth, (req, res) => {
  const { phone, full_name, bank_name, account_number, account_name } = req.body || {};
  const allowed = {};
  if (phone) allowed.phone = phone;
  if (full_name) allowed.full_name = full_name;
  if (bank_name) allowed.bank_name = bank_name;
  if (account_number) allowed.account_number = account_number;
  if (account_name) allowed.account_name = account_name;
  
  if (Object.keys(allowed).length === 0) return res.status(400).json({ error: 'No valid fields to update' });
  
  db.prepare('UPDATE users SET ' + Object.keys(allowed).map(k => `${k} = ?`).join(', ') + ' WHERE id = ?').run(...Object.values(allowed), req.user.id);
  
  const user = db.prepare('SELECT id, username, email, phone, full_name, role, verification_status, bank_name, account_number, account_name FROM users WHERE id = ?').get(req.user.id);
  res.json({ user });
});

module.exports = router;