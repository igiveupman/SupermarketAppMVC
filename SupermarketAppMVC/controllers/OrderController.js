/**
 * OrderController
 * - Shows order history and item details for the logged-in user
 * - Renders printable invoices for individual orders
 */
const Order = require('../models/Order');
const db = require('../db');

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
        });
        // Fetch items for these orders (join with products to get names)
        const ids = orders.map(o => o.id);
        const sql = 'SELECT oi.order_id, oi.product_id, oi.quantity, oi.price, p.productName FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id IN (?) ORDER BY oi.order_id';
        db.query(sql, [ids], (iErr, rows) => {
          const itemsByOrder = {};
          if (!iErr && rows) {
            rows.forEach(r => {
              if (!itemsByOrder[r.order_id]) itemsByOrder[r.order_id] = [];
              itemsByOrder[r.order_id].push(r);
            });
          }
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
      const sql = 'SELECT oi.product_id, oi.quantity, oi.price, p.productName FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?';
      db.query(sql, [orderId], (iErr, items) => {
        if (iErr) return res.status(500).send('Server error');
        Order.listByUser(user.id, (lErr, orders) => {
          if (lErr) return res.status(500).send('Server error');
          const index = orders.findIndex(o => o.id === order.id);
          const displayOrderNumber = index >= 0 ? (orders.length - index) : order.id;
          // Calculate totals (subtotal + 8% GST)
          const subtotal = items.reduce((s, it) => s + (it.price * it.quantity), 0);
          const taxRate = 0.08; // 8% sample GST
          const tax = +(subtotal * taxRate).toFixed(2);
          const total = +(subtotal + tax).toFixed(2);
          res.render('invoice', { user, order, items, subtotal: +subtotal.toFixed(2), tax, total, displayOrderNumber });
        });
      });
    });
  }
};
