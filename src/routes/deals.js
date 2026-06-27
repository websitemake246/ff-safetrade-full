const express = require('express');
const { v4: uuidv4 } = require('uuid');
const jwtFunc = require('../middleware/auth');
const db = require('../db');

const { tokenAuth } = jwtFunc;

const router = express.Router();

const MIDDLEMAN_FEE_KOBO = 100000; // ₦1,000

// Start a deal - buyer initiates purchase
router.post('/', tokenAuth, (req, res) => {
  const { listing_id } = req.body || {};
  if (!listing_id) return res.status(400).json({ error: 'listing_id required' });

  const listing = db.prepare("SELECT l.*, u.id as seller_id FROM listings l JOIN users u ON l.user_id = u.id WHERE l.id = ? AND l.status = 'open'").get(listing_id);
  if (!listing || !listing.seller_id) return res.status(404).json({ error: 'Listing not found or not available' });
  if (listing.seller_id === req.user.id) return res.status(400).json({ error: 'Cannot buy your own listing' });

  const dealId = uuidv4();
  const amountKobo = Number(listing.price_kobo || 0);
  
  db.prepare('INSERT INTO deals (id, listing_id, buyer_id, seller_id, amount_kobo, middleman_fee_kobo, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(dealId, listing_id, req.user.id, listing.seller_id, amountKobo, MIDDLEMAN_FEE_KOBO, 'pending_payment');

  res.json({ 
    id: dealId, 
    amount_kobo: amountKobo, 
    middleman_fee_kobo: MIDDLEMAN_FEE_KOBO, 
    total_kobo: amountKobo + MIDDLEMAN_FEE_KOBO, 
    status: 'pending_payment' 
  });
});

// Paystack payment callback / manual payment confirmation
router.post('/:id/pay', tokenAuth, (req, res) => {
  const { paystack_ref } = req.body || {};
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });
  if (deal.buyer_id !== req.user.id) return res.status(403).json({ error: 'Not allowed' });
  if (deal.status !== 'pending_payment') return res.status(400).json({ error: 'Invalid state for payment' });

  const ref = paystack_ref || 'manual_' + uuidv4().slice(0, 24);
  db.prepare("UPDATE deals SET status = 'payment_confirmed', paystack_ref = ?, updated_at = ? WHERE id = ?")
    .run(ref, new Date().toISOString(), deal.id);
  
  // Notify seller to upload credentials
  db.prepare("INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)")
    .run(deal.seller_id, 'deal', 'Payment confirmed', JSON.stringify({ deal_id: deal.id, message: 'Buyer payment confirmed. Upload Free Fire account credentials.' }));

  res.json({ id: deal.id, status: 'payment_confirmed', paystack_ref: ref, message: 'Payment confirmed. Seller will upload credentials.' });
});

// Seller uploads account credentials (visible to admin only initially)
router.post('/:id/upload-credentials', tokenAuth, (req, res) => {
  const { ff_email, ff_password, ff_uid, notes } = req.body || {};
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });
  if (deal.seller_id !== req.user.id) return res.status(403).json({ error: 'Not allowed' });
  if (deal.status !== 'payment_confirmed') return res.status(400).json({ error: 'Payment not confirmed yet' });

  const credentials = { ff_email, ff_password, ff_uid, notes: notes || '', uploaded_at: new Date().toISOString() };
  db.prepare("UPDATE deals SET seller_account_details = ?, status = 'accounts_shared', accounts_shared_at = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(credentials), new Date().toISOString(), new Date().toISOString(), deal.id);

  // Notify admin for verification
  const admins = db.prepare("SELECT * FROM users WHERE role = 'admin'").all();
  admins.forEach(admin => {
    db.prepare("INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)")
      .run(admin.id, 'deal', 'Credentials uploaded', JSON.stringify({ deal_id: deal.id, message: 'Seller uploaded account credentials. Awaiting admin verification.' }));
  });

  res.json({ id: deal.id, status: 'accounts_shared', message: 'Credentials uploaded. Awaiting admin verification.' });
});

// Admin verifies credentials and releases to buyer
router.post('/:id/verify', tokenAuth, (req, res) => {
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  if (deal.status !== 'accounts_shared') return res.status(400).json({ error: 'No credentials to verify' });

  db.prepare("UPDATE deals SET status = 'verified', updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), deal.id);

  // Notify buyer
  db.prepare("INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)")
    .run(deal.buyer_id, 'deal', 'Account verified', JSON.stringify({ deal_id: deal.id, message: 'Admin verified account credentials. You can now view them.' }));

  res.json({ id: deal.id, status: 'verified', message: 'Credentials verified and shared with buyer.' });
});

// Buyer views verified credentials
router.get('/:id/credentials', tokenAuth, (req, res) => {
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });
  if (deal.buyer_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Not allowed' });
  if (!['verified', 'accounts_shared', 'completed'].includes(deal.status)) return res.status(400).json({ error: 'Credentials not available yet' });

  let credentials = deal.seller_account_details;
  try { credentials = JSON.parse(credentials || '{}'); } catch { credentials = {}; }
  res.json({ credentials });
});

// Buyer confirms successful login
router.post('/:id/confirm', tokenAuth, (req, res) => {
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });
  if (deal.buyer_id !== req.user.id) return res.status(403).json({ error: 'Only buyer can confirm' });
  if (deal.status !== 'verified') return res.status(400).json({ error: 'Deal not verified yet' });

  db.prepare("UPDATE deals SET status = 'completed', buyer_confirmed = 1, completed_at = ?, updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), new Date().toISOString(), deal.id);

  // Trigger payout to seller
  db.prepare("INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)")
    .run(deal.seller_id, 'payout', 'Deal completed', JSON.stringify({ deal_id: deal.id, amount_kobo: deal.amount_kobo, message: 'Buyer confirmed. Payout initiated.' }));

  // Notify admin for manual payout processing
  const admins = db.prepare("SELECT * FROM users WHERE role = 'admin'").all();
  admins.forEach(admin => {
    db.prepare("INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)")
      .run(admin.id, 'payout', 'Process payout', JSON.stringify({ deal_id: deal.id, seller_id: deal.seller_id, amount_kobo: deal.amount_kobo }));
  });

  res.json({ id: deal.id, status: 'completed', message: 'Deal completed. Payout processing.' });
});

// Buyer raises dispute
router.post('/:id/dispute', tokenAuth, (req, res) => {
  const { reason } = req.body || {};
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });
  if (deal.buyer_id !== req.user.id) return res.status(403).json({ error: 'Only buyer can raise dispute' });
  if (deal.status === 'completed') return res.status(400).json({ error: 'Cannot dispute completed deal' });
  if (!reason || reason.trim().length < 10) return res.status(400).json({ error: 'Reason must be at least 10 characters' });

  const disputeId = uuidv4();
  db.prepare('INSERT INTO disputes (id, deal_id, opened_by, reason, status) VALUES (?, ?, ?, ?, ?)')
    .run(disputeId, deal.id, req.user.id, reason.trim(), 'open');
  
  db.prepare("UPDATE deals SET status = 'disputed', dispute_reason = ?, disputed_at = ?, updated_at = ? WHERE id = ?")
    .run(reason.trim(), new Date().toISOString(), new Date().toISOString(), deal.id);

  res.json({ id: disputeId, deal_id: deal.id, status: 'open', message: 'Dispute raised for admin review.' });
});

// Get user's deals
router.get('/my', tokenAuth, (req, res) => {
  const rows = db.prepare(
    "SELECT d.*, l.title, l.platform, l.price_kobo FROM deals d JOIN listings l ON d.listing_id = l.id WHERE d.buyer_id = ? OR d.seller_id = ?"
  ).all(req.user.id, req.user.id);
  res.json(rows);
});

// Get deal details
router.get('/:id', tokenAuth, (req, res) => {
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });
  if (deal.buyer_id !== req.user.id && deal.seller_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Not allowed' });
  
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(deal.listing_id);
  res.json({ ...deal, listing });
});

module.exports = router;