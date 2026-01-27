/**
 * OrderController
 * - Shows order history and item details for the logged-in user
 * - Renders printable invoices for individual orders
 */
const Order = require('../models/Order');
const db = require('../db');
const { BASE_DELIVERY_FEE } = require('../services/subscriptionPricing');

function safeParseSnapshot(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    return null;
  }
}

module.exports = {
  // Render orders page with list of orders and their items
  index(req, res) {
    const user = req.session.user;
    if (!user) return res.redirect('/login');
    const pageSize = 5;
    const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
    const offset = (page - 1) * pageSize;
    Order.countByUser(user.id, (cErr, totalCount) => {
      if (cErr) {
        req.flash('error','Failed to load orders');
        return res.render('orders', { user, orders: [], itemsByOrder: {}, messages: req.flash('success'), errors: req.flash('error'), page: 1, totalPages: 1 });
      }
      const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
      const safePage = Math.min(page, totalPages);
      const safeOffset = (safePage - 1) * pageSize;
      Order.listByUserPaged(user.id, pageSize, safeOffset, (err, orders) => {
        if (err) {
          req.flash('error','Failed to load orders');
          return res.render('orders', { user, orders: [], itemsByOrder: {}, messages: req.flash('success'), errors: req.flash('error'), page: safePage, totalPages });
        }
        if (!orders.length) {
          return res.render('orders', { user, orders: [], itemsByOrder: {}, messages: req.flash('success'), errors: req.flash('error'), page: safePage, totalPages });
        }
        orders.forEach((o, idx) => {
          o.displayNumber = totalCount - (safeOffset + idx);
          o.snapshotItems = safeParseSnapshot(o.items_snapshot);
          const deliveryFee = Number(o.delivery_fee || 0);
          const voucherAmt = Number(o.voucher_amount || 0);
          const deliverySavings = Math.max(0, Number(BASE_DELIVERY_FEE) - deliveryFee);
          o.savings_amount = deliverySavings + voucherAmt;
        });
        // Fetch items for these orders (join with products to get names)
        const ids = orders.map(o => o.id);
        const placeholders = ids.map(() => '?').join(',');
        const sql = `
          SELECT oi.order_id,
                 oi.product_id,
                 SUM(oi.quantity) AS quantity,
                 SUM(oi.price * oi.quantity) AS total_price,
                 p.productName
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id AND o.user_id = ?
          JOIN products p ON p.id = oi.product_id
          WHERE oi.order_id IN (${placeholders})
          GROUP BY oi.order_id, oi.product_id, p.productName
          ORDER BY oi.order_id
        `;
        db.query(sql, [user.id, ...ids], (iErr, rows) => {
          const itemsByOrder = {};
          if (!iErr && rows) {
            rows.forEach(r => {
              if (!itemsByOrder[r.order_id]) itemsByOrder[r.order_id] = [];
              itemsByOrder[r.order_id].push(r);
            });
          }
          orders.forEach((o) => {
            if (o.snapshotItems && o.snapshotItems.length) {
              itemsByOrder[o.id] = o.snapshotItems.map((it) => ({
                order_id: o.id,
                product_id: it.productId,
                productName: it.productName,
                quantity: it.quantity,
                total_price: Number(it.lineTotal || (Number(it.unitPrice || 0) * Number(it.quantity || 0))) || 0
              }));
            }
          });
          res.render('orders', { user, orders, itemsByOrder, messages: req.flash('success'), errors: req.flash('error'), page: safePage, totalPages });
        });
      });
    });
  },
  // Render printable invoice for a specific order
  invoice(req, res) {
    const user = req.session.user;
    if (!user) return res.redirect('/login');
    const orderId = parseInt(req.params.id, 10);
    if (!orderId) return res.status(400).send('Invalid order id');
    // Ensure order belongs to user
    Order.getById(orderId, (err, order) => {
      if (err) return res.status(500).send('Server error');
      if (!order || order.user_id !== user.id) return res.status(404).send('Order not found');
      const snapshotItems = safeParseSnapshot(order.items_snapshot);
      if (snapshotItems && snapshotItems.length) {
        Order.listByUser(user.id, (lErr, orders) => {
          if (lErr) return res.status(500).send('Server error');
          const index = orders.findIndex(o => o.id === order.id);
          const displayOrderNumber = index >= 0 ? (orders.length - index) : order.id;
          const items = snapshotItems.map((it) => ({
            product_id: it.productId,
            quantity: it.quantity,
            total_price: Number(it.lineTotal || (Number(it.unitPrice || 0) * Number(it.quantity || 0))) || 0,
            price: Number(it.unitPrice || (Number(it.quantity || 0) ? (Number(it.lineTotal || 0) / Number(it.quantity || 1)) : 0)) || 0,
            productName: it.productName
          }));
          const subtotal = items.reduce((s, it) => s + (Number(it.total_price) || 0), 0);
          const deliveryFee = Number(order.delivery_fee || 0);
          const voucherAmount = Number(order.voucher_amount || 0);
          const savingsAmount = Math.max(0, Number(BASE_DELIVERY_FEE) - deliveryFee) + voucherAmount;
          const computedTotal = +(subtotal + deliveryFee - voucherAmount).toFixed(2);
          const total = Number(order.total || 0) || computedTotal;
          return res.render('invoice', { user, order, items, subtotal: +subtotal.toFixed(2), deliveryFee, voucherAmount, total, savingsAmount, displayOrderNumber });
        });
        return;
      }
      const sql = `
        SELECT oi.product_id,
               SUM(oi.quantity) AS quantity,
               SUM(oi.price * oi.quantity) AS total_price,
               p.productName
        FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = ?
        GROUP BY oi.product_id, p.productName
      `;
      db.query(sql, [orderId], (iErr, items) => {
        if (iErr) return res.status(500).send('Server error');
        const normalizedItems = (items || []).map((it) => ({
          ...it,
          price: Number(it.quantity || 0) ? Number(it.total_price || 0) / Number(it.quantity || 1) : 0
        }));
        Order.listByUser(user.id, (lErr, orders) => {
          if (lErr) return res.status(500).send('Server error');
          const index = orders.findIndex(o => o.id === order.id);
          const displayOrderNumber = index >= 0 ? (orders.length - index) : order.id;
          // Calculate totals (subtotal + 8% GST)
          const subtotal = normalizedItems.reduce((s, it) => s + (Number(it.total_price) || 0), 0);
          const deliveryFee = Number(order.delivery_fee || 0);
          const voucherAmount = Number(order.voucher_amount || 0);
          const savingsAmount = Math.max(0, Number(BASE_DELIVERY_FEE) - deliveryFee) + voucherAmount;
          const computedTotal = +(subtotal + deliveryFee - voucherAmount).toFixed(2);
          const total = Number(order.total || 0) || computedTotal;
          res.render('invoice', { user, order, items: normalizedItems, subtotal: +subtotal.toFixed(2), deliveryFee, voucherAmount, total, savingsAmount, displayOrderNumber });
        });
      });
    });
  }
  ,
  // Customer refund request (pending admin approval)
  requestRefund(req, res) {
    const user = req.session.user;
    if (!user) return res.redirect('/login');
    const orderId = parseInt(req.params.id, 10);
    if (!orderId) {
      req.flash('error', 'Invalid order id.');
      return res.redirect('/orders');
    }
    const reason = (req.body.reason || '').trim();
    if (!reason || reason.length < 10) {
      req.flash('error', 'Please provide a clear refund reason (min 10 characters).');
      return res.redirect('/orders#order-' + orderId);
    }
    Order.getById(orderId, (err, order) => {
      if (err || !order || order.user_id !== user.id) {
        req.flash('error', 'Order not found.');
        return res.redirect('/orders');
      }
      if (order.refund_status) {
        req.flash('error', 'This order has already been refunded.');
        return res.redirect('/orders#order-' + orderId);
      }
      if (order.refund_request_status && String(order.refund_request_status).toLowerCase() === 'pending') {
        req.flash('error', 'A refund request is already pending for this order.');
        return res.redirect('/orders#order-' + orderId);
      }
      if (order.refund_request_status && String(order.refund_request_status).toLowerCase() === 'approved') {
        req.flash('error', 'This order has already been approved for refund.');
        return res.redirect('/orders#order-' + orderId);
      }
      Order.setRefundRequest(orderId, user.id, {
        refund_request_status: 'pending',
        refund_request_reason: reason,
        refund_request_amount: Number(order.total || 0).toFixed(2),
        refund_requested_at: new Date()
      }, (uErr) => {
        if (uErr) {
          req.flash('error', 'Failed to submit refund request.');
          return res.redirect('/orders#order-' + orderId);
        }
        req.flash('success', 'Refund request submitted. An admin will review it shortly.');
        return res.redirect('/orders#order-' + orderId);
      });
    });
  }
};
