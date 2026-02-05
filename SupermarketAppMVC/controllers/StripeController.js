/**
 * StripeController
 * - Wraps Stripe PaymentIntent and Checkout Session helpers for cart checkouts and subscription upgrades.
 * - Handles PayNow+Link flows, session cancel URLs, and finalizes orders/subscriptions once Stripe confirms payment.
 */
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

// Normalize finalization logic that different listeners reuse after Stripe confirms payment (card or PayNow).
// PayNow polls the intent via `/api/stripe/intent-status`, then hands the ID to this helper once it succeeds.
async function finalizeStripeOrder(req, res, intent, deliveryAddress, deliveryContact) {
  if (!deliveryAddress) {
    req.flash('error', 'Please provide a delivery address.');
    return res.redirect('/purchase');
  }
  if (!intent || intent.status !== 'succeeded') {
    req.flash('error', 'Stripe payment was not authorized.');
    return res.redirect('/purchase');
  }
  const cart = req.session.checkout_cart || req.session.cart || [];
  if (!cart.length) {
    req.flash('error', 'Your cart is empty.');
    return res.redirect('/cart');
  }
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
  req.session.payment_reference = intent.id;
  req.session.payment_flow = 'stripe';
  return CartController.checkout(req, res);
}

// Normalize subscription upgrade completion once Stripe notifies us of a paid intent.
function finalizeStripeSubscription(req, res, intent) {
  const { tier, price } = getSubscriptionCheckout(req);
  if (!tier || price <= 0) {
    req.flash('error', 'Subscription details expired.');
    return res.redirect('/subscription');
  }
  if (!intent || intent.status !== 'succeeded') {
    req.flash('error', 'Stripe payment was not authorized.');
    return res.redirect('/subscription');
  }
  if (stripe.toMinorUnits(price) !== intent.amount) {
    req.flash('error', 'Stripe payment amount mismatch.');
    return res.redirect('/subscription');
  }
  const startedAt = new Date();
  req.session.subscription_payment_flow = 'stripe';
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
    req.session.subscription_payment_flow = null;
    req.flash('success', 'Subscription upgraded successfully.');
    return res.redirect('/subscription');
  });
}

module.exports = {
  // Creates a PaymentIntent for cart checkout.
  async createOrderIntent(req, res) {
    try {
      // Snapshot cart + totals before redirecting to Stripe.
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
      // Stripe PI ties amount to the user and prevents tampering.
      const intent = await stripe.createPaymentIntent(pricing.total, {
        type: 'order',
        user_id: String(req.session.user.id || '')
      });
      return res.json({ clientSecret: intent.client_secret });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to create Stripe payment intent.', message: err.message });
    }
  },

  // Creates a PayNow PaymentIntent for cart checkout (used by the client to render QR/instructions).
  /**
   * Creates a Stripe PayNow PaymentIntent for cart checkout.
   * The client uses the returned clientSecret / intentId to confirm PayNow,
   * render the QR code, and then poll the intent status until Stripe reports succeeded.
   * Once the QR is paid, the client submits the stored intentId back through /stripe/order/complete.
   */
  async createOrderPayNowIntent(req, res) {
    try {
      // PayNow uses Stripe-hosted PI but is confirmed out-of-band.
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

  async createOrderCheckoutSession(req, res) {
    try {
      const deliveryAddress = (req.body.delivery_address || '').trim();
      const deliveryContact = (req.body.delivery_contact || '').trim();
      if (!deliveryAddress) {
        return res.status(400).json({ error: 'Please provide a delivery address.' });
      }
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
      req.session.checkout_source = 'stripe';
      req.session.checkout_address = deliveryAddress;
      req.session.checkout_contact = deliveryContact;
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const successUrl = `${baseUrl}/stripe/checkout/success?session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${baseUrl}/purchase`;
      const session = await stripe.createCheckoutSession(pricing.total, {
        type: 'order',
        user_id: String(req.session.user.id || ''),
        description: 'Cart checkout'
      }, successUrl, cancelUrl);
      return res.json({ sessionId: session.id });
    } catch (err) {
      console.error('Checkout session error:', err);
      return res.status(500).json({ error: 'Failed to create Stripe checkout session.', message: err.message });
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

  async checkoutSuccess(req, res) {
    const sessionId = req.query.session_id;
    if (!sessionId) {
      req.flash('error', 'Missing Stripe session.');
      return res.redirect('/purchase');
    }
    try {
      const session = await stripe.retrieveCheckoutSession(sessionId);
      if (!session || session.payment_status !== 'paid' || !session.payment_intent) {
        req.flash('error', 'Stripe payment was not confirmed.');
        return res.redirect('/purchase');
      }
      const intent = await stripe.retrievePaymentIntent(session.payment_intent);
      const deliveryAddress = (req.session.checkout_address || '').trim();
      const deliveryContact = (req.session.checkout_contact || '').trim();
      return finalizeStripeOrder(req, res, intent, deliveryAddress, deliveryContact);
    } catch (err) {
      console.error('Stripe checkout success error:', err);
      req.flash('error', 'Stripe payment verification failed.');
      return res.redirect('/purchase');
    }
  },

  async subscriptionCheckoutSuccess(req, res) {
    const sessionId = req.query.session_id;
    if (!sessionId) {
      req.flash('error', 'Missing Stripe session.');
      return res.redirect('/subscription');
    }
    try {
      const session = await stripe.retrieveCheckoutSession(sessionId);
      if (!session || session.payment_status !== 'paid' || !session.payment_intent) {
        req.flash('error', 'Stripe payment was not confirmed.');
        return res.redirect('/subscription');
      }
      const intent = await stripe.retrievePaymentIntent(session.payment_intent);
      return finalizeStripeSubscription(req, res, intent);
    } catch (err) {
      console.error('Stripe subscription checkout success error:', err);
      req.flash('error', 'Stripe payment verification failed.');
      return res.redirect('/subscription');
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
      const intent = await stripe.retrievePaymentIntent(paymentIntentId);
      return finalizeStripeOrder(req, res, intent, deliveryAddress, deliveryContact);
    } catch (err) {
      req.flash('error', 'Stripe payment verification failed.');
      return res.redirect('/purchase');
    }
  },

  async createSubscriptionCheckoutSession(req, res) {
    try {
      const { tier, price } = getSubscriptionCheckout(req);
      if (!tier || price <= 0) {
        return res.status(400).json({ error: 'Subscription details expired.' });
      }
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const successUrl = `${baseUrl}/stripe/subscription/checkout/success?session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${baseUrl}/subscription/checkout?tier=${encodeURIComponent(tier)}`;
      const session = await stripe.createCheckoutSession(price, {
        type: 'subscription',
        tier
      }, successUrl, cancelUrl);
      return res.json({ sessionId: session.id });
    } catch (err) {
      console.error('Subscription checkout session error:', err);
      return res.status(500).json({ error: 'Failed to create Stripe checkout session.', message: err.message });
    }
  },

  // Creates a Stripe PaymentIntent for direct subscription payments.
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

  // Creates a PayNow PaymentIntent for subscription upgrades (flow mirrors the cart PayNow QR flow).
  /**
   * Creates a Stripe PayNow PaymentIntent specifically for a subscription tier.
   * The subscription page reuses the same confirm/poll UI as the cart flow and
   * ultimately posts the intentId to /stripe/subscription/complete after success.
   */
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

  async completeSubscription(req, res) {
    try {
      const paymentIntentId = req.body.payment_intent;
      if (!paymentIntentId) {
        req.flash('error', 'Subscription payment not confirmed.');
        return res.redirect('/subscription');
      }
      const intent = await stripe.retrievePaymentIntent(paymentIntentId);
      return finalizeStripeSubscription(req, res, intent);
    } catch (err) {
      req.flash('error', 'Stripe payment verification failed.');
      return res.redirect('/subscription');
    }
  }
};
