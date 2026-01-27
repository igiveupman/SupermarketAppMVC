const vouchers = require('../services/vouchers');
const { computeCartPricing } = require('../services/subscriptionPricing');

module.exports = {
  async index(req, res) {
    const user = req.session.user;
    if (!user) return res.redirect('/login');
    try {
      await vouchers.ensurePremiumMonthlyVoucher(user);
      const cart = req.session.cart || [];
      const cartPricing = computeCartPricing(cart, user, null);
      const cartSubtotal = Number(cartPricing.discountedSubtotal || 0);
      const available = await vouchers.listAvailableForUser(user.id);
      const redeemed = await vouchers.listRedeemedForUser(user.id, 20);
      const applied = req.session.applied_voucher || null;
      res.render('vouchers', {
        user,
        available,
        redeemed,
        applied,
        cartSubtotal,
        messages: req.flash('success'),
        errors: req.flash('error')
      });
    } catch (err) {
      console.error('Failed to load vouchers:', err);
      req.flash('error', 'Failed to load vouchers.');
      res.render('vouchers', { user, available: [], redeemed: [], cartSubtotal: 0, messages: req.flash('success'), errors: req.flash('error') });
    }
  }
};
