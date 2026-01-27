const crypto = require('crypto');
const db = require('../db');
const { getTier } = require('./subscriptionPricing');

const PREMIUM_VOUCHER_AMOUNT = Number(process.env.PREMIUM_VOUCHER_AMOUNT || 5);
const PREMIUM_VOUCHER_DAYS = 30;

function query(sql, params) {
  return new Promise((resolve, reject) => {
    db.query(sql, params || [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function execute(sql, params) {
  return new Promise((resolve, reject) => {
    db.query(sql, params || [], (err, result) => {
      if (err) return reject(err);
      resolve(result || {});
    });
  });
}

function generateCode(prefix) {
  const raw = crypto.randomBytes(3).toString('hex').toUpperCase();
  const safePrefix = prefix ? String(prefix).toUpperCase() : 'VCH';
  return `${safePrefix}-${raw}`;
}

async function createVoucher({ code, amount, discountType, expiresAt, userId, maxUses, createdByAdminId }) {
  const voucherCode = (code || generateCode('VCH')).toUpperCase();
  const safeType = discountType === 'percent' ? 'percent' : 'fixed';
  const sql = 'INSERT INTO vouchers (code, amount, discount_type, user_id, max_uses, active, expires_at, created_by_admin_id) VALUES (?, ?, ?, ?, ?, 1, ?, ?)';
  const params = [
    voucherCode,
    Number(amount || 0).toFixed(2),
    safeType,
    userId || null,
    Number.isFinite(maxUses) ? maxUses : 1,
    expiresAt,
    createdByAdminId || null
  ];
  await query(sql, params);
  const rows = await query('SELECT * FROM vouchers WHERE code = ? LIMIT 1', [voucherCode]);
  return rows[0] || null;
}

async function listVouchers(limit) {
  const max = Number.isFinite(limit) ? limit : 50;
  const sql = `
    SELECT v.*,
      (SELECT COUNT(*) FROM voucher_redemptions r WHERE r.voucher_id = v.id) AS redeemed_count
    FROM vouchers v
    ORDER BY v.created_at DESC
    LIMIT ?
  `;
  return query(sql, [max]);
}

async function deleteVoucher(voucherId) {
  const id = Number(voucherId);
  if (!Number.isFinite(id) || id <= 0) return { affectedRows: 0 };
  const used = await query('SELECT COUNT(*) AS total FROM voucher_redemptions WHERE voucher_id = ?', [id]);
  const usedCount = used && used[0] ? Number(used[0].total) : 0;
  if (usedCount > 0) {
    return { affectedRows: 0, blocked: true };
  }
  return execute('DELETE FROM vouchers WHERE id = ?', [id]);
}

async function listAvailableForUser(userId) {
  const sql = `
    SELECT v.*
    FROM vouchers v
    LEFT JOIN voucher_redemptions r ON r.voucher_id = v.id AND r.user_id = ?
    WHERE v.active = 1
      AND v.expires_at > NOW()
      AND (v.user_id IS NULL OR v.user_id = ?)
      AND r.id IS NULL
    ORDER BY v.user_id IS NULL ASC, v.expires_at ASC, v.id DESC
  `;
  return query(sql, [userId, userId]);
}

async function listRedeemedForUser(userId, limit) {
  const max = Number.isFinite(limit) ? limit : 50;
  const sql = `
    SELECT v.code, v.amount, v.discount_type, r.redeemed_at, r.order_id
    FROM voucher_redemptions r
    JOIN vouchers v ON v.id = r.voucher_id
    WHERE r.user_id = ?
    ORDER BY r.redeemed_at DESC
    LIMIT ?
  `;
  return query(sql, [userId, max]);
}

async function findValidVoucherByCode(code, userId) {
  if (!code) return null;
  const rows = await query('SELECT * FROM vouchers WHERE code = ? AND active = 1 LIMIT 1', [String(code).trim().toUpperCase()]);
  if (!rows.length) return null;
  const v = rows[0];
  const amount = Number(v.amount || 0);
  const type = (v.discount_type || 'fixed').toLowerCase();
  if (type === 'percent') {
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100) return null;
  } else {
    if (!Number.isFinite(amount) || amount <= 0) return null;
  }
  if (v.user_id && Number(v.user_id) !== Number(userId)) return null;
  if (v.expires_at && new Date(v.expires_at) < new Date()) return null;
  const usedRows = await query('SELECT COUNT(*) AS total FROM voucher_redemptions WHERE voucher_id = ?', [v.id]);
  const usedCount = usedRows && usedRows[0] ? usedRows[0].total : 0;
  if (v.max_uses && usedCount >= v.max_uses) return null;
  const userRows = await query('SELECT id FROM voucher_redemptions WHERE voucher_id = ? AND user_id = ? LIMIT 1', [v.id, userId]);
  if (userRows.length) return null;
  return v;
}

async function redeemVoucher(voucherId, userId, orderId) {
  if (!voucherId || !userId || !orderId) return;
  await query('INSERT INTO voucher_redemptions (voucher_id, user_id, order_id) VALUES (?, ?, ?)', [voucherId, userId, orderId]);
  const rows = await query('SELECT max_uses FROM vouchers WHERE id = ? LIMIT 1', [voucherId]);
  const maxUses = rows && rows[0] ? Number(rows[0].max_uses) : 1;
  if (maxUses) {
    const used = await query('SELECT COUNT(*) AS total FROM voucher_redemptions WHERE voucher_id = ?', [voucherId]);
    const usedCount = used && used[0] ? used[0].total : 0;
    if (usedCount >= maxUses) {
      await query('UPDATE vouchers SET active = 0 WHERE id = ?', [voucherId]);
    }
  }
}

async function getActiveUserVoucher(userId) {
  const sql = `
    SELECT v.*
    FROM vouchers v
    LEFT JOIN voucher_redemptions r ON r.voucher_id = v.id AND r.user_id = ?
    WHERE v.user_id = ? AND v.active = 1 AND v.expires_at > NOW() AND r.id IS NULL
    ORDER BY v.expires_at DESC, v.id DESC
    LIMIT 1
  `;
  const rows = await query(sql, [userId, userId]);
  return rows[0] || null;
}

async function hasPremiumVoucherThisMonth(userId) {
  if (!userId) return false;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const sql = `
    SELECT id
    FROM vouchers
    WHERE user_id = ?
      AND code LIKE 'PREM-%'
      AND created_at >= ?
      AND created_at < ?
    LIMIT 1
  `;
  const rows = await query(sql, [userId, monthStart, nextMonthStart]);
  return rows.length > 0;
}

async function ensurePremiumMonthlyVoucher(user) {
  if (!user || getTier(user) !== 'premium') return null;
  const alreadyIssued = await hasPremiumVoucherThisMonth(user.id);
  if (alreadyIssued) {
    return getActiveUserVoucher(user.id);
  }
  const existing = await getActiveUserVoucher(user.id);
  if (existing) return existing;
  const expiresAt = new Date(Date.now() + PREMIUM_VOUCHER_DAYS * 24 * 60 * 60 * 1000);
  return createVoucher({
    code: generateCode('PREM'),
    amount: PREMIUM_VOUCHER_AMOUNT,
    discountType: 'fixed',
    expiresAt,
    userId: user.id,
    maxUses: 1
  });
}

async function resolveAppliedVoucher(req) {
  const user = req.session.user;
  if (!user) return null;
  if (!req.session.voucher_opt_out && !req.session.applied_voucher) {
    await ensurePremiumMonthlyVoucher(user);
    const prem = await getActiveUserVoucher(user.id);
    if (prem) {
      req.session.applied_voucher = { id: prem.id, code: prem.code, amount: Number(prem.amount), discount_type: prem.discount_type || 'fixed' };
    }
  }
  if (req.session.applied_voucher) {
    const valid = await findValidVoucherByCode(req.session.applied_voucher.code, user.id);
    if (!valid) {
      req.session.applied_voucher = null;
      return null;
    }
    req.session.applied_voucher = { id: valid.id, code: valid.code, amount: Number(valid.amount), discount_type: valid.discount_type || 'fixed' };
    return req.session.applied_voucher;
  }
  return null;
}

module.exports = {
  generateCode,
  createVoucher,
  listVouchers,
  listAvailableForUser,
  listRedeemedForUser,
  findValidVoucherByCode,
  redeemVoucher,
  ensurePremiumMonthlyVoucher,
  resolveAppliedVoucher,
  deleteVoucher
};
