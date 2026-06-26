const express = require('express');
const path = require('path');
const cors = require('cors');

const authRoutes = require('./src/routes/auth');
const listingRoutes = require('./src/routes/listings');
const dealRoutes = require('./src/routes/deals');
const adminRoutes = require('./src/routes/admin');
const userRoutes = require('./src/routes/user');
const jwtFunc = require('./src/middleware/auth');
const { init: initDB } = require('./src/db');
const { init: initPaystack } = require('./src/utils/paystack');
require('dotenv').config();

const { tokenAuth, requireAdmin } = jwtFunc;
const appDir = path.resolve();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.set('json spaces', 2);
app.use('/static', express.static(path.join(appDir, 'public')));

const db = initDB(appDir);
initPaystack();

app.use('/api/auth', authRoutes);
app.use('/api/listings', listingRoutes);
app.use('/api/deals', dealRoutes);
app.use('/api/user', tokenAuth, userRoutes);
app.use('/api/admin', tokenAuth, requireAdmin, adminRoutes);

app.get('/api/session', tokenAuth, (req, res) => res.json({ authenticated: true, user: req.user }));

// Serve SPA
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

app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

const server = app.listen(PORT, () => console.log('FF SafeTrade running on port', PORT));
module.exports = { app, server, db };
