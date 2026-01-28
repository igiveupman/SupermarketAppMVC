/**
 * SubscriptionController
 * - Show subscription tiers and handle upgrades
 */
const User = require('../models/User');
const paypal = require('../services/paypal');
const netsQr = require('../services/nets');

const TIERS = [
  {
    id: 'basic',
    name: 'Basic',
    price: 0,
    savings: 'Monthly savings: $0 (pay-as-you-go rates)',
    benefits: [
      'Standard member pricing',
      'Order tracking and receipts',
      'Digital invoices on every order'
    ]
  },
  {
    id: 'essential',
    name: 'Essential',
    price: 5.9,
    savings: 'Monthly savings: free delivery on $40+ orders + $5 reward at 20 orders',
    benefits: [
      'Everything in Basic',
      'Free delivery over $40',
      'One-time $5 voucher after 20 orders'
    ]
  },
  {
    id: 'premium',
    name: 'Premium',
    price: 12.9,
    savings: 'Monthly savings: free delivery + monthly voucher + $20 reward at 20 orders',
    benefits: [
      'Everything in Essential',
      'Free delivery on all orders',
      'Monthly voucher added to your account',
      'One-time $20 voucher after 20 orders'
    ]
  }
];

const TIER_ORDER = TIERS.reduce((acc, tier, idx) => {
  acc[tier.id] = idx;
  return acc;
}, {});

function formatMoney(value) {
  return Number(value || 0).toFixed(2);
}

function nextBillingDate(startDate) {
  if (!startDate) return null;
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return null;
  const next = new Date(start);
  next.setMonth(next.getMonth() + 1);
  return next.toISOString().slice(0, 10);
}

function getTierById(tierId) {
  return TIERS.find((tier) => tier.id === tierId);
}

function applySubscriptionUpgrade(req, res, tier) {
  const startedAt = new Date();
  User.updateSubscription(req.session.user.id, tier.id, tier.price, startedAt, (err) => {
    if (err) {
      req.flash('error', 'Failed to update subscription. Please try again.');
      return res.redirect('/subscription');
    }
    req.session.user.subscription_tier = tier.id;
    req.session.user.subscription_price = tier.price;
    req.session.user.subscription_started_at = startedAt;
    req.session.subscription_checkout_tier = null;
    req.session.subscription_checkout_price = null;
    req.session.subscription_payment_flow = null;
    req.flash('success', `Subscription upgraded to ${tier.name}.`);
    return res.redirect('/subscription');
  });
}

function ensureUpgradeAllowed(req, res, tierId) {
  const currentTierId = (req.session.user && req.session.user.subscription_tier) ? req.session.user.subscription_tier : 'basic';
  if ((TIER_ORDER[tierId] ?? 0) <= (TIER_ORDER[currentTierId] ?? 0)) {
    req.flash('error', 'You can only upgrade to a higher tier.');
    return false;
  }
  return true;
}

module.exports = {
  index(req, res) {
    const user = req.session.user;
    const currentTierId = (user && user.subscription_tier) ? user.subscription_tier : 'basic';
    const currentOrder = TIER_ORDER[currentTierId] ?? 0;
    const tiers = TIERS.map((tier) => ({
      ...tier,
      priceFormatted: formatMoney(tier.price),
      isCurrent: tier.id === currentTierId,
      canUpgrade: TIER_ORDER[tier.id] > currentOrder
    }));
    const billingDate = (currentTierId !== 'basic')
      ? nextBillingDate(user.subscription_started_at || new Date())
      : null;
    const cancellationEffective = user.subscription_cancel_effective_at
      ? new Date(user.subscription_cancel_effective_at)
      : null;
    res.render('subscription', {
      user,
      tiers,
      currentTier: TIERS.find((t) => t.id === currentTierId) || TIERS[0],
      billingDate,
      cancellationEffective,
      messages: req.flash('success') || [],
      errors: req.flash('error') || []
    });
  },

  // Render cancellation reason form
  cancelForm(req, res) {
    const user = req.session.user;
    if (!user || !user.subscription_tier || user.subscription_tier === 'basic') {
      req.flash('error', 'You are already on the Basic tier.');
      return res.redirect('/subscription');
    }
    const billingDate = nextBillingDate(user.subscription_started_at || new Date());
    res.render('subscriptionCancel', {
      user,
      currentTier: getTierById(user.subscription_tier) || TIERS[0],
      billingDate,
      messages: req.flash('success') || [],
      errors: req.flash('error') || []
    });
  },

  // Renders the subscription payment page for the selected tier.
  checkoutForm(req, res) {
    const targetTier = (req.query.tier || '').toLowerCase();
    const selected = getTierById(targetTier);
    if (!selected) {
      req.flash('error', 'Invalid subscription tier selected.');
      return res.redirect('/subscription');
    }
    if (!ensureUpgradeAllowed(req, res, selected.id)) {
      return res.redirect('/subscription');
    }
    req.session.subscription_checkout_tier = selected.id;
    req.session.subscription_checkout_price = selected.price;
    res.render('subscriptionPayment', {
      user: req.session.user,
      tier: selected,
      priceFormatted: formatMoney(selected.price),
      messages: req.flash('success') || [],
      errors: req.flash('error') || []
    });
  },

  // Validates method and routes to external payment flows as needed.
  checkoutProcess(req, res) {
    const targetTier = (req.session.subscription_checkout_tier || '').toLowerCase();
    const selected = getTierById(targetTier);
    if (!selected) {
      req.flash('error', 'Subscription details expired. Please try again.');
      return res.redirect('/subscription');
    }
    if (!ensureUpgradeAllowed(req, res, selected.id)) {
      return res.redirect('/subscription');
    }
    const { method, card_number, expiry, cvv } = req.body;
    const allowedMethods = new Set(['stripe', 'paynow', 'nets', 'paypal']);
    if (!method || !allowedMethods.has(method)) {
      req.flash('error', 'Select a payment method.');
      return res.redirect('/subscription/checkout?tier=' + selected.id);
    }
    if (method === 'stripe') {
      req.flash('error', 'Stripe payment must be confirmed on this page.');
      return res.redirect('/subscription/checkout?tier=' + selected.id);
    }
    if (method === 'paynow') {
      req.flash('error', 'PayNow QR must be generated on this page.');
      return res.redirect('/subscription/checkout?tier=' + selected.id);
    }
    // NETS QR: external flow; success callback will trigger complete().
    if (method === 'nets') {
      req.session.subscription_payment_flow = 'nets';
      return netsQr.generateQrCodeForAmount(req, res, selected.price.toFixed(2));
    }
    if (method === 'paypal') {
      return res.redirect('/subscription/checkout?tier=' + selected.id);
    }
    return applySubscriptionUpgrade(req, res, selected);
  },

  // PayPal create-order for subscription payment.
  paypalCreateOrder(req, res) {
    const targetTier = (req.session.subscription_checkout_tier || '').toLowerCase();
    const selected = getTierById(targetTier);
    if (!selected) return res.status(400).json({ error: 'Subscription details expired.' });
    return paypal.createOrder(selected.price.toFixed(2))
      .then((order) => res.json({ id: order.id }))
      .catch((err) => res.status(500).json({ error: 'Failed to create PayPal order', message: err.message }));
  },

  // PayPal capture then redirect to complete().
  paypalCaptureOrder(req, res) {
    const { orderID } = req.body;
    const targetTier = (req.session.subscription_checkout_tier || '').toLowerCase();
    const selected = getTierById(targetTier);
    if (!selected) return res.status(400).json({ error: 'Subscription details expired.' });
    return paypal.captureOrder(orderID)
      .then((capture) => {
        if (capture.status === 'COMPLETED') {
          req.session.subscription_paypal_captured = true;
          return res.json({ success: true, redirect: '/subscription/complete' });
        }
        return res.status(400).json({ error: 'Payment not completed', details: capture });
      })
      .catch((err) => res.status(500).json({ error: 'Failed to capture PayPal order', message: err.message }));
  },

  // Finalizes the subscription after external payment success.
  complete(req, res) {
    const capturedPaypal = !!req.session.subscription_paypal_captured;
    const capturedNets = !!req.session.subscription_nets_captured;
    if (!capturedPaypal && !capturedNets) {
      req.flash('error', 'Payment not confirmed.');
      return res.redirect('/subscription');
    }
    req.session.subscription_paypal_captured = false;
    req.session.subscription_nets_captured = false;
    const targetTier = (req.session.subscription_checkout_tier || '').toLowerCase();
    const selected = getTierById(targetTier);
    if (!selected) {
      req.flash('error', 'Subscription details expired.');
      return res.redirect('/subscription');
    }
    return applySubscriptionUpgrade(req, res, selected);
  }

  ,
  cancel(req, res) {
    const user = req.session.user;
    if (!user || !user.subscription_tier || user.subscription_tier === 'basic') {
      req.flash('error', 'You are already on the Basic tier.');
      return res.redirect('/subscription');
    }
    const reason = (req.body.reason || '').trim();
    if (reason && reason.length < 10) {
      req.flash('error', 'Cancellation reason must be at least 10 characters if provided.');
      return res.redirect('/subscription/cancel');
    }
    const cancelledAt = new Date();
    User.cancelSubscription(user.id, reason, cancelledAt, cancelledAt, (err) => {
      if (err) {
        req.flash('error', 'Failed to cancel subscription.');
        return res.redirect('/subscription');
      }
      User.updateSubscription(user.id, 'basic', 0, null, (uErr) => {
        if (uErr) {
          req.flash('error', 'Subscription canceled but failed to reset tier.');
          return res.redirect('/subscription');
        }
        req.session.user.subscription_tier = 'basic';
        req.session.user.subscription_price = 0;
        req.session.user.subscription_started_at = null;
        req.session.user.subscription_cancel_reason = reason || null;
        req.session.user.subscription_cancelled_at = cancelledAt;
        req.session.user.subscription_cancel_effective_at = cancelledAt;
        req.flash('success', 'Subscription canceled. You are now on the Basic tier.');
        return res.redirect('/subscription');
      });
    });
  }
};
