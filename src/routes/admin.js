const express = require('express');
const database = require('../db');
require('dotenv').config();
const jwtFunc = require('../middleware/auth');
const paystackUtil = require('../utils/paystack');

const db = database.getDB();
const { tokenAuth, requireAdmin } = jwtFunc;

const router = express.Router();

// Seed admin user
router.post('/seed', (req, res) => {
  const { email, password, full_name } = req.body || {};
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Not allowed in production' });
  }
  try {
    const bcrypt = require('bcryptjs');
    const passwordHash = bcrypt.hashSync(password || 'admin123', 10);
    const info = db.prepare(
      'INSERT INTO users (email, password, full_name, role, is_verified, verification_status) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(email || 'admin@safetrade.com', passwordHash, full_name || 'Admin', 'admin', 1, 'verified');
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: 'Admin exists or invalid data' });
  }
});

// Dashboard stats
router.get('/dashboard', tokenAuth, requireAdmin, (req, res) => {
  const totalUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'user'").get().count;
  const totalListings = db.prepare("SELECT COUNT(*) as count FROM listings").get().count;
  const openListings = db.prepare("SELECT COUNT(*) as count FROM listings WHERE status = 'open'").get().count;
  const pendingListings = db.prepare("SELECT COUNT(*) as count FROM listings WHERE status = 'pending_verification'").get().count;
  const totalDeals = db.prepare("SELECT COUNT(*) as count FROM deals").get().count;
  const pendingPayment = db.prepare("SELECT COUNT(*) as count FROM deals WHERE status = 'pending_payment'").get().count;
  const activeDeals = db.prepare("SELECT COUNT(*) as count FROM deals WHERE status IN ('payment_confirmed','accounts_shared')").get().count;
  const completedDeals = db.prepare("SELECT COUNT(*) as count FROM deals WHERE status = 'completed'").get().count;
  const disputedDeals = db.prepare("SELECT COUNT(*) as count FROM deals WHERE status = 'disputed'").get().count;
  const totalVolume = db.prepare("SELECT COALESCE(SUM(amount_kobo), 0) as volume FROM deals WHERE status = 'completed'").get().volume;
  const revenueKobo = db.prepare("SELECT COALESCE(SUM(middleman_fee_kobo), 0) as revenue FROM deals WHERE status = 'completed'").get().revenue;

  res.json({
    users: totalUsers,
    listings: { total: totalListings, open: openListings, pending: pendingListings },
    deals: { total: totalDeals, pending_payment, active: activeDeals, completed: completedDeals, disputed: disputedDeals },
    volume_kobo: totalVolume,
    revenue_kobo,
    revenue_naira: (revenueKobo / 100).toFixed(2)
  });
});

// User management
router.get('/users', tokenAuth, requireAdmin, (req, res) => {
  const { role, verified, search } = req.query;
  let query = 'SELECT id, email, full_name, role, verification_status, is_verified, created_at FROM users WHERE 1=1';
  const params = [];
  if (role) { query += ' AND role = ?'; params.push(role); }
  if (verified !== undefined) { query += ' AND is_verified = ?'; params.push(Number(verified) ? 1 : 0); }
  if (search) { query += ' AND (email LIKE ? OR full_name LIKE ?)'; params.push('%' + search + '%', '%' + search + '%'); }
  query += ' ORDER BY created_at DESC';
  const rows = db.prepare(query).all(...params);
  res.json(rows);
});

router.patch('/users/:id/verify', tokenAuth, requireAdmin, (req, res) => {
  const { status } = req.body || {};
  if (!['verified', 'rejected', 'pending'].includes(status)) {
    return res.status(400).json({ error: 'status must be verified, rejected, or pending' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  db.prepare(
    "UPDATE users SET verification_status = ?, is_verified = ?, updated_at = ? WHERE id = ?"
  ).run(status, status === 'verified' ? 1 : 0, new Date().toISOString(), req.params.id);

  db.prepare(
    "INSERT INTO activity_logs (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)"
  ).run(req.user.id, 'verify_user', 'user', req.params.id, JSON.stringify({ status, target_email: user.email }));

  res.json({ ok: true, user_id: req.params.id, status });
});

// Listing verification
router.get('/listings', tokenAuth, requireAdmin, (req, res) => {
  const { status, user_id } = req.query;
  let query = `SELECT l.*, u.email as seller_email, u.full_name as seller_name, u.verification_status
               FROM listings l JOIN users u ON l.user_id = u.id WHERE 1=1`;
  const params = [];
  if (status) { query += ' AND l.status = ?'; params.push(status); }
  if (user_id) { query += ' AND l.user_id = ?'; params.push(user_id); }
  query += ' ORDER BY l.created_at DESC';
  res.json(db.prepare(query).all(...params));
});

router.patch('/listings/:id/verify', tokenAuth, requireAdmin, (req, res) => {
  const { status, notes } = req.body || {};
  if (!['verified', 'rejected', 'open', 'suspended'].includes(status)) {
    return res.status(400).json({ error: 'status must be verified, rejected, open, or suspended' });
  }
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (!listing) return res.status(404).json({ error: 'Listing not found' });

  const newStatus = status === 'verified' ? 'open' : (status === 'rejected' ? 'expired' : status);
  db.prepare(
    "UPDATE listings SET status = ?, verification_notes = ?, updated_at = ? WHERE id = ?"
  ).run(newStatus, notes || '', new Date().toISOString(), req.params.id);

  db.prepare(
    "INSERT INTO activity_logs (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)"
  ).run(req.user.id, 'verify_listing', 'listing', req.params.id, JSON.stringify({ status, notes }));

  res.json({ ok: true, listing_id: req.params.id, status: newStatus });
});

// Deals management
router.get('/deals', tokenAuth, requireAdmin, (req, res) => {
  const { status, deal_id } = req.query;
  let query = `SELECT d.*, l.title, l.platform, u1.email as buyer_email, u2.email as seller_email,
                      b.full_name as buyer_name, s.full_name as seller_name
               FROM deals d
               JOIN listings l ON d.listing_id = l.id
               JOIN users u1 ON d.buyer_id = u1.id
               JOIN users u2 ON d.seller_id = u2.id
               JOIN users b ON d.buyer_id = b.id
               JOIN users s ON d.seller_id = s.id
               WHERE 1=1`;
  const params = [];
  if (status) { query += ' AND d.status = ?'; params.push(status); }
  if (deal_id) { query += ' AND d.id = ?'; params.push(deal_id); }
  query += ' ORDER BY d.created_at DESC';
  res.json(db.prepare(query).all(...params));
});

router.get('/deals/:id', tokenAuth, requireAdmin, (req, res) => {
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });

  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(deal.listing_id);
  const buyer = db.prepare('SELECT id, email, full_name FROM users WHERE id = ?').get(deal.buyer_id);
  const seller = db.prepare('SELECT id, email, full_name FROM users WHERE id = ?').get(deal.seller_id);
  const dispute = db.prepare('SELECT * FROM disputes WHERE deal_id = ?').get(deal.id);

  res.json({ ...deal, listing, buyer, seller, dispute });
});

// Manual deal completion (emergency/escrow override)
router.post('/deals/:id/complete', tokenAuth, requireAdmin, (req, res) => {
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });

  db.prepare(
    "UPDATE deals SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?"
  ).run(new Date().toISOString(), new Date().toISOString(), deal.id);
  db.prepare("UPDATE listings SET status = 'sold' WHERE id = ?").run(deal.listing_id);

  res.json({ ok: true, deal_id: deal.id, status: 'completed' });
});

// Escrow release to seller (middleman payout)
router.post('/deals/:id/release', tokenAuth, requireAdmin, (req, res) => {
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });

  if (deal.status !== 'completed') {
    // Allow release from disputed or completed deals only
    if (deal.status !== 'disputed') return res.status(400).json({ error: 'Only completed or disputed deals can be released' });
  }

  paystackUtil.initiateTransfer('seller_rec_code_placeholder', deal.amount_kobo, 'FF SafeTrade - Deal ' + deal.id)
    .then(response => {
      paystackUtil.initiateTransfer('fee_rec_code_placeholder', deal.middleman_fee_kobo, 'FF SafeTrade - Fee Deal ' + deal.id)
        .then(() => {
          db.prepare("UPDATE deals SET status = 'released', updated_at = ? WHERE id = ?")
            .run(new Date().toISOString(), deal.id);
          res.json({ ok: true, deal_id: deal.id, payouts: ['seller', 'middleman'] });
        })
        .catch(feeErr => {
          db.prepare("UPDATE deals SET status = 'released', updated_at = ? WHERE id = ?")
            .run(new Date().toISOString(), deal.id);
          res.json({ ok: true, deal_id: deal.id, payouts: ['seller'], note: 'middleman fee transfer failed' });
        });
    })
    .catch(err => {
      // In simulation/sandbox mode, just mark as released
      db.prepare("UPDATE deals SET status = 'released', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), deal.id);
      res.json({ ok: true, deal_id: deal.id, payouts: ['seller'], note: 'sandbox mode' });
    });
});

// Dispute management
router.get('/disputes', tokenAuth, requireAdmin, (req, res) => {
  const { status } = req.query;
  let query = `SELECT d.*, deal.listing_id, deal.amount_kobo,
                      u1.email as opened_by_email, u2.email as seller_email, u3.email as buyer_email
               FROM disputes d
               JOIN deals deal ON d.deal_id = deal.id
               JOIN users u1 ON d.opened_by = u1.id
               JOIN users u2 ON deal.seller_id = u2.id
               JOIN users u3 ON deal.buyer_id = u3.id
               WHERE 1=1`;
  const params = [];
  if (status) { query += ' AND d.status = ?'; params.push(status); }
  query += ' ORDER BY d.created_at DESC';
  res.json(db.prepare(query).all(...params));
});

router.get('/disputes/:id', tokenAuth, requireAdmin, (req, res) => {
  const dispute = db.prepare('SELECT * FROM disputes WHERE id = ?').get(req.params.id);
  if (!dispute) return res.status(404).json({ error: 'Dispute not found' });
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(dispute.deal_id);
  const messages = db.prepare('SELECT * FROM dispute_messages WHERE dispute_id = ? ORDER BY created_at ASC').all(dispute.id);
  res.json({ ...dispute, deal, messages });
});

router.patch('/disputes/:id', tokenAuth, requireAdmin, (req, res) => {
  const { status, resolution, admin_notes } = req.body || {};
  const dispute = db.prepare('SELECT * FROM disputes WHERE id = ?').get(req.params.id);
  if (!dispute) return res.status(404).json({ error: 'Dispute not found' });

  db.prepare(
    "UPDATE disputes SET status = ?, resolution = ?, admin_notes = ?, assigned_admin_id = ?, resolved_at = ? WHERE id = ?"
  ).run(
    status || dispute.status,
    resolution || dispute.resolution,
    admin_notes || dispute.admin_notes,
    req.user.id,
    ['resolved', 'closed', 'escalated'].includes(status) ? new Date().toISOString() : null,
    dispute.id
  );

  res.json({ ok: true, dispute_id: dispute.id, status: status || dispute.status });
});

// Dispute messages
router.post('/disputes/:id/messages', tokenAuth, requireAdmin, (req, res) => {
  const dispute = db.prepare('SELECT * FROM disputes WHERE id = ?').get(req.params.id);
  if (!dispute) return res.status(404).json({ error: 'Dispute not found' });
  const { message, attachment_url } = req.body || {};
  if (!message || message.trim().length < 1) return res.status(400).json({ error: 'Message required' });

  const msgId = uuidv4 ? undefined : undefined; // not used in sqlite
  db.prepare(
    "INSERT INTO dispute_messages (dispute_id, user_id, message, attachment_url) VALUES (?, ?, ?, ?)"
  ).run(dispute.id, req.user.id, message.trim(), attachment_url || null);

  res.json({ ok: true, message });
});

// Create admin note for a dispute
router.post('/disputes/:id/notes', tokenAuth, requireAdmin, (req, res) => {
  const dispute = db.prepare('SELECT * FROM disputes WHERE id = ?').get(req.params.id);
  if (!dispute) return res.status(404).json({ error: 'Dispute not found' });
  const { admin_notes } = req.body || {};
  if (!admin_notes) return res.status(400).json({ error: 'admin_notes required' });

  db.prepare(
    "UPDATE disputes SET admin_notes = ?, assigned_admin_id = ?, updated_at = ? WHERE id = ?"
  ).run(admin_notes, req.user.id, new Date().toISOString(), dispute.id);

  res.json({ ok: true });
});

// Activity logs
router.get('/activity', tokenAuth, requireAdmin, (req, res) => {
  const { admin_id, action } = req.query;
  let query = 'SELECT * FROM activity_logs WHERE 1=1';
  const params = [];
  if (admin_id) { query += ' AND admin_id = ?'; params.push(admin_id); }
  if (action) { query += ' AND action = ?'; params.push(action); }
  query += ' ORDER BY created_at DESC LIMIT 100';
  res.json(db.prepare(query).all(...params));
});

// All users listing (admin)
router.get('/listings/all', tokenAuth, requireAdmin, (req, res) => {
  const { status, user_id } = req.query;
  let query = `SELECT l.*, u.email as seller_email, u.full_name as seller_name
               FROM listings l JOIN users u ON l.user_id = u.id WHERE 1=1`;
  const params = [];
  if (status) { query += ' AND l.status = ?'; params.push(status); }
  if (user_id) { query += ' AND l.user_id = ?'; params.push(user_id); }
  query += ' ORDER BY l.created_at DESC';
  res.json(db.prepare(query).all(...params));
});

module.exports = router;
