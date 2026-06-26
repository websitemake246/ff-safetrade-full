const express = require('express');
const { v4: uuidv4 } = require('uuid');
const jwtFunc = require('../middleware/auth');
const database = require('../db');
require('dotenv').config();

const db = database.getDB();
const { tokenAuth } = jwtFunc;
const MIDDLEMAN_FEE_KOBO = 100000;

function ensureDigits16(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length !== 16) return null;
  return digits;
}

function luhnOk(digits16) {
  let sum = 0; let alt = false;
  for (let i = digits16.length - 1; i >= 0; i--) {
    let d = Number(digits16[i]);
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d; alt = !alt;
  }
  return sum % 10 === 0;
}

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ ok: true, endpoints: ['/:id/pay', '/:id/upload', '/:id/confirm-accounts', '/:id/confirm-receipt', '/:id/dispute'] });
});

// Start deal
router.post('/', tokenAuth, (req, res) => {
  const { listing_id, card_last_four, card_expiry_month, card_expiry_year, card_brand } = req.body || {};
  if (!listing_id) return res.status(400).json({ error: 'listing_id required' });

  const listing = db.prepare(
    "SELECT l.*, u.email as seller_email FROM listings l JOIN users u ON l.user_id = u.id WHERE l.id = ? AND l.status = 'open'"
  ).get(listing_id);
  if (!listing) return res.status(404).json({ error: 'Listing not found or not available' });
  if (listing.user_id === req.user.id) return res.status(400).json({ error: 'Cannot buy your own listing' });
  if (listing.expires_at && listing.expires_at < new Date().toISOString()) return res.status(400).json({ error: 'Listing has expired' });

  const amountKobo = Number(listing.price_kobo);
  const buyerId = req.user.id;
  const buyerUser = db.prepare('SELECT * FROM users WHERE id = ?').get(buyerId);
  if ((!card_last_four || !/^\d{4}$/.test(card_last_four)) && buyerUser.verification_status !== 'verified') {
    return res.status(400).json({ error: 'card_last_four required for unverified buyers' });
  }

  const dealId = uuidv4();
  db.prepare(
    `INSERT INTO deals (id, listing_id, buyer_id, seller_id, amount_kobo, middleman_fee_kobo, paystack_ref, status, auto_release_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(dealId, listing_id, buyerId, listing.user_id, amountKobo, MIDDLEMAN_FEE_KOBO, null, 'pending_payment', new Date(Date.now() + 7*24*60*60*1000).toISOString());
  db.prepare("UPDATE listings SET status = 'pending_payment' WHERE id = ?").run(listing_id);

  res.json({ id: dealId, amount_kobo: amountKobo, middleman_fee_kobo: MIDDLEMAN_FEE_KOBO, total_kobo: amountKobo + MIDDLEMAN_FEE_KOBO, listing, status: 'pending_payment', message: 'Deal created. Complete payment.' });
});

// Simulate payment confirmation
router.post('/:id/pay', tokenAuth, (req, res) => {
  const { listing_id, card_last_four, card_expiry_month, card_expiry_year, card_brand } = req.body || {};
  const deal = db.prepare("SELECT d.*, l.title, l.platform, l.price_kobo FROM deals d JOIN listings l ON d.listing_id = l.id WHERE d.id = ?").get(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });
  if (deal.buyer_id !== req.user.id) return res.status(403).json({ error: 'Not allowed' });
  if (deal.status !== 'pending_payment') return res.status(400).json({ error: 'Already paid or invalid' });

  const last4Raw = String(card_last_four || '').replace(/\D/g, '');
  if (!/^\d{4}$/.test(last4Raw)) return res.status(400).json({ error: 'Provide last 4 digits of card (digits only)' });
  const full16Digits = '4111' + last4Raw + '0000000000';
  if (!luhnOk(full16Digits)) return res.status(400).json({ error: 'Invalid card - Luhn check failed' });

  const paystack_ref = 'pstk_' + uuidv4().replace(/-/g, '').slice(0, 24);
  db.prepare("UPDATE deals SET status = 'payment_confirmed', paystack_ref = ?, updated_at = ? WHERE id = ?").run(paystack_ref, new Date().toISOString(), deal.id);

  // Notify seller
  const seller = db.prepare('SELECT email, full_name FROM users WHERE id = ?').get(deal.seller_id);
  db.prepare("INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)").run(deal.seller_id, 'deal', 'Payment received', JSON.stringify({ deal_id: deal.id, message: 'Buyer payment confirmed. Upload account details.' }));

  res.json({ id: deal.id, status: 'payment_confirmed', paystack_ref, amount_kobo: deal.amount_kobo, middleman_fee_kobo: MIDDLEMAN_FEE_KOBO, message: 'Payment confirmed. Share account details now.' });
});

// Seller uploads account details
router.post('/:id/upload', tokenAuth, (req, res) => {
  const { account_details, note } = req.body || {};
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });
  if (deal.seller_id !== req.user.id) return res.status(403).json({ error: 'Not allowed' });
  if (!['payment_confirmed', 'accounts_shared'].includes(deal.status)) return res.status(400).json({ error: 'Buyer has not paid yet' });

  const joined = { ...(typeof account_details === 'string' ? JSON.parse(account_details || '{}') : (account_details || {})), uploaded_at: new Date().toISOString(), note: note || '' };
  db.prepare("UPDATE deals SET seller_account_details = ?, status = 'accounts_shared', accounts_shared_at = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(joined), new Date().toISOString(), new Date().toISOString(), deal.id);

  db.prepare("INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)").run(deal.buyer_id, 'deal', 'Account shared', JSON.stringify({ deal_id: deal.id, message: 'Seller uploaded account details. Verify before confirming.' }));

  res.json({ id: deal.id, status: 'accounts_shared', message: 'Account details shared with admin/buyer.' });
});

// Confirm accounts shared
router.post('/:id/confirm-accounts', tokenAuth, (req, res) => {
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });
  if (deal.buyer_id !== req.user.id) return res.status(403).json({ error: 'Not allowed' });
  if (deal.status !== 'accounts_shared') return res.status(400).json({ error: 'Invalid state' });

  db.prepare("UPDATE deals SET status = 'confirmed', buyer_confirmed = 0, updated_at = ? WHERE id = ?").run(new Date().toISOString(), deal.id);
  res.json({ id: deal.id, status: 'confirmed', message: 'Accounts verified. Complete payment to confirm receipt.' });
});

// Buyer confirms receipt -> completed
router.post('/:id/confirm-receipt', tokenAuth, (req, res) => {
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });
  if (deal.buyer_id !== req.user.id) return res.status(403).json({ error: 'Only buyer can confirm receipt' });
  if (!['accounts_shared', 'confirmed', 'payment_confirmed'].includes(deal.status)) return res.status(400).json({ error: 'Invalid state' });

  db.prepare("UPDATE deals SET buyer_confirmed = 1, status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?").run(new Date().toISOString(), new Date().toISOString(), deal.id);
  db.prepare("UPDATE listings SET status = 'sold' WHERE id = ?").run(deal.listing_id);
  res.json({ id: deal.id, status: 'completed', message: 'Deal completed.' });
});

// Dispute
router.post('/:id/dispute', tokenAuth, (req, res) => {
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });
  const isParticipant = req.user.id === deal.buyer_id || req.user.id === deal.seller_id || req.user.role === 'admin';
  if (!isParticipant) return res.status(403).json({ error: 'Not allowed' });
  if (deal.status === 'completed') return res.status(400).json({ error: 'Cannot dispute completed deal' });

  const { reason } = req.body || {};
  if (!reason || reason.trim().length < 10) return res.status(400).json({ error: 'Reason must be at least 10 characters' });

  const disputeId = uuidv4();
  db.prepare(`INSERT INTO disputes (id, deal_id, opened_by, reason, status) VALUES (?, ?, ?, ?, ?)`).run(disputeId, deal.id, req.user.id, reason.trim(), 'open');
  db.prepare("UPDATE deals SET status = 'disputed', dispute_reason = ?, disputed_at = ?, updated_at = ? WHERE id = ?").run(reason.trim(), new Date().toISOString(), new Date().toISOString(), deal.id);
  res.json({ id: disputeId, deal_id: deal.id, status: 'open', message: 'Dispute opened.' });
});

module.exports = router;
