const stripe = require('../services/stripe');
const { computeCartPricing } = require('../services/subscriptionPricing');
const vouchers = require('../services/vouchers');
const CartController = require('./CartController');
const User = require('../models/User');

function getSubscriptionCheckout(req) {
  const tier = (req.session.subscription_checkout_tier || '').toLowerCase();
  const price = Number(req.session.subscription_checkout_price || 0);
  return { tier, price };
}

module.exports = {
  // Creates a PaymentIntent for cart checkout.
  async createOrderIntent(req, res) {
    try {
      const cart = req.session.cart || [];
      if (!cart.length) return res.status(400).json({ error: 'Cart is empty.' });
      // Amount is computed server-side to prevent tampering.
      const voucher = await vouchers.resolveAppliedVoucher(req);
      const pricing = computeCartPricing(cart, req.session.user, voucher);
      if (pricing.voucherRejected) {
        req.session.applied_voucher = null;
      }
      req.session.checkout_cart = (cart || []).map((item) => ({
        productId: item.productId,
        productName: item.productName,
        price: Number(item.price),
        originalPrice: Number(item.originalPrice),
        discountApplied: !!item.discountApplied,
        quantity: Number(item.quantity) || 0,
        image: item.image
      }));
      req.session.checkout_voucher = voucher ? { id: voucher.id, code: voucher.code, amount: Number(voucher.amount) } : null;
      req.session.checkout_total = pricing.total.toFixed(2);
      req.session.checkout_source = 'stripe';
      const intent = await stripe.createPaymentIntent(pricing.total, {
        type: 'order',
        user_id: String(req.session.user.id || '')
      });
      return res.json({ clientSecret: intent.client_secret });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to create Stripe payment intent.', message: err.message });
    }
  },

  // Creates a PayNow PaymentIntent for cart checkout.
  async createOrderPayNowIntent(req, res) {
    try {
      const cart = req.session.cart || [];
      if (!cart.length) return res.status(400).json({ error: 'Cart is empty.' });
      const voucher = await vouchers.resolveAppliedVoucher(req);
      const pricing = computeCartPricing(cart, req.session.user, voucher);
      if (pricing.voucherRejected) {
        req.session.applied_voucher = null;
      }
      req.session.checkout_cart = (cart || []).map((item) => ({
        productId: item.productId,
        productName: item.productName,
        price: Number(item.price),
        originalPrice: Number(item.originalPrice),
        discountApplied: !!item.discountApplied,
        quantity: Number(item.quantity) || 0,
        image: item.image
      }));
      req.session.checkout_voucher = voucher ? { id: voucher.id, code: voucher.code, amount: Number(voucher.amount) } : null;
      req.session.checkout_total = pricing.total.toFixed(2);
      req.session.checkout_source = 'paynow';
      const intent = await stripe.createPayNowIntent(pricing.total, {
        type: 'order',
        user_id: String(req.session.user.id || '')
      });
      return res.json({
        intentId: intent.id,
        clientSecret: intent.client_secret,
        status: intent.status
      });
    } catch (err) {
      console.error('PayNow intent failed:', err);
      return res.status(500).json({ error: 'Failed to create PayNow payment intent.', message: err.message });
    }
  },

  // Returns status for a PaymentIntent (used for PayNow polling).
  async getIntentStatus(req, res) {
    try {
      const paymentIntentId = req.params.id;
      if (!paymentIntentId) return res.status(400).json({ error: 'Missing payment intent.' });
      const intent = await stripe.retrievePaymentIntent(paymentIntentId);
      return res.json({
        id: intent.id,
        status: intent.status,
        lastError: intent.last_payment_error ? intent.last_payment_error.code : null
      });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to fetch payment status.', message: err.message });
    }
  },

  // Verifies Stripe result and completes the order.
  async completeOrder(req, res) {
    try {
      const paymentIntentId = req.body.payment_intent;
      const deliveryAddress = (req.body.delivery_address || '').trim();
      const deliveryContact = (req.body.delivery_contact || '').trim();
      if (!paymentIntentId) {
        req.flash('error', 'Stripe payment not confirmed.');
        return res.redirect('/purchase');
      }
      if (!deliveryAddress) {
        req.flash('error', 'Please provide a delivery address.');
        return res.redirect('/purchase');
      }
      const cart = req.session.checkout_cart || req.session.cart || [];
      if (!cart.length) {
        req.flash('error', 'Your cart is empty.');
        return res.redirect('/cart');
      }
      // Confirm with Stripe that the PaymentIntent succeeded.
      const intent = await stripe.retrievePaymentIntent(paymentIntentId);
      if (!intent || intent.status !== 'succeeded') {
        req.flash('error', 'Stripe payment was not authorized.');
        return res.redirect('/purchase');
      }
      // Recompute total and ensure it matches the captured amount.
      const voucher = req.session.checkout_voucher || await vouchers.resolveAppliedVoucher(req);
      const pricing = computeCartPricing(cart, req.session.user, voucher);
      if (pricing.voucherRejected) {
        req.session.applied_voucher = null;
      }
      if (stripe.toMinorUnits(pricing.total) !== intent.amount) {
        req.flash('error', 'Stripe payment amount mismatch.');
        return res.redirect('/purchase');
      }
      req.session.checkout_address = deliveryAddress;
      req.session.checkout_contact = deliveryContact;
      req.session.payment_method = req.session.checkout_source === 'paynow' ? 'paynow' : 'stripe';
      req.session.payment_provider = 'stripe';
      req.session.payment_reference = paymentIntentId;
      req.session.payment_flow = 'stripe';
      return CartController.checkout(req, res);
    } catch (err) {
      req.flash('error', 'Stripe payment verification failed.');
      return res.redirect('/purchase');
    }
  },

  // Creates a PaymentIntent for subscription upgrade.
  async createSubscriptionIntent(req, res) {
    try {
      const { tier, price } = getSubscriptionCheckout(req);
      if (!tier || price <= 0) {
        return res.status(400).json({ error: 'Subscription details expired.' });
      }
      const intent = await stripe.createPaymentIntent(price, {
        type: 'subscription',
        tier
      });
      return res.json({ clientSecret: intent.client_secret });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to create Stripe payment intent.', message: err.message });
    }
  },

  // Creates a PayNow PaymentIntent for subscription upgrade.
  async createSubscriptionPayNowIntent(req, res) {
    try {
      const { tier, price } = getSubscriptionCheckout(req);
      if (!tier || price <= 0) {
        return res.status(400).json({ error: 'Subscription details expired.' });
      }
      const intent = await stripe.createPayNowIntent(price, {
        type: 'subscription',
        tier
      });
      return res.json({
        intentId: intent.id,
        clientSecret: intent.client_secret,
        status: intent.status
      });
    } catch (err) {
      console.error('PayNow subscription intent failed:', err);
      return res.status(500).json({ error: 'Failed to create PayNow payment intent.', message: err.message });
    }
  },

  // Verifies Stripe result and upgrades the user's tier.
  async completeSubscription(req, res) {
    try {
      const paymentIntentId = req.body.payment_intent;
      const { tier, price } = getSubscriptionCheckout(req);
      if (!paymentIntentId || !tier || price <= 0) {
        req.flash('error', 'Subscription payment not confirmed.');
        return res.redirect('/subscription');
      }
      const intent = await stripe.retrievePaymentIntent(paymentIntentId);
      if (!intent || intent.status !== 'succeeded') {
        req.flash('error', 'Stripe payment was not authorized.');
        return res.redirect('/subscription');
      }
      if (stripe.toMinorUnits(price) !== intent.amount) {
        req.flash('error', 'Stripe payment amount mismatch.');
        return res.redirect('/subscription');
      }
      const startedAt = new Date();
      User.updateSubscription(req.session.user.id, tier, price, startedAt, (err) => {
        if (err) {
          req.flash('error', 'Failed to update subscription.');
          return res.redirect('/subscription');
        }
        req.session.user.subscription_tier = tier;
        req.session.user.subscription_price = price;
        req.session.user.subscription_started_at = startedAt;
        req.session.subscription_checkout_tier = null;
        req.session.subscription_checkout_price = null;
        req.flash('success', 'Subscription upgraded successfully.');
        return res.redirect('/subscription');
      });
    } catch (err) {
      req.flash('error', 'Stripe payment verification failed.');
      return res.redirect('/subscription');
    }
  }
};
