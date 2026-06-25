const axios = require('axios') ;
const database = require('../db') ;
require('dotenv').config() ;

const db = database.getDB() ;
const PAYSTACK_SECRET_KEY:proces..._KEY || 'sk_test_xxxx' ;
const PAYSTACK_BASE_URL = 'https://api.paystack.co' ;
const MIDDLEMAN_FEE_KOBO = 100000 ; // 1000 Naira in kobo

const paystack = axios.create({
  baseURL: PAYSTACK_BASE_URL,
  headers: {
    Authorization: *** ${PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json'
  }
})

function debitCustomer(authorizationCode, amountKobo, description) {
  return paystack.post('/transaction/charge_authorization', {
    authorization_code: authorizationCode,
    amount: amountKobo,
    email: 'customer@example.com',
    description
  }) ;
}

function getTransactionStatus(reference) {
  return paystack.get(`/transaction/verify/${encodeURIComponent(reference)}`) ;
}

function initiateTransfer(recipientCode, amountKobo, reason) {
  return paystack.post('/transfer', {
    amount: amountKobo,
    recipient: recipientCode,
    reason
  }) ;
}

function init() {
  // Initialize paystack config from DB if needed
}

module.exports = {
  paystack,
  debitCustomer,
  getTransactionStatus,
  initiateTransfer,
  PAYSTACK_SECRET_KEY,
  PAYSTACK_BASE_URL,
  MIDDLEMAN_FEE_KOBO
} ;
