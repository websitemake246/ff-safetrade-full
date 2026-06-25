const Database = require('better-sqlite3');

let db;

function init(dataDir) {
  const dbDir = dataDir || __dirname;
  const dbPath = require('path').join(dbDir, '..', 'data', 'safetrade.db');
  const fs = require('fs');
  fs.mkdirSync(require('path').dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // Users
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      full_name TEXT NOT NULL,
      phone TEXT,
      role TEXT DEFAULT 'user' CHECK(role IN ('user','admin','moderator')),
      is_verified INTEGER DEFAULT 0,
      verification_status TEXT DEFAULT 'unverified' CHECK(verification_status IN ('unverified','pending','verified','rejected')),
      discord_id TEXT UNIQUE,
      paystack_customer_code TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Listings
  db.exec(`
    CREATE TABLE IF NOT EXISTS listings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      platform TEXT NOT NULL,
      description TEXT,
      price_kobo INTEGER NOT NULL,
      verified BOOLEAN DEFAULT 0,
      status TEXT DEFAULT 'open' CHECK(status IN ('open','sold','expired','suspended','pending_verification')),
      evidence_urls TEXT DEFAULT '[]',
      account_details TEXT DEFAULT '{}',
      verification_notes TEXT,
      view_count INTEGER DEFAULT 0,
      expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Deals
  db.exec(`
    CREATE TABLE IF NOT EXISTS deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id INTEGER NOT NULL,
      buyer_id INTEGER NOT NULL,
      seller_id INTEGER NOT NULL,
      paystack_ref TEXT UNIQUE,
      amount_kobo INTEGER NOT NULL,
      middleman_fee_kobo INTEGER NOT NULL DEFAULT 100000,
      status TEXT DEFAULT 'pending_payment' CHECK(status IN ('pending_payment','payment_confirmed','accounts_shared','completed','disputed','refunded','expired')),
      buyer_confirmed BOOLEAN DEFAULT 0,
      seller_confirmed BOOLEAN DEFAULT 0,
      accounts_shared_at DATETIME,
      completed_at DATETIME,
      disputed_at DATETIME,
      auto_release_at DATETIME,
      dispute_reason TEXT,
      evidence_urls TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (listing_id) REFERENCES listings(id),
      FOREIGN KEY (buyer_id) REFERENCES users(id),
      FOREIGN KEY (seller_id) REFERENCES users(id)
    )
  `);

  // Disputes
  db.exec(`
    CREATE TABLE IF NOT EXISTS disputes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL UNIQUE,
      opened_by INTEGER NOT NULL,
      reason TEXT NOT NULL,
      status TEXT DEFAULT 'open' CHECK(status IN ('open','investigating','resolved','closed','escalated')),
      resolution TEXT,
      admin_notes TEXT,
      assigned_admin_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME,
      FOREIGN KEY (deal_id) REFERENCES deals(id),
      FOREIGN KEY (opened_by) REFERENCES users(id),
      FOREIGN KEY (assigned_admin_id) REFERENCES users(id)
    )
  `);

  // Dispute Messages
  db.exec(`
    CREATE TABLE IF NOT EXISTS dispute_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dispute_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      attachment_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (dispute_id) REFERENCES disputes(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Admin Activity Log
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id INTEGER,
      details TEXT DEFAULT '{}',
      ip_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (admin_id) REFERENCES users(id)
    )
  `);

  // Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
    CREATE INDEX IF NOT EXISTS idx_listings_user_id ON listings(user_id);
    CREATE INDEX IF NOT EXISTS idx_deals_status ON deals(status);
    CREATE INDEX IF NOT EXISTS idx_deals_buyer_id ON deals(buyer_id);
    CREATE INDEX IF NOT EXISTS idx_deals_seller_id ON deals(seller_id);
    CREATE INDEX IF NOT EXISTS idx_deals_listing_id ON deals(listing_id);
    CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status);
    CREATE INDEX IF NOT EXISTS idx_disputes_deal_id ON disputes(deal_id);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  `);

  // Seed admin if not exists
  const adminExists = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@safetrade.com');
  if (!adminExists) {
    const bcrypt = require('bcryptjs');
    const passwordHash = bcrypt.hashSync('admin123', 10);
    db.prepare(
      'INSERT INTO users (email, password, full_name, role, is_verified, verification_status) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('admin@safetrade.com', passwordHash, 'Admin', 'admin', 1, 'verified');
  }

  return db;
}

function getDB() {
  if (!db) throw new Error('Database not initialized. Call init() first.');
  return db;
}

module.exports = { init, getDB };
