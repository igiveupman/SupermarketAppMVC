const BASE_DELIVERY_FEE = 6.0;
const ESSENTIAL_FREE_THRESHOLD = 40.0;

const DISCOUNT_RATES = {
  basic: 0,
  essential: 0,
  premium: 0
};

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function getTier(user) {
  if (!user || !user.subscription_tier) return 'basic';
  if (user.subscription_cancel_effective_at) {
    const effective = new Date(user.subscription_cancel_effective_at);
    if (!Number.isNaN(effective.getTime()) && new Date() >= effective) {
      return 'basic';
    }
  }
  return String(user.subscription_tier).toLowerCase();
}

function getDiscountRate(tier) {
  return DISCOUNT_RATES[tier] || 0;
}

// Applies subscription benefits (discount + delivery rules) to cart totals.
function computeCartPricing(cart, user, voucher) {
  const tier = getTier(user);
  const discountRate = getDiscountRate(tier);
  let subtotal = 0;
  let discountedSubtotal = 0;

  const items = (cart || []).map((item) => {
    const basePrice = Number(item.price) || 0;
    const qty = Number(item.quantity) || 0;
    const effectivePrice = discountRate > 0 ? roundMoney(basePrice * (1 - discountRate)) : basePrice;
    const lineTotal = roundMoney(effectivePrice * qty);
    subtotal += roundMoney(basePrice * qty);
    discountedSubtotal += lineTotal;
    return {
      ...item,
      effectivePrice,
      lineTotal,
      subscriptionDiscountApplied: discountRate > 0,
      subscriptionDiscountRate: discountRate
    };
  });

  subtotal = roundMoney(subtotal);
  discountedSubtotal = roundMoney(discountedSubtotal);
  const discountAmount = roundMoney(subtotal - discountedSubtotal);

  let deliveryFee = BASE_DELIVERY_FEE;
  let freeDeliveryApplied = false;
  if (tier === 'premium') {
    deliveryFee = 0;
    freeDeliveryApplied = true;
  } else if (tier === 'essential' && discountedSubtotal >= ESSENTIAL_FREE_THRESHOLD) {
    deliveryFee = 0;
    freeDeliveryApplied = true;
  }

  const totalBeforeVoucher = roundMoney(discountedSubtotal + deliveryFee);
  const voucherValue = voucher && Number(voucher.amount) > 0 ? Number(voucher.amount) : 0;
  const voucherEligible = voucherValue > 0 && voucherValue <= discountedSubtotal;
  const voucherAmount = voucherEligible ? voucherValue : 0;
  const total = roundMoney(totalBeforeVoucher - voucherAmount);

  return {
    tier,
    discountRate,
    discountAmount,
    subtotal,
    discountedSubtotal,
    deliveryFee,
    total,
    totalBeforeVoucher,
    voucherAmount,
    voucherCode: voucherEligible && voucher && voucher.code ? String(voucher.code) : null,
    voucherRejected: !!(voucherValue > 0 && !voucherEligible),
    freeDeliveryApplied,
    freeDeliveryThreshold: ESSENTIAL_FREE_THRESHOLD,
    baseDeliveryFee: BASE_DELIVERY_FEE,
    items
  };
}

module.exports = {
  computeCartPricing,
  roundMoney,
  getTier,
  getDiscountRate
};
