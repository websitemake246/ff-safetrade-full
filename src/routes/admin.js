const express = require('express');
const jwtFunc = require('../middleware/auth');
const db = require('../db');
const { v4: uuidv4 } = require('uuid');

const { tokenAuth, requireAdmin } = jwtFunc;

const router = express.Router();

// Get dashboard stats
router.get('/stats', tokenAuth, requireAdmin, (req, res) => {
  const totalUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'user'").get().count;
  const totalDeals = db.prepare("SELECT COUNT(*) as count FROM deals").get().count;
  const openListings = db.prepare("SELECT COUNT(*) as count FROM listings WHERE status = 'open'").get().count;
  const pendingDeals = db.prepare("SELECT COUNT(*) as count FROM deals WHERE status = 'pending_payment'").get().count;
  const activeDeals = db.prepare("SELECT COUNT(*) as count FROM deals WHERE status IN ('payment_confirmed', 'accounts_shared', 'verified')").get().count;
  const completedDeals = db.prepare("SELECT COUNT(*) as count FROM deals WHERE status = 'completed'").get().count;
  const disputedDeals = db.prepare("SELECT COUNT(*) as count FROM deals WHERE status = 'disputed'").get().count;
  
  const feesResult = db.prepare("SELECT SUM(middleman_fee_kobo) as total FROM deals WHERE status = 'completed'").get();
  const feesCollected = feesResult.total || 0;
  
  const volumeResult = db.prepare("SELECT SUM(amount_kobo) as total FROM deals WHERE status = 'completed'").get();
  const totalVolume = volumeResult.total || 0;

  res.json({
    totalUsers,
    totalDeals,
    openListings,
    pendingDeals,
    activeDeals,
    completedDeals,
    disputedDeals,
    feesCollected,
    totalVolume
  });
});

// Get all users
router.get('/users', tokenAuth, requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT id, username, email, phone, full_name, role, verification_status, is_verified, created_at FROM users ORDER BY created_at DESC").all();
  res.json(rows);
});

// Get all deals
router.get('/deals', tokenAuth, requireAdmin, (req, res) => {
  const rows = db.prepare(
    "SELECT d.*, l.title, l.platform, l.price_kobo, b.username as buyer_username, s.username as seller_username FROM deals d JOIN listings l ON d.listing_id = l.id JOIN users b ON d.buyer_id = b.id JOIN users s ON d.seller_id = s.id ORDER BY d.created_at DESC"
  ).all();
  res.json(rows);
});

// Get deal details with credentials
router.get('/deals/:id', tokenAuth, requireAdmin, (req, res) => {
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });
  
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(deal.listing_id);
  const buyer = db.prepare('SELECT id, username, email, phone FROM users WHERE id = ?').get(deal.buyer_id);
  const seller = db.prepare('SELECT id, username, email, phone, bank_name, account_number, account_name FROM users WHERE id = ?').get(deal.seller_id);
  
  let credentials = deal.seller_account_details;
  try { credentials = JSON.parse(credentials || '{}'); } catch { credentials = {}; }
  
  res.json({ ...deal, listing, buyer, seller, credentials });
});

// Verify credentials and release to buyer
router.post('/deals/:id/verify', tokenAuth, requireAdmin, (req, res) => {
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });
  if (deal.status !== 'accounts_shared') return res.status(400).json({ error: 'No credentials to verify' });

  db.prepare("UPDATE deals SET status = 'verified', updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), deal.id);

  db.prepare("INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)")
    .run(deal.buyer_id, 'deal', 'Account verified', JSON.stringify({ deal_id: deal.id, message: 'Admin verified account credentials. You can now view them.' }));

  res.json({ id: deal.id, status: 'verified', message: 'Credentials verified and shared with buyer.' });
});

// Reject credentials and notify seller
router.post('/deals/:id/reject', tokenAuth, requireAdmin, (req, res) => {
  const { reason } = req.body || {};
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });
  if (deal.status !== 'accounts_shared') return res.status(400).json({ error: 'Invalid state' });

  db.prepare("UPDATE deals SET status = 'payment_confirmed', seller_account_details = NULL, updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), deal.id);

  db.prepare("INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)")
    .run(deal.seller_id, 'deal', 'Credentials rejected', JSON.stringify({ deal_id: deal.id, message: 'Admin rejected credentials: ' + (reason || 'Please provide valid Free Fire account details.'), reason }));

  res.json({ id: deal.id, status: 'payment_confirmed', message: 'Credentials rejected. Seller must re-upload.' });
});

// Release funds to seller (manual payout confirmation)
router.post('/deals/:id/payout', tokenAuth, requireAdmin, (req, res) => {
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });
  if (deal.status !== 'completed') return res.status(400).json({ error: 'Deal not completed' });

  const seller = db.prepare('SELECT bank_name, account_number, account_name FROM users WHERE id = ?').get(deal.seller_id);
  
  // Log payout
  db.prepare("INSERT INTO activity_logs (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)")
    .run(req.user.id, 'payout', 'deal', deal.id, JSON.stringify({ amount_kobo: deal.amount_kobo, seller_id: deal.seller_id, bank: seller?.bank_name, account: seller?.account_number }));

  db.prepare("INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)")
    .run(deal.seller_id, 'payout', 'Payout sent', JSON.stringify({ deal_id: deal.id, amount_kobo: deal.amount_kobo, message: 'Admin confirmed payout to your bank account.' }));

  res.json({ id: deal.id, status: 'paid_out', message: 'Payout confirmed and seller notified.' });
});

// Get all disputes
router.get('/disputes', tokenAuth, requireAdmin, (req, res) => {
  const rows = db.prepare(
    "SELECT d.*, l.title, l.platform, b.username as buyer_username, s.username as seller_username, b.id as buyer_id, s.id as seller_id FROM disputes d JOIN deals deal ON d.deal_id = deal.id JOIN listings l ON deal.listing_id = l.id JOIN users b ON deal.buyer_id = b.id JOIN users s ON deal.seller_id = s.id ORDER BY d.created_at DESC"
  ).all();
  res.json(rows);
});

// Get dispute details with messages
router.get('/disputes/:id', tokenAuth, requireAdmin, (req, res) => {
  const dispute = db.prepare('SELECT * FROM disputes WHERE id = ?').get(req.params.id);
  if (!dispute) return res.status(404).json({ error: 'Dispute not found' });
  
  const messages = db.prepare('SELECT dm.*, u.username as user_username, u.role as user_role FROM dispute_messages dm JOIN users u ON dm.user_id = u.id WHERE dm.dispute_id = ? ORDER BY dm.created_at ASC').all(dispute.id);
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(dispute.deal_id);
  
  res.json({ dispute, messages, deal });
});

// Post admin message to dispute
router.post('/disputes/:id/message', tokenAuth, requireAdmin, (req, res) => {
  const { message } = req.body || {};
  const dispute = db.prepare('SELECT * FROM disputes WHERE id = ?').get(req.params.id);
  if (!dispute) return res.status(404).json({ error: 'Dispute not found' });
  if (!message || message.trim().length < 2) return res.status(400).json({ error: 'Message required' });

  const msgId = uuidv4();
  db.prepare('INSERT INTO dispute_messages (id, dispute_id, user_id, message, attachment_url) VALUES (?, ?, ?, ?, ?)')
    .run(msgId, dispute.id, req.user.id, message.trim(), null);

  // Notify both parties
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(dispute.deal_id);
  if (deal) {
    db.prepare("INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)")
      .run(deal.buyer_id, 'dispute', 'Admin message', JSON.stringify({ dispute_id: dispute.id, message }));
    db.prepare("INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)")
      .run(deal.seller_id, 'dispute', 'Admin message', JSON.stringify({ dispute_id: dispute.id, message }));
  }

  res.json({ id: msgId, ok: true });
});

// Resolve dispute
router.post('/disputes/:id/resolve', tokenAuth, requireAdmin, (req, res) => {
  const { resolution, refund_buyer } = req.body || {}; // refund_buyer: true = refund buyer, false = pay seller
  const dispute = db.prepare('SELECT * FROM disputes WHERE id = ?').get(req.params.id);
  if (!dispute) return res.status(404).json({ error: 'Dispute not found' });
  if (dispute.status !== 'open') return res.status(400).json({ error: 'Dispute already resolved' });

  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(dispute.deal_id);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });

  const newStatus = refund_buyer ? 'refunded' : 'completed';
  db.prepare("UPDATE disputes SET status = 'resolved', resolution = ?, resolved_at = ?, updated_at = ? WHERE id = ?")
    .run(resolution || 'Resolved by admin', new Date().toISOString(), new Date().toISOString(), dispute.id);
  
  db.prepare("UPDATE deals SET status = ?, updated_at = ? WHERE id = ?")
    .run(newStatus, new Date().toISOString(), deal.id);

  // Notify parties
  if (refund_buyer) {
    db.prepare("INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)")
      .run(deal.buyer_id, 'dispute', 'Dispute resolved - Refund', JSON.stringify({ deal_id: deal.id, resolution }));
    db.prepare("INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)")
      .run(deal.seller_id, 'dispute', 'Dispute resolved - Lost', JSON.stringify({ deal_id: deal.id, resolution }));
  } else {
    db.prepare("INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)")
      .run(deal.buyer_id, 'dispute', 'Dispute resolved - Completed', JSON.stringify({ deal_id: deal.id, resolution }));
    db.prepare("INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)")
      .run(deal.seller_id, 'dispute', 'Dispute resolved - Won', JSON.stringify({ deal_id: deal.id, resolution }));
    
    // Trigger payout
    db.prepare("INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)")
      .run(deal.seller_id, 'payout', 'Payout initiated', JSON.stringify({ deal_id: deal.id, amount_kobo: deal.amount_kobo }));
  }

  res.json({ id: dispute.id, status: 'resolved', deal_status: newStatus, message: 'Dispute resolved.' });
});

module.exports = router;