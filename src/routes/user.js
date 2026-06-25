const express = require('express');
const database = require('../db');
require('dotenv').config();

const db = database.getDB();
const jwtFunc = require('../middleware/auth');
const { tokenAuth } = jwtFunc;

const router = express.Router();

// Transaction history for current user (buyer or seller)
router.get('/history', tokenAuth, (req, res) => {
  const { as_buyer, as_seller } = req.query;
  let query = `SELECT d.*, l.title, l.platform,
                      u1.email as buyer_email, u1.full_name as buyer_name,
                      u2.email as seller_email, u2.full_name as seller_name
               FROM deals d
               JOIN listings l ON d.listing_id = l.id
               JOIN users u1 ON d.buyer_id = u1.id
               JOIN users u2 ON d.seller_id = u2.id
               WHERE `;
  const params = [];
  const conditions = [];
  if (as_buyer !== 'false') { conditions.push('d.buyer_id = ?'); params.push(req.user.id); }
  if (as_seller !== 'false') { conditions.push('d.seller_id = ?'); params.push(req.user.id); }
  if (conditions.length === 0) { conditions.push('d.buyer_id = ?'); params.push(req.user.id); }
  query += conditions.join(' OR ');
  query += ' ORDER BY d.created_at DESC LIMIT 50';
  res.json(db.prepare(query).all(...params));
});

// My deals (all roles)
router.get('/deals', tokenAuth, (req, res) => {
  let query = `SELECT d.*, l.title, l.platform, l.price_kobo,
                      u1.email as buyer_email, u2.email as seller_email
               FROM deals d
               JOIN listings l ON d.listing_id = l.id
               JOIN users u1 ON d.buyer_id = u1.id
               JOIN users u2 ON d.seller_id = u2.id
               WHERE d.buyer_id = ? OR d.seller_id = ?
               ORDER BY d.created_at DESC`;
  res.json(db.prepare(query).all(req.user.id, req.user.id));
});

// Specific deal
router.get('/deals/:id', tokenAuth, (req, res) => {
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(deal.listing_id);
  const dispute = db.prepare('SELECT * FROM disputes WHERE deal_id = ?').get(deal.id);
  const disputeMessages = dispute ? db.prepare('SELECT * FROM dispute_messages WHERE dispute_id = ? ORDER BY created_at ASC').all(dispute.id) : [];
  res.json({ ...deal, listing, dispute, disputeMessages });
});

// My listings
router.get('/listings', tokenAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM listings WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json(rows);
});

module.exports = router;
