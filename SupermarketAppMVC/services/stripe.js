const Stripe = require('stripe');

// Stripe client is created per call to keep config centralized.
function getClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!key.startsWith('sk_')) {
    throw new Error('Stripe secret key must start with "sk_".');
  }
  return new Stripe(key);
}

function toMinorUnits(amount) {
  const value = Number(amount || 0);
  return Math.round(value * 100);
}

// Create a PaymentIntent for card payments (SGD).
async function createPaymentIntent(amount, metadata) {
  const client = getClient();
  if (!client) throw new Error('Stripe secret key is missing.');
  return client.paymentIntents.create({
    amount: toMinorUnits(amount),
    currency: 'sgd',
    payment_method_types: ['card'],
    metadata: metadata || {},
    confirm: false
  });
}

// Confirm a PaymentIntent with card payment method.
async function confirmPaymentIntent(paymentIntentId, paymentMethodId) {
  const client = getClient();
  if (!client) throw new Error('Stripe secret key is missing.');
  return client.paymentIntents.confirm(paymentIntentId, {
    payment_method: paymentMethodId
  });
}

// Create a PayNow PaymentIntent (SGD) for QR code payment.
async function createPayNowIntent(amount, metadata) {
  const client = getClient();
  if (!client) throw new Error('Stripe secret key is missing.');
  const payload = {
    amount: toMinorUnits(amount),
    currency: 'sgd',
    payment_method_types: ['paynow'],
    metadata: metadata || {}
  };
  return client.paymentIntents.create(payload);
}

// Fetch a PaymentIntent to verify status server-side.
async function retrievePaymentIntent(paymentIntentId) {
  const client = getClient();
  if (!client) throw new Error('Stripe secret key is missing.');
  return client.paymentIntents.retrieve(paymentIntentId);
}

// Create a refund for a PaymentIntent (full or partial).
async function createRefund(paymentIntentId, amount) {
  const client = getClient();
  if (!client) throw new Error('Stripe secret key is missing.');
  const payload = { payment_intent: paymentIntentId };
  if (Number.isFinite(amount)) {
    payload.amount = toMinorUnits(amount);
  }
  return client.refunds.create(payload);
}

module.exports = {
  createPaymentIntent,
  confirmPaymentIntent,
  createPayNowIntent,
  retrievePaymentIntent,
  createRefund,
  toMinorUnits
};
