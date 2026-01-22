const BASE_DELIVERY_FEE = 6.0;
const ESSENTIAL_FREE_THRESHOLD = 40.0;

const DISCOUNT_RATES = {
  basic: 0,
  essential: 0.05,
  premium: 0.1
};

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function getTier(user) {
  if (!user || !user.subscription_tier) return 'basic';
  return String(user.subscription_tier).toLowerCase();
}

function getDiscountRate(tier) {
  return DISCOUNT_RATES[tier] || 0;
}

// Applies subscription benefits (discount + delivery rules) to cart totals.
function computeCartPricing(cart, user) {
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

  const total = roundMoney(discountedSubtotal + deliveryFee);

  return {
    tier,
    discountRate,
    discountAmount,
    subtotal,
    discountedSubtotal,
    deliveryFee,
    total,
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
