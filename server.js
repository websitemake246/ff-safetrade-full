const express = require('express');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./src/routes/auth');
const listingRoutes = require('./src/routes/listings');
const dealRoutes = require('./src/routes/deals');
const adminRoutes = require('./src/routes/admin');
const userRoutes = require('./src/routes/user');
const jwtFunc = require('./src/middleware/auth');
const { prepare: getPrepare } = require('./src/db');

const { tokenAuth, requireAdmin } = jwtFunc;
const appDir = path.resolve();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(appDir, 'public')));
app.use('/static', express.static(path.join(appDir, 'public')));

// Pass the db prepare function to routes
const db = getPrepare();
app.use((req, res, next) => {
  req.db = db;
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/listings', listingRoutes);
app.use('/api/deals', dealRoutes);
app.use('/api/user', tokenAuth, userRoutes);
app.use('/api/admin', tokenAuth, requireAdmin, adminRoutes);

app.get('/api/session', (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return res.json({ authenticated: false });
  try {
    const decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'ff-safetrade-secret-key-change-in-production');
    const user = req.db('SELECT id, username, email, full_name, role, verification_status FROM users WHERE id = ?').get(decoded.id);
    if (!user) return res.json({ authenticated: false });
    res.json({ authenticated: true, user });
  } catch (e) {
    res.json({ authenticated: false });
  }
});

app.get('/', (req, res) => res.sendFile(path.join(appDir, 'public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(appDir, 'public', 'index.html')));
app.get('/register', (req, res) => res.sendFile(path.join(appDir, 'public', 'index.html')));
app.get('/portal', tokenAuth, (req, res) => res.sendFile(path.join(appDir, 'public', 'portal.html')));
app.get('/admin', tokenAuth, requireAdmin, (req, res) => res.sendFile(path.join(appDir, 'public', 'admin.html')));
app.get('*', (req, res) => res.sendFile(path.join(appDir, 'public', 'index.html')));

app.use((err, req, res, next) => {
  console.error('Global error:', err);
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

const server = app.listen(PORT, '0.0.0.0', () => console.log('FF SafeTrade running on port', PORT));

module.exports = { app, server, db };