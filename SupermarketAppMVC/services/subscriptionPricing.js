const BASE_DELIVERY_FEE = 3.0;
const ESSENTIAL_FREE_THRESHOLD = 40.0;
const GST_RATE = 0.10;

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
  } else if (tier === 'essential' && subtotal >= ESSENTIAL_FREE_THRESHOLD) {
    deliveryFee = 0;
    freeDeliveryApplied = true;
  }

  const totalBeforeVoucher = roundMoney(discountedSubtotal + deliveryFee);
  const voucherValue = voucher && Number(voucher.amount) > 0 ? Number(voucher.amount) : 0;
  const voucherType = voucher && voucher.discount_type ? String(voucher.discount_type).toLowerCase() : 'fixed';
  let voucherAmount = 0;
  let voucherEligible = false;
  if (voucherValue > 0) {
    if (voucherType === 'percent') {
      if (voucherValue <= 100) {
        voucherAmount = roundMoney(discountedSubtotal * (voucherValue / 100));
        voucherEligible = voucherAmount > 0 && voucherAmount <= discountedSubtotal;
      }
    } else {
      voucherAmount = voucherValue;
      voucherEligible = voucherAmount <= discountedSubtotal;
    }
  }
  const taxableAmount = roundMoney(totalBeforeVoucher - (voucherEligible ? voucherAmount : 0));
  const gstAmount = roundMoney(taxableAmount * GST_RATE);
  const total = roundMoney(taxableAmount + gstAmount);

  return {
    tier,
    discountRate,
    discountAmount,
    subtotal,
    discountedSubtotal,
    deliveryFee,
    total,
    totalBeforeVoucher,
    taxableAmount,
    gstAmount,
    voucherAmount: voucherEligible ? voucherAmount : 0,
    voucherCode: voucherEligible && voucher && voucher.code ? String(voucher.code) : null,
    voucherType: voucher ? voucherType : null,
    voucherValue: voucher ? voucherValue : 0,
    voucherRejected: !!(voucherValue > 0 && !voucherEligible),
    freeDeliveryApplied,
    freeDeliveryThreshold: ESSENTIAL_FREE_THRESHOLD,
    baseDeliveryFee: BASE_DELIVERY_FEE,
    gstRate: GST_RATE,
    items
  };
}

module.exports = {
  BASE_DELIVERY_FEE,
  computeCartPricing,
  roundMoney,
  getTier,
  getDiscountRate
};
