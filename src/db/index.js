const fs = require('fs');
const path = require('path');

const DB_DIR = () => path.join(__dirname, '..', '..', 'data');
const DB_FILE = () => path.join(DB_DIR(), 'safetrade.json');

function ensureStore() {
  fs.mkdirSync(DB_DIR(), { recursive: true });
  if (!fs.existsSync(DB_FILE())) {
    fs.writeFileSync(DB_FILE(), JSON.stringify({ users: [], listings: [], deals: [], disputes: [], dispute_messages: [], activity_logs: [] }));
  }
}

function load() {
  return JSON.parse(fs.readFileSync(DB_FILE(), 'utf8'));
}

function save(data) {
  fs.writeFileSync(DB_FILE(), JSON.stringify(data, null, 2));
}

function nextId(arr) {
  return arr.length ? Math.max(0, ...arr.map((x) => Number(x.id || 0))) + 1 : 1;
}

function prepare(sql) {
  const base = sql.trim().replace(/;$/g, '');
  const src = base.toLowerCase();

  return {
    get(...args) {
      const rows = this.all(...args);
      return rows[0] || { count: 0 };
    },
    all(...args) {
      if (src.startsWith('select count(*)')) {
        if (src.includes("role = 'user'")) return [{ count: load().users.filter(r => r.role === 'user').length }];
        if (src.includes("role = 'admin'")) return [{ count: load().users.filter(r => r.role === 'admin').length }];
        if (src.includes('from listings')) {
          if (src.includes("status = 'open'")) return [{ count: load().listings.filter(r => r.status === 'open').length }];
          return [{ count: load().listings.length }];
        }
        if (src.includes('from deals')) {
          if (src.includes("status = 'pending_payment'")) return [{ count: load().deals.filter(r => r.status === 'pending_payment').length }];
          if (src.includes("status in ('payment_confirmed','accounts_shared')")) return [{ count: load().deals.filter(r => ['payment_confirmed','accounts_shared'].includes(r.status)).length }];
          if (src.includes("status = 'completed'")) return [{ count: load().deals.filter(r => r.status === 'completed').length }];
          if (src.includes("status = 'disputed'")) return [{ count: load().deals.filter(r => r.status === 'disputed').length }];
          return [{ count: load().deals.length }];
        }
        return [{ count: 0 }];
      }

      if (src.startsWith('select coalesce(')) {
        const field = src.includes('amount_kobo') ? 'amount_kobo' : 'middleman_fee_kobo';
        const total = load().deals.filter(r => r.status === 'completed').reduce((s, r) => s + Number(r[field] || 0), 0);
        return [{ volume: total, revenue: total }];
      }

      const db = load();
      const users = db.users || [];
      const listings = db.listings || [];
      const deals = db.deals || [];
      const disputes = db.disputes || [];
      const dm = db.dispute_messages || [];
      const logs = db.activity_logs || [];

      if (src.startsWith('select * from users where email = ?')) {
        const row = users.find(r => r.email.toLowerCase() === String(args[0]).toLowerCase());
        return row ? [row] : [];
      }
      if (src.startsWith('select id, email, full_name, role, verification_status from users where id = ?')) {
        const row = users.find(r => Number(r.id) === Number(args[0]));
        return row ? [{ id: row.id, email: row.email, full_name: row.full_name, role: row.role, verification_status: row.verification_status }] : [];
      }
      if (src.startsWith('select * from users where id = ?')) {
        const row = users.find(r => Number(r.id) === Number(args[0]));
        return row ? [row] : [];
      }

      if (src.startsWith('select * from listings where user_id = ?')) {
        const rows = listings.filter(r => Number(r.user_id) === Number(args[0]));
        rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        return rows;
      }

      if (src.startsWith('select l.*, u.email as seller_email, u.full_name as seller_name\n               from listings l\n               join users u on l.user_id = u.id\n               where l.id = ?')) {
        const l = listings.find(r => Number(r.id) === Number(args[0]));
        if (!l) return [];
        const u = users.find(r => Number(r.id) === Number(l.user_id));
        return [{ ...l, seller_email: u ? u.email : '', seller_name: u ? u.full_name : '' }];
      }

      if (src.startsWith('select l.*, u.email as seller_email, u.full_name as seller_name, u.verification_status\n               from listings l join users u on l.user_id = u.id where 1=1')) {
        let rows = listings.map(l => {
          const u = users.find(r => Number(r.id) === Number(l.user_id));
          return { ...l, seller_email: u ? u.email : '', seller_name: u ? u.full_name : '', seller_verification_status: u ? u.verification_status : '' };
        });
        if (args.length === 1 && args[0]) rows = rows.filter(r => r.status === args[0]);
        if (args.length === 2 && args[1] != null) rows = rows.filter(r => Number(r.user_id) === Number(args[1]));
        rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        return rows;
      }

      if (src.startsWith('select l.*, u.email as seller_email, u.full_name as seller_name\n               from listings l\n               join users u on l.user_id = u.id\n               where 1=1')) {
        let rows = listings.map(l => {
          const u = users.find(r => Number(r.id) === Number(l.user_id));
          return { ...l, seller_email: u ? u.email : '', seller_name: u ? u.full_name : '' };
        });
        if (args.length && typeof args[0] === 'string') rows = rows.filter(r => r.status === args[0]);
        if (args.length === 2 && args[1] != null) rows = rows.filter(r => Number(r.user_id) === Number(args[1]));
        rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        return rows;
      }

      if (src.startsWith('select l.*, u.email as seller_email, u.full_name as seller_name\n               from listings l\n               join users u on l.user_id = u.id\n               where l.status = \'open\' and l.expires_at > ?')) {
        const [now, platform, minP, maxP, verified] = args;
        let rows = listings.map(l => {
          const u = users.find(r => Number(r.id) === Number(l.user_id));
          return { ...l, seller_email: u ? u.email : '', seller_name: u ? u.full_name : '' };
        });
        rows = rows.filter(r => r.status === 'open' && (!r.expires_at || r.expires_at > (now || new Date().toISOString())));
        if (platform) rows = rows.filter(r => r.platform === platform);
        if (minP != null) rows = rows.filter(r => Number(r.price_kobo) >= Number(minP));
        if (maxP != null) rows = rows.filter(r => Number(r.price_kobo) <= Number(maxP));
        if (verified === 'true') rows = rows.filter(r => Boolean(r.verified));
        rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        return rows;
      }

      if (src.startsWith('select d.*, l.title, l.platform, u1.email as buyer_email, u2.email as seller_email,\n                      b.full_name as buyer_name, s.full_name as seller_name\n               from deals d\n               join listings l on d.listing_id = l.id\n               join users u1 on d.buyer_id = u1.id\n               join users u2 on d.seller_id = u2.id\n               join users b on d.buyer_id = b.id\n               join users s on d.seller_id = s.id\n               where 1=1')) {
        const rows = deals.map(d => {
          const l = listings.find(x => Number(x.id) === Number(d.listing_id));
          const b = users.find(x => Number(x.id) === Number(d.buyer_id));
          const s = users.find(x => Number(x.id) === Number(d.seller_id));
          return { ...d, title: l ? l.title : '', platform: l ? l.platform : '', buyer_email: b ? b.email : '', seller_email: s ? s.email : '', buyer_name: b ? b.full_name : '', seller_name: s ? s.full_name : '' };
        });
        if (args.length === 1 && args[0]) rows = rows.filter(r => r.status === args[0]);
        if (args.length === 2 && args[1]) rows = rows.filter(r => r.id === args[1]);
        rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        return rows;
      }

      if (src.startsWith('select d.*, l.title, l.platform, l.price_kobo from deals d join listings l on d.listing_id = l.id where d.id = ?')) {
        const d = deals.find(r => r.id === String(args[0]));
        if (!d) return [];
        const l = listings.find(x => Number(x.id) === Number(d.listing_id));
        return [{ ...d, title: l ? l.title : '', platform: l ? l.platform : '', price_kobo: l ? l.price_kobo : 0 }];
      }

      if (src.startsWith('select d.*, deal.listing_id, deal.amount_kobo,\n                      u1.email as opened_by_email, u2.email as seller_email, u3.email as buyer_email\n               from disputes d\n               join deals deal on d.deal_id = deal.id\n               join users u1 on d.opened_by = u1.id\n               join users u2 on deal.seller_id = u2.id\n               join users u3 on deal.buyer_id = u3.id\n               where 1=1')) {
        return disputes.map(d => {
          const deal = deals.find(r => r.id === String(d.deal_id));
          const o = users.find(r => Number(r.id) === Number(d.opened_by));
          const s = deal ? users.find(r => Number(r.id) === Number(deal.seller_id)) : null;
          const b = deal ? users.find(r => Number(r.id) === Number(deal.buyer_id)) : null;
          return { ...d, listing_id: deal ? deal.listing_id : '', amount_kobo: deal ? deal.amount_kobo : 0, opened_by_email: o ? o.email : '', seller_email: s ? s.email : '', buyer_email: b ? b.email : '' };
        });
      }

      if (src.startsWith('select * from disputes where deal_id = ?')) return disputes.filter(r => r.deal_id === String(args[0])) || [];
      if (src.startsWith('select id from disputes where deal_id = ?')) {
        const d = disputes.find(r => r.deal_id === String(args[0]));
        return d ? [{ id: d.id }] : [];
      }

      if (src.startsWith('select * from deals where id = ?')) {
        const row = deals.find(r => r.id === String(args[0]));
        return row ? [row] : [];
      }

      if (src.startsWith('select * from dispute_messages where dispute_id = ? order by created_at asc')) {
        return dm.filter(r => String(r.dispute_id) === String(args[0])).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      }

      if (src.startsWith('select id, email, full_name from users where id = ?')) {
        const row = users.find(r => Number(r.id) === Number(args[0]));
        return row ? [{ id: row.id, email: row.email, full_name: row.full_name }] : [];
      }

      if (src.startsWith('select * from activity_logs where 1=1')) {
        let rows = logs.slice();
        if (args.length === 2) rows = rows.filter(r => Number(r.admin_id) === Number(args[0]) && r.action === args[1]);
        if (args.length === 1) rows = rows.filter(r => Number(r.admin_id) === Number(args[0]));
        rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        return rows.slice(0, 100);
      }

      return [];
    },
    run(...args) {
      const db = load();
      const out = { changes: 0 };

      function updUsers(whereId, changes) {
        const i = db.users.findIndex(r => Number(r.id) === Number(whereId));
        if (i < 0) return out;
        db.users[i] = { ...db.users[i], ...changes, updated_at: new Date().toISOString() };
        save(db);
        out.changes = 1;
        return out;
      }

      function updListings(whereId, changes) {
        const i = db.listings.findIndex(r => String(r.id) === String(whereId));
        if (i < 0) return out;
        db.listings[i] = { ...db.listings[i], ...changes, updated_at: new Date().toISOString() };
        save(db);
        out.changes = 1;
        return out;
      }

      function updDeals(whereId, changes) {
        const i = db.deals.findIndex(r => r.id === String(whereId));
        if (i < 0) return out;
        db.deals[i] = { ...db.deals[i], ...changes, updated_at: new Date().toISOString() };
        save(db);
        out.changes = 1;
        return out;
      }

      function updDisputes(whereId, changes) {
        if (!db.disputes) db.disputes = [];
        const i = db.disputes.findIndex(r => String(r.id) === String(whereId));
        if (i < 0) return out;
        db.disputes[i] = { ...db.disputes[i], ...changes, updated_at: new Date().toISOString() };
        save(db);
        out.changes = 1;
        return out;
      }

      if (/update listings set view_count = view_count \+ 1 where id = \?/.test(base)) {
        const cur = Number((db.listings || []).find(r => r.id === String(args[0]))?.view_count || 0);
        return updListings(args[0], { view_count: cur + 1 });
      }

      if (/update listings set title=\?, platform=\?, description=\?, price_kobo=\?, evidence_urls=\?, account_details=\?, updated_at=\? where id=\?/.test(base)) {
        return updListings(args[7], {
          title: args[0], platform: args[1], description: args[1], price_kobo: args[2],
          evidence_urls: typeof args[3] === 'string' ? args[3] : JSON.stringify(args[3] || []),
          account_details: typeof args[4] === 'string' ? args[4] : JSON.stringify(args[4] || {}),
        });
      }

      if (/update users set verification_status = \?, is_verified = \?, updated_at = \? where id = \?/.test(base)) {
        return updUsers(args[3], { verification_status: args[0], is_verified: Number(args[1]) ? 1 : 0 });
      }

      if (/\bupdate deals set status = \'completed\', completed_at = \?, updated_at = \? where id = \?/.test(base)) {
        return updDeals(args[2], { status: 'completed', completed_at: args[0] });
      }

      if (/update deals set status = \'released\', updated_at = \? where id = \?/.test(base)) {
        return updDeals(args[1], { status: 'released' });
      }

      if (/update deals set status = \'payment_confirmed\', paystack_ref/.test(base)) {
        return updDeals(args[2], { status: 'payment_confirmed', paystack_ref: args[0] });
      }

      if (/update deals set status = \?, updated_at = \? where id = \?/.test(base)) {
        return updDeals(args[2], { status: args[0] });
      }

      if (/\bupdate deals set (.+?) where id = \?/.test(base)) {
        const keys = base.match(/update deals set (.+?) where id = \?/)[1].split(',').map((s) => s.trim().split('=')[0].trim());
        const last = args[args.length - 1];
        const obj = {};
        args.slice(0, -1).forEach((v, idx) => { if (keys[idx]) obj[keys[idx]] = v; });
        return updDeals(last, obj);
      }

      if (/update disputes set status = \?, resolution = \?, admin_notes = \?, assigned_admin_id = \?, resolved_at = \? where id = \?/.test(base)) {
        return updDisputes(args[5], { status: args[0], resolution: args[1], admin_notes: args[2], assigned_admin_id: args[3], resolved_at: args[4] });
      }

      if (/update disputes set admin_notes = \?, assigned_admin_id = \?, updated_at = \? where id = \?/.test(base)) {
        return updDisputes(args[3], { admin_notes: args[0], assigned_admin_id: args[1], updated_at: args[2] });
      }

      if (/\binsert into users \(email, password, full_name, role, verification_status\) values \(\?, \?, \?, \?, \?\)/.test(base)) {
        if (db.users.some(r => r.email.toLowerCase() === String(args[0]).toLowerCase())) throw new Error('Email already in use');
        const rec = {
          id: nextId(db.users), email: args[0], password: args[1], full_name: args[2], role: args[3], verification_status: args[4],
          phone: null, is_verified: 0, discord_id: null, paystack_customer_code: null,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString()
        };
        db.users.push(rec);
        save(db);
        return { lastInsertRowid: rec.id };
      }

      if (/\binsert into listings \(user_id, title, platform, description, price_kobo, evidence_urls, account_details, status, expires_at\) values \(\?, \?, \?, \?, \?, \?, \?, \?, \?\)/.test(base)) {
        const rec = {
          id: nextId(db.listings), user_id: args[0], title: args[1], platform: args[2], description: args[3] || '',
          price_kobo: Number(args[4]), evidence_urls: typeof args[5] === 'string' ? args[5] : JSON.stringify(args[5] || []),
          account_details: typeof args[6] === 'string' ? args[6] : JSON.stringify(args[6] || {}),
          status: args[7], expires_at: args[8], verified: 0, view_count: 0,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString()
        };
        db.listings.push(rec);
        save(db);
        return { lastInsertRowid: rec.id };
      }

      if (/\binsert into deals \(id, listing_id, buyer_id, seller_id, amount_kobo, middleman_fee_kobo, paystack_ref, status, auto_release_at\) values \(\?, \?, \?, \?, \?, \?, \?, \?, \?\)/.test(base)) {
        const rec = {
          id: args[0] || String(nextId(db.deals)), listing_id: args[1], buyer_id: args[2], seller_id: args[3],
          amount_kobo: args[4], middleman_fee_kobo: args[5], paystack_ref: args[6], status: args[7], auto_release_at: args[8],
          buyer_confirmed: 0, seller_confirmed: 0, accounts_shared_at: null, completed_at: null, disputed_at: null, dispute_reason: null,
          evidence_urls: '[]', created_at: new Date().toISOString(), updated_at: new Date().toISOString()
        };
        db.deals.push(rec);
        const l = (db.listings || []).find(x => Number(x.id) === Number(args[1]));
        if (l) { l.status = 'pending_payment'; l.updated_at = new Date().toISOString(); }
        save(db);
        return { lastInsertRowid: rec.id };
      }

      if (/\binsert into disputes \(id, deal_id, opened_by, reason, status\) values \(\?, \?, \?, \?, \?\)/.test(base)) {
        const rec = { id: args[0], deal_id: String(args[1]), opened_by: args[2], reason: args[3], status: args[4], resolution: null, admin_notes: null, assigned_admin_id: null, resolved_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        db.disputes = db.disputes || [];
        db.disputes.push(rec);
        save(db);
        return rec;
      }

      if (/\binsert into dispute_messages \(dispute_id, user_id, message, attachment_url\) values \(\?, \?, \?, \?\)/.test(base)) {
        const rec = { id: nextId(dm), dispute_id: String(args[0]), user_id: args[1], message: args[2], attachment_url: args[3] || null, created_at: new Date().toISOString() };
        db.dispute_messages = db.dispute_messages || [];
        db.dispute_messages.push(rec);
        save(db);
        return rec;
      }

      if (/\binsert into activity_logs \(admin_id, action, target_type, target_id, details\) values \(\?, \?, \?, \?, \?\)/.test(base)) {
        const rec = { id: nextId(logs), admin_id: args[0], action: args[1], target_type: args[2], target_id: args[3], details: args[4], ip_address: args[5] || null, created_at: new Date().toISOString() };
        db.activity_logs = logs;
        db.activity_logs.push(rec);
        save(db);
        return rec;
      }

      return out;
    }
  };
}

function init() {
  ensureStore();
  return {
    prepare
  };
}

let _db = null;
function getDB() {
  if (!_db) _db = init();
  return _db;
}
module.exports = { init, getDB };
