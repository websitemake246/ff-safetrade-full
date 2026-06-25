const express = require('express');
const { v4: uuidv4 } = require('uuid');
const jwtFunc = require('../middleware/auth');
const database = require('../db');
require('dotenv').config();

const db = database.getDB();
const { tokenAuth, requireAdmin } = jwtFunc;

const router = express.Router();

const LISTING_EXPIRY_DAYS = 30;

function getListingById(id) {
  return db.prepare(
    `SELECT l.*, u.email as seller_email, u.full_name as seller_name
     FROM listings l
     JOIN users u ON l.user_id = u.id
     WHERE l.id = ?`
  ).get(id);
}

// List all open listings
router.get('/', (req, res) => {
  const { platform, minPrice, maxPrice, verified } = req.query;
  let query = `SELECT l.*, u.email as seller_email, u.full_name as seller_name
               FROM listings l
               JOIN users u ON l.user_id = u.id
               WHERE l.status = 'open' AND l.expires_at > ?`;
  const params = [new Date().toISOString()];
  if (platform) { query += ' AND l.platform = ?'; params.push(platform); }
  if (minPrice) { query += ' AND l.price_kobo >= ?'; params.push(Number(minPrice)); }
  if (maxPrice) { query += ' AND l.price_kobo <= ?'; params.push(Number(maxPrice)); }
  if (verified === 'true') { query += ' AND l.verified = 1'; }
  query += ' ORDER BY l.created_at DESC';
  const rows = db.prepare(query).all(...params);
  res.json(rows);
});

// Get single listing
router.get('/:id', (req, res) => {
  db.prepare('UPDATE listings SET view_count = view_count + 1 WHERE id = ?').run(req.params.id);
  const listing = getListingById(req.params.id);
  if (!listing) return res.status(404).json({ error: 'Listing not found' });
  res.json(listing);
});

// Create listing (authenticated users only)
router.post('/', tokenAuth, (req, res) => {
  const { title, platform, description, price_kobo, evidence_urls, account_details } = req.body || {};
  if (!title || !platform || !price_kobo) return res.status(400).json({ error: 'title, platform, and price_kobo required' });
  if (Number(price_kobo) < 1000) return res.status(400).json({ error: 'Minimum price is ₦10' });
  if (Number(price_kobo) > 1000000000) return res.status(400).json({ error: 'Price too high' });

  const seller = db.prepare('SELECT verification_status FROM users WHERE id = ?').get(req.user.id);
  if (seller.verification_status === 'rejected') {
    return res.status(403).json({ error: 'Account not verified. Contact admin.' });
  }

  const expiresAt = new Date(Date.now() + LISTING_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  let status = 'open';
  if (seller.verification_status !== 'verified') status = 'pending_verification';

  const info = db.prepare(
    `INSERT INTO listings (user_id, title, platform, description, price_kobo, evidence_urls, account_details, status, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    req.user.id,
    title.trim(),
    platform.trim(),
    description || '',
    Number(price_kobo),
    JSON.stringify(Array.isArray(evidence_urls) ? evidence_urls : []),
    JSON.stringify(account_details || {}),
    status,
    expiresAt
  );

  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(info.lastInsertRowid);
  res.json(listing);
});

// My listings
router.get('/mine/my-listings', tokenAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM listings WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json(rows);
});

// Update listing (owner or admin)
router.put('/:id', tokenAuth, (req, res) => {
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (!listing) return res.status(404).json({ error: 'Listing not found' });
  if (listing.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Not allowed' });
  if (listing.status !== 'open' && listing.status !== 'pending_verification') return res.status(400).json({ error: 'Cannot update closed listing' });

  const { title, platform, description, price_kobo, evidence_urls, account_details } = req.body || {};
  db.prepare(
    `UPDATE listings SET title=?, platform=?, description=?, price_kobo=?, evidence_urls=?, account_details=?, updated_at=? WHERE id=?`
  ).run(
    title || listing.title,
    platform || listing.platform,
    description !== undefined ? description : listing.description,
    price_kobo || listing.price_kobo,
    JSON.stringify(Array.isArray(evidence_urls) ? evidence_urls : JSON.parse(listing.evidence_urls || '[]')),
    JSON.stringify(account_details || JSON.parse(listing.account_details || '{}')),
    new Date().toISOString(),
    req.params.id
  );
  res.json({ ok: true });
});

// Delete listing
router.delete('/:id', tokenAuth, (req, res) => {
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (!listing) return res.status(404).json({ error: 'Listing not found' });
  if (listing.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Not allowed' });
  if (listing.status === 'sold') return res.status(400).json({ error: 'Cannot delete sold listing' });
  db.prepare('UPDATE listings SET status = ? WHERE id = ?').run('expired', req.params.id);
  res.json({ ok: true });
});

module.exports = router;
