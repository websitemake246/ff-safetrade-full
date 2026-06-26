const axios = require('axios');
const database = require('../db');
require('dotenv').config();

const db = database.getDB();
const apiKey = __lookupEnv('PAYSTACK_SECRET_KEY') || 'sk_test_xxxx';
const BASE = 'https://api.paystack.co';
const FEE = 100000;

function __lookupEnv(k) { return process.env[k]; }

const client = axios.create({
  baseURL: BASE,
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  }
});

function debitCustomer(authCode, amountKobo, description) {
  return client.post('/transaction/charge_authorization', {
    authorization_code: authCode,
    amount: amountKobo,
    email: 'customer@example.com',
    description
  });
}

function getTransactionStatus(reference) {
  return client.get('/transaction/verify/' + encodeURIComponent(reference));
}

function initiateTransfer(recipientCode, amountKobo, reason) {
  return client.post('/transfer', {
    amount: amountKobo,
    recipient: recipientCode,
    reason
  });
}

function init() {
  // noop placeholder for consistency
}

module.exports = {
  client,
  debitCustomer,
  getTransactionStatus,
  initiateTransfer,
  init,
  MIDDLEMAN_FEE_KOBO: FEE
};
