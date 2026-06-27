const express = require('express');
const jwtFunc = require('../middleware/auth');
const db = require('../db');

const { tokenAuth } = jwtFunc;

const router = express.Router();

// Get open listings for browsing
router.get('/', (req, res) => {
  const rows = db.prepare(
    "SELECT l.*, u.username as seller_name, u.verification_status as seller_verification_status FROM listings l JOIN users u ON l.user_id = u.id WHERE l.status = 'open' AND (l.expires_at IS NULL OR l.expires_at > ?) ORDER BY l.created_at DESC"
  ).all(new Date().toISOString());
  res.json(rows);
});

// Get user's listings
router.get('/mine', tokenAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM listings WHERE user_id = ?').all(req.user.id);
  rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(rows);
});

// Create listing
router.post('/', tokenAuth, (req, res) => {
  const { title, platform, description, price_kobo, evidence_urls } = req.body || {};
  if (!title || !platform || !price_kobo) return res.status(400).json({ error: 'title, platform, and price required' });
  
  const info = db.prepare(
    'INSERT INTO listings (user_id, title, platform, description, price_kobo, evidence_urls, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(req.user.id, title, platform, description || '', Number(price_kobo), JSON.stringify(evidence_urls || []), 'open');
  
  res.json({ id: info.lastInsertRowid, ok: true });
});

// Update listing
router.put('/:id', tokenAuth, (req, res) => {
  const { title, platform, description, price_kobo, evidence_urls } = req.body || {};
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (!listing) return res.status(404).json({ error: 'Listing not found' });
  if (listing.user_id !== req.user.id) return res.status(403).json({ error: 'Not allowed' });
  if (listing.status !== 'open') return res.status(400).json({ error: 'Cannot edit non-open listing' });

  db.prepare(
    'UPDATE listings SET title=?, platform=?, description=?, price_kobo=?, evidence_urls=?, updated_at=? WHERE id=?'
  ).run(title, platform, description || '', Number(price_kobo), JSON.stringify(evidence_urls || []), new Date().toISOString(), req.params.id);

  res.json({ ok: true });
});

// Delete listing
router.delete('/:id', tokenAuth, (req, res) => {
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (!listing) return res.status(404).json({ error: 'Listing not found' });
  if (listing.user_id !== req.user.id) return res.status(403).json({ error: 'Not allowed' });

  db.prepare('DELETE FROM listings WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Get single listing
router.get('/:id', (req, res) => {
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (!listing) return res.status(404).json({ error: 'Listing not found' });
  
  // Increment view count
  db.prepare('UPDATE listings SET view_count = view_count + 1 WHERE id = ?').run(req.params.id);
  
  const seller = db.prepare('SELECT username, verification_status FROM users WHERE id = ?').get(listing.user_id);
  res.json({ ...listing, seller });
});

module.exports = router;