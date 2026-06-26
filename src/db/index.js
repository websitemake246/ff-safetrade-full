const fs = require('fs');
const path = require('path');

const DEFAULT_DATA_DIR = () => path.join(__dirname, '..', '..', 'data');

function ensureFile(dataDir) {
  const dbPath = path.join(dataDir, 'safetrade.json');
  fs.mkdirSync(dataDir || DEFAULT_DATA_DIR(), { recursive: true });
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify({ users: [], listings: [], deals: [], disputes: [], dispute_messages: [], activity_logs: [] }, null, 2));
  }
  return dbPath;
}

function readDb() {
  const dbPath = ensureFile();
  return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
}

function writeDb(data) {
  const dbPath = ensureFile();
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
}

const READ_THROUGH = Symbol('readThrough');

let store = {};

function reload() {
  store = readDb();
}

reload();

function persist() {
  writeDb(store);
}

function nextId(arr) {
  return arr.length ? Math.max(...arr.map((item) => Number(item.id || 0))) + 1 : 1;
}

function toBool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Boolean(value);
  return value === 1 || value === '1' || value === true;
}

function formatRow(row) {
  const out = Object.assign({}, row);
  if (row && '__v' in out) delete out.__v;
  return out;
}

function whereAll(rows, params, predicates) {
  return rows.filter((row) => {
    for (let i = 0; i < predicates.length; i += 1) {
      const expected = params[predicates[i].param];
      if (predicates[i].fn(row, expected) === false) return false;
    }
    return true;
  });
}

function init(dataDir) {
  const targetDir = dataDir || DEFAULT_DATA_DIR();
  ensureFile(targetDir);
  reload();

  return {
    prepare(sql) {
      const normalized = sql.trim().replace(/;$/g, '');
      const source = normalized.toLowerCase();

      return {
        get(...params) {
          const rows = this.all(...params);
          const row = Array.isArray(rows) ? rows[0] : rows;
          return typeof row === 'undefined' ? undefined : formatRow(row);
        },
        all(...params) {
          if (source.startsWith('select count(*)')) {
            const total = whereAll(store.users, params, [])[0] || {};
            if (source.includes("role = 'user'")) return [{ count: (store.users || []).filter((row) => row.role === 'user').length }];
            if (source.includes("role = 'admin'")) return [{ count: (store.users || []).filter((row) => row.role === 'admin').length }];
            if (source.includes('from listings')) {
              if (source.includes("status = 'open'")) return [{ count: (store.listings || []).filter((row) => row.status === 'open').length }];
              return [{ count: (store.listings || []).length }];
            }
            if (source.includes('from deals')) {
              if (source.includes("status = 'pending_payment'")) return [{ count: (store.deals || []).filter((row) => row.status === 'pending_payment').length }];
              if (source.includes("status in ('payment_confirmed','accounts_shared')")) return [{ count: (store.deals || []).filter((row) => ['payment_confirmed', 'accounts_shared'].includes(row.status)).length }];
              if (source.includes("status = 'completed'")) return [{ count: (store.deals || []).filter((row) => row.status === 'completed').length }];
              if (source.includes("status = 'disputed'")) return [{ count: (store.deals || []).filter((row) => row.status === 'disputed').length }];
              return [{ count: (store.deals || []).length }];
            }
            return [{ count: 0 }];
          }

          if (source.startsWith('select coalesce(')) {
            const target = source.includes('amount_kobo') ? 'amount_kobo' : 'middleman_fee_kobo';
            const total = (store.deals || [])
              .filter((row) => row.status === 'completed')
              .reduce((acc, row) => acc + Number(row[target] || 0), 0);
            return [{ volume: total, revenue: total }];
          }

          if (source.startsWith('select * from users where email = ?')) {
            const email = String(params[0]).toLowerCase();
            const row = (store.users || []).find((item) => item.email.toLowerCase() === email);
            return row ? [formatRow(row)] : [];
          }

          if (source.startsWith('select id, email, full_name, role, verification_status from users where id = ?')) {
            const row = (store.users || []).find((item) => Number(item.id) === Number(params[0]));
            return row ? [formatRow(row)] : [];
          }

          if (source.startsWith('select * from users where id = ?')) {
            const row = (store.users || []).find((item) => Number(item.id) === Number(params[0]));
            return row ? [formatRow(row)] : [];
          }

          if (source.startsWith('select * from listings where user_id = ?')) {
            const rows = (store.listings || []).filter((item) => Number(item.user_id) === Number(params[0]));
            rows.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
            return rows.map(formatRow);
          }

          if (source.startsWith('select l.*, u.email as seller_email, u.full_name as seller_name\n               from listings l\n               join users u on l.user_id = u.id\n               where l.id = ?')) {
            const listing = (store.listings || []).find((item) => Number(item.id) === Number(params[0]));
            if (!listing) return [];
            const seller = (store.users || []).find((item) => Number(item.id) === Number(listing.user_id));
            return [formatRow(Object.assign({}, listing, { seller_email: seller ? seller.email : '', seller_name: seller ? seller.full_name : '' }))];
          }

          if (source.startsWith('select l.*, u.email as seller_email, u.full_name as seller_name\n               from listings l\n               join users u on l.user_id = u.id\n               where 1=1')) {
            let rows = (store.listings || []).map((item) => {
              const seller = (store.users || []).find((user) => Number(user.id) === Number(item.user_id));
              return formatRow(Object.assign({}, item, { seller_email: seller ? seller.email : '', seller_name: seller ? seller.full_name : '' }));
            });
            if (params.length) {
              const [status, user_id] = params;
              if (status) rows = rows.filter((row) => row.status === status);
              if (user_id != null) rows = rows.filter((row) => Number(row.user_id) === Number(user_id));
            }
            rows.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
            return rows;
          }

          if (source.startsWith('select l.*, u.email as seller_email, u.full_name as seller_name, u.verification_status\n               from listings l join users u on l.user_id = u.id where 1=1')) {
            const rows = (store.listings || []).map((item) => {
              const seller = (store.users || []).find((user) => Number(user.id) === Number(item.user_id));
              return formatRow(Object.assign({}, item, { seller_email: seller ? seller.email : '', seller_name: seller ? seller.full_name : '', seller_verification_status: seller ? seller.verification_status : '' }));
            });
            if (params.length === 1 && params[0]) rows = rows.filter((row) => row.status === params[0]);
            if (params.length === 2 && params[1] != null) rows = rows.filter((row) => Number(row.user_id) === Number(params[1]));
            rows.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
            return rows;
          }

          if (source.startsWith('select d.*, l.title, l.platform, u1.email as buyer_email, u2.email as seller_email,\n                      b.full_name as buyer_name, s.full_name as seller_name\n               from deals d\n               join listings l on d.listing_id = l.id\n               join users u1 on d.buyer_id = u1.id\n               join users u2 on d.seller_id = u2.id\n               join users b on d.buyer_id = b.id\n               join users s on d.seller_id = s.id\n               where 1=1')) {
            const rows = (store.deals || []).map((deal) => {
              const listing = (store.listings || []).find((item) => Number(item.id) === Number(deal.listing_id));
              const buyer = (store.users || []).find((item) => Number(item.id) === Number(deal.buyer_id));
              const seller = (store.users || []).find((item) => Number(item.id) === Number(deal.seller_id));
              return formatRow(Object.assign({}, deal, { title: listing ? listing.title : '', platform: listing ? listing.platform : '', buyer_email: buyer ? buyer.email : '', seller_email: seller ? seller.email : '', buyer_name: buyer ? buyer.full_name : '', seller_name: seller ? seller.full_name : '' }));
            });
            if (params.length === 1 && params[0]) rows = rows.filter((row) => row.status === params[0]);
            if (params.length === 2 && params[1]) rows = rows.filter((row) => row.id === params[1]);
            rows.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
            return rows;
          }

          if (source.startsWith('select d.*, l.title, l.platform, l.price_kobo from deals d join listings l on d.listing_id = l.id where d.id = ?')) {
            const deal = (store.deals || []).find((row) => row.id === String(params[0]));
            if (!deal) return [];
            const listing = (store.listings || []).find((item) => Number(item.id) === Number(deal.listing_id));
            return [formatRow(Object.assign({}, deal, { title: listing ? listing.title : '', platform: listing ? listing.platform : '', price_kobo: listing ? listing.price_kobo : 0 }))];
          }

          if (source.startsWith('select l.*, u.email as seller_email, u.full_name as seller_name\n               from listings l\n               join users u on l.user_id = u.id\n               where l.status = \'open\' and l.expires_at > ?')) {
            let rows = (store.listings || []).map((item) => {
              const seller = (store.users || []).find((user) => Number(user.id) === Number(item.user_id));
              return formatRow(Object.assign({}, item, { seller_email: seller ? seller.email : '', seller_name: seller ? seller.full_name : '' }));
            });
            const [nowDate, platform, minPrice, maxPrice, verified] = params;
            rows = rows.filter((row) => row.status === 'open' && (!row.expires_at || row.expires_at > (nowDate || new Date().toISOString())));
            if (platform) rows = rows.filter((row) => row.platform === platform);
            if (minPrice != null) rows = rows.filter((row) => Number(row.price_kobo) >= Number(minPrice));
            if (maxPrice != null) rows = rows.filter((row) => Number(row.price_kobo) <= Number(maxPrice));
            if (verified === 'true') rows = rows.filter((row) => toBool(row.verified));
            rows.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
            return rows;
          }

          if (source.startsWith('select d.*, deal.listing_id, deal.amount_kobo,\n                      u1.email as opened_by_email, u2.email as seller_email, u3.email as buyer_email\n               from disputes d\n               join deals deal on d.deal_id = deal.id\n               join users u1 on d.opened_by = u1.id\n               join users u2 on deal.seller_id = u2.id\n               join users u3 on deal.buyer_id = u3.id\n               where 1=1')) {
            return (store.disputes || []).map((dispute) => {
              const deal = (store.deals || []).find((row) => row.id === String(dispute.deal_id));
              const openedBy = (store.users || []).find((row) => Number(row.id) === Number(dispute.opened_by));
              const seller = deal ? (store.users || []).find((row) => Number(row.id) === Number(deal.seller_id)) : null;
              const buyer = deal ? (store.users || []).find((row) => Number(row.id) === Number(deal.buyer_id)) : null;
              return formatRow(Object.assign({}, dispute, { listing_id: deal ? deal.listing_id : '', amount_kobo: deal ? deal.amount_kobo : 0, opened_by_email: openedBy ? openedBy.email : '', seller_email: seller ? seller.email : '', buyer_email: buyer ? buyer.email : '' }));
            });
          }

          if (source.startsWith('select * from disputes where deal_id = ?')) {
            const dispute = (store.disputes || []).find((row) => row.deal_id === String(params[0]));
            return dispute ? [formatRow(dispute)] : [];
          }

          if (source.startsWith('select id from disputes where deal_id = ?')) {
            const dispute = (store.disputes || []).find((row) => row.deal_id === String(params[0]));
            return dispute ? [{ id: dispute.id }] : [];
          }

          if (source.startsWith('select * from deals where id = ?')) {
            const row = (store.deals || []).find((row) => row.id === String(params[0]));
            return row ? [formatRow(row)] : [];
          }

          if (source.startsWith('select * from dispute_messages where dispute_id = ? order by created_at asc')) {
            return (store.dispute_messages || [])
              .filter((row) => String(row.dispute_id) === String(params[0]))
              .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))
              .map(formatRow);
          }

          if (source.startsWith('select id, email, full_name from users where id = ?')) {
            const row = (store.users || []).find((item) => Number(item.id) === Number(params[0]));
            return row ? [formatRow({ id: row.id, email: row.email, full_name: row.full_name })] : [];
          }

          if (source.startsWith('select * from activity_logs where 1=1')) {
            let rows = (store.activity_logs || []).slice();
            if (params.length === 2) rows = rows.filter((row) => Number(row.admin_id) === Number(params[0]) && row.action === params[1]);
            if (params.length === 1) rows = rows.filter((row) => Number(row.admin_id) === Number(params[0]));
            rows.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
            return rows.slice(0, 100).map(formatRow);
          }

          return [];
        },
        run(...params) {
          const updateLike = /\bupdate\b|\binsert\b|\bdelete\b/.test(source);

          if (/\bupdate listings set view_count = view_count \+ 1 where id = \?/.test(source)) {
            const listing = (store.listings || []).find((row) => row.id === String(params[0]));
            if (listing) {
              listing.view_count = Number(listing.view_count || 0) + 1;
              listing.updated_at = new Date().toISOString();
              persist();
            }
            return { changes: 1 };
          }

          if (/update listings set status = \? where id = \?/.test(source)) {
            const [status, id] = params;
            const listing = (store.listings || []).find((row) => String(row.id) === String(id));
            if (!listing) return { changes: 0 };
            listing.status = status;
            listing.updated_at = new Date().toISOString();
            persist();
            return { changes: 1 };
          }

          if (/update listings set (.*) where id = \?/.test(source)) {
            const values = {};
            const assignmentSource = source.match(/update listings set (.+) where id = \?/)[1];
            const keys = assignmentSource.split(',').map((chunk) => chunk.trim().split('=')[0].trim());
            params.slice(0, -1).forEach((value, idx) => {
              if (idx < keys.length) values[keys[idx]] = value;
            });
            const id = params[params.length - 1];
            const listing = (store.listings || []).find((row) => String(row.id) === String(id));
            if (!listing) return { changes: 0 };
            Object.assign(listing, values, { updated_at: new Date().toISOString() });
            persist();
            return { changes: 1 };
          }

          if (/update users set verification_status = \?, is_verified = \?, updated_at = \? where id = \?/.test(source)) {
            const [status, isVerified, updatedAt, id] = params;
            const user = (store.users || []).find((item) => Number(item.id) === Number(id));
            if (!user) return { changes: 0 };
            user.verification_status = status;
            user.is_verified = toBool(isVerified) ? 1 : 0;
            user.updated_at = updatedAt || new Date().toISOString();
            persist();
            return { changes: 1 };
          }

          if (/update users set (.+?) where id = \?/.test(source) && /email = \?/.test(source) === false) {
            const keys = source.match(/update users set (.+?) where id = \?/)[1].split(',').map((chunk) => chunk.trim().split('=')[0].trim());
            const id = params[params.length - 1];
            const user = (store.users || []).find((item) => Number(item.id) === Number(id));
            if (!user) return { changes: 0 };
            params.slice(0, -1).forEach((value, idx) => {
              if (idx < keys.length) {
                user[keys[idx]] = value;
              }
            });
            user.updated_at = new Date().toISOString();
            persist();
            return { changes: 1 };
          }

          if (/\bupdate deals set status = \'completed\', completed_at = \?, updated_at = \? where id = \?/.test(source)) {
            const [completedAt, updatedAt, id] = params;
            const deal = (store.deals || []).find((row) => row.id === String(id));
            if (!deal) return { changes: 0 };
            deal.status = 'completed';
            deal.completed_at = completedAt || new Date().toISOString();
            deal.updated_at = updatedAt || new Date().toISOString();
            persist();
            return { changes: 1 };
          }

          if (/update deals set status = \'released\', updated_at = \? where id = \?/.test(source)) {
            const [updatedAt, id] = params;
            const deal = (store.deals || []).find((row) => row.id === String(id));
            if (!deal) return { changes: 0 };
            deal.status = 'released';
            deal.updated_at = updatedAt || new Date().toISOString();
            persist();
            return { changes: 1 };
          }

          if (/update deals set status = \'payment_confirmed\', paystack_ref/.test(source) && source.includes('where id = ?')) {
            const [paystack_ref, updatedAt, id] = params;
            const deal = (store.deals || []).find((row) => row.id === String(id));
            if (!deal) return { changes: 0 };
            deal.status = 'payment_confirmed';
            deal.paystack_ref = paystack_ref;
            deal.updated_at = updatedAt || new Date().toISOString();
            persist();
            return { changes: 1 };
          }

          if (source.startsWith('update deals set status = ?, updated_at = ? where id = ?')) {
            const [status, updatedAt, id] = params;
            const deal = (store.deals || []).find((row) => row.id === String(id));
            if (!deal) return { changes: 0 };
            deal.status = status;
            deal.updated_at = updatedAt;
            persist();
            return { changes: 1 };
          }

          if (/update deals set (.+?) where id = \?/.test(source)) {
            const keys = source.match(/update deals set (.+?) where id = \?/)[1].split(',').map((chunk) => chunk.trim().split('=')[0].trim());
            const [last] = params.slice(-1);
            const deal = (store.deals || []).find((row) => row.id === String(last));
            if (!deal) return { changes: 0 };
            params.slice(0, -1).forEach((value, idx) => {
              if (idx < keys.length) {
                deal[keys[idx]] = value;
              }
            });
            deal.updated_at = new Date().toISOString();
            persist();
            return { changes: 1 };
          }

          if (source.startsWith('update disputes set status = ?, resolution = ?, admin_notes = ?, assigned_admin_id = ?, resolved_at = ? where id = ?')) {
            const [status, resolution, admin_notes, assignedAdminId, resolvedAt, id] = params;
            const dispute = (store.disputes || []).find((row) => row.id === String(id));
            if (!dispute) return { changes: 0 };
            dispute.status = status;
            dispute.resolution = resolution;
            dispute.admin_notes = admin_notes;
            dispute.assigned_admin_id = assignedAdminId;
            dispute.resolved_at = resolvedAt;
            dispute.updated_at = new Date().toISOString();
            persist();
            return { changes: 1 };
          }

          if (source.startsWith("update disputes set admin_notes = ?, assigned_admin_id = ?, updated_at = ? where id = ?")) {
            const [admin_notes, assignedAdminId, updatedAt, id] = params;
            const dispute = (store.disputes || []).find((row) => row.id === String(id));
            if (!dispute) return { changes: 0 };
            dispute.admin_notes = admin_notes;
            dispute.assigned_admin_id = assignedAdminId;
            dispute.updated_at = updatedAt || new Date().toISOString();
            persist();
            return { changes: 1 };
          }

          if (/\binsert into users \(email, password, full_name, role, verification_status\) values \(\?, \?, \?, \?, \?\)/.test(source)) {
            const [email, password, full_name, role, verification_status] = params;
            if ((store.users || []).some((row) => row.email.toLowerCase() === String(email).toLowerCase())) {
              throw new Error('Email already in use');
            }
            const info = store.users.insert([email, password, full_name, role, verification_status]);
            return info;
          }

          if (/\binsert into listings \(user_id, title, platform, description, price_kobo, evidence_urls, account_details, status, expires_at\) values \(\?, \?, \?, \?, \?, \?, \?, \?, \?\)/.test(source)) {
            const paramsCopy = Array.from(params);
            paramsCopy[5] = typeof paramsCopy[5] === 'string' ? paramsCopy[5] : JSON.stringify(paramsCopy[5] || []);
            paramsCopy[6] = typeof paramsCopy[6] === 'string' ? paramsCopy[6] : JSON.stringify(paramsCopy[6] || {});
            return store.listings.insert(paramsCopy);
          }

          if (/update listings set title=\?, platform=\?, description=\?, price_kobo=\?, evidence_urls=\?, account_details=\?, updated_at=\? where id=\?/.test(source)) {
            const update = {
              title: params[0],
              platform: params[1],
              description: params[1],
              price_kobo: params[2],
              evidence_urls: typeof params[3] === 'string' ? params[3] : JSON.stringify(params[3] || []),
              account_details: typeof params[4] === 'string' ? params[4] : JSON.stringify(params[4] || {}),
              updated_at: params[5],
            };
            return { changes: store.listings.update(params[6], update) };
          }

          if (/\binsert into deals \(id, listing_id, buyer_id, seller_id, amount_kobo, middleman_fee_kobo, paystack_ref, status, auto_release_at\) values \(\?, \?, \?, \?, \?, \?, \?, \?, \?\)/.test(source)) {
            const paramsCopy = Array.from(params);
            const info = store.deals.insert(paramsCopy);
            const listing = (store.listings || []).find((item) => Number(item.id) === Number(params[1]));
            if (listing) {
              listing.status = 'pending_payment';
              listing.updated_at = new Date().toISOString();
              persist();
            }
            return info;
          }

          if (/\binsert into disputes \(id, deal_id, opened_by, reason, status\) values \(\?, \?, \?, \?, \?\)/.test(source)) {
            return store.disputes.insert(params);
          }

          if (/\binsert into dispute_messages \(dispute_id, user_id, message, attachment_url\) values \(\?, \?, \?, \?\)/.test(source)) {
            return store.dispute_messages.insert(params);
          }

          if (/\binsert into activity_logs \(admin_id, action, target_type, target_id, details\) values \(\?, \?, \?, \?, \?\)/.test(source)) {
            return store.activity_logs.insert([params[0], params[1], params[2], params[3], params[4], null]);
          }

          persist();
          return { changes: 1 };
        },
      };
    },
  };
}

function getDB() {
  throw new Error('Database not initialized. Call init() first.');
}

module.exports = { init, getDB };
