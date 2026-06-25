const express = require('express');
const path = require('path');
const cors = require('cors');

// Core
const authRoutes = require('./routes/auth');
const listingRoutes = require('./routes/listings');
const dealRoutes = require('./routes/deals');
const adminRoutes = require('./routes/admin');
const userRoutes = require('./routes/user');

// Auth
const jwtFunc = require('./middleware/auth');

// DB + Paystack
const { init: initDB } = require('./db');
const { init: initPaystack } = require('./utils/paystack');
require('dotenv').config();

const { tokenAuth, requireAdmin } = jwtFunc;

const __dirname = path.resolve();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'views')));

// Initialize sub-systems
let db = initDB(__dirname);
initPaystack();

// Mount routes
app.use('/api/auth', authRoutes);
app.use('/api/listings', listingRoutes);
app.use('/api/deals', dealRoutes);
app.use('/api/user', tokenAuth, userRoutes);
app.use('/api/admin', tokenAuth, requireAdmin, adminRoutes);

// Root routes
app.get('/', tokenAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// Session check
app.get('/api/session', tokenAuth, (req, res) => {
  res.json({ authenticated: true, user: req.user });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error:', err);
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const server = app.listen(PORT, () => {
  console.log(`FF SafeTrade running on port ${PORT}`);
});

module.exports = { app, server, db };
