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
    metadata: metadata || {}
  });
}

// Fetch a PaymentIntent to verify status server-side.
async function retrievePaymentIntent(paymentIntentId) {
  const client = getClient();
  if (!client) throw new Error('Stripe secret key is missing.');
  return client.paymentIntents.retrieve(paymentIntentId);
}

module.exports = {
  createPaymentIntent,
  retrievePaymentIntent,
  toMinorUnits
};
