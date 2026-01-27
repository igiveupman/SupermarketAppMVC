/**
 * AdminController
 * - Admin dashboard and maintenance actions (undo checkout, user order views)
 */
async function executeRefund(order, amount) {
  const normalizeStatus = (status) => {
    const value = String(status || '').toLowerCase();
    if (value === 'succeeded' || value === 'completed') return 'refunded';
    return value || 'refunded';
  };
  const stripe = require('../services/stripe');
  const paypal = require('../services/paypal');
  const provider = (order.payment_provider || order.delivery_method || '').toLowerCase();
  if (provider === 'stripe') {
    if (!order.payment_reference) {
      throw new Error('Missing Stripe payment reference for this order.');
    }
    const refund = await stripe.createRefund(order.payment_reference, amount);
    return {
      status: normalizeStatus(refund && refund.status),
      reference: refund && refund.id ? refund.id : null
    };
  }
  if (provider === 'paypal') {
    if (!order.payment_reference) {
      throw new Error('Missing PayPal capture id for this order.');
    }
    const refund = await paypal.refundCapture(order.payment_reference, amount.toFixed(2), 'SGD');
    if (refund && refund.name) {
      throw new Error(refund.message || 'PayPal refund failed.');
    }
    return {
      status: normalizeStatus(refund && refund.status),
      reference: refund && refund.id ? refund.id : null
    };
  }
  throw new Error('Refunds for NETS/PayNow must be processed manually.');
}

module.exports = {
  dashboard(req, res) {
    // Render a simple admin dashboard; reuse Product model to show counts
    const Product = require('../models/Product');
    const User = require('../models/User');
    const db = require('../db');

    Product.getAll((err, products) => {
      if (err) return res.status(500).send(err);
      User.getAll((err2, users) => {
        if (err2) return res.status(500).send(err2);
        db.query(
          "SELECT COUNT(*) AS total FROM orders WHERE refund_request_status = 'pending'",
          (rErr, rows) => {
            if (rErr) {
              console.error('Failed to load refund request count:', rErr);
            }
            const pendingRefundCount = rows && rows[0] ? rows[0].total : 0;
            res.render('adminDashboard', {
              products,
              users,
              pendingRefundCount,
              user: req.session.user,
              currentPage: 'adminDashboard',
              messages: req.flash('success'),
              errors: req.flash('error')
            });
          }
        );
      });
    });
  }
  ,

  // View a specific user's order history (admin)
  userOrders(req, res) {
    const admin = req.session.user;
    if (!admin || admin.role !== 'admin') {
      req.flash('error', 'Unauthorized');
      return res.redirect('/');
    }
    const userId = parseInt(req.params.id, 10);
    const User = require('../models/User');
    const Order = require('../models/Order');
    const db = require('../db');

    User.getById(userId, (uErr, subjectUser) => {
      if (uErr || !subjectUser) {
        req.flash('error', 'User not found');
        return res.redirect('/admin/users');
      }
      const pageSize = 5;
      const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
      const offset = (page - 1) * pageSize;
      Order.countByUser(userId, (cErr, totalCount) => {
        if (cErr) {
          req.flash('error', 'Failed to load orders');
          return res.render('adminUserOrders', { user: admin, subjectUser, orders: [], itemsByOrder: {}, messages: req.flash('success'), errors: req.flash('error'), page: 1, totalPages: 1 });
        }
        const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
        const safePage = Math.min(page, totalPages);
        const safeOffset = (safePage - 1) * pageSize;
        Order.listByUserPaged(userId, pageSize, safeOffset, (oErr, orders) => {
          if (oErr) {
            req.flash('error', 'Failed to load orders');
            return res.render('adminUserOrders', { user: admin, subjectUser, orders: [], itemsByOrder: {}, messages: req.flash('success'), errors: req.flash('error'), page: safePage, totalPages });
          }
          if (!orders.length) {
            return res.render('adminUserOrders', { user: admin, subjectUser, orders: [], itemsByOrder: {}, messages: req.flash('success'), errors: req.flash('error'), page: safePage, totalPages });
          }
          orders.forEach((o, idx) => {
            o.displayNumber = totalCount - (safeOffset + idx);
          });
          const ids = orders.map(o => o.id);
          const sql = `
            SELECT oi.order_id,
                   oi.product_id,
                   SUM(oi.quantity) AS quantity,
                   SUM(oi.price * oi.quantity) AS total_price,
                   p.productName
            FROM order_items oi
            JOIN products p ON p.id = oi.product_id
            WHERE oi.order_id IN (?)
            GROUP BY oi.order_id, oi.product_id, p.productName
            ORDER BY oi.order_id
          `;
          db.query(sql, [ids], (iErr, rows) => {
            const itemsByOrder = {};
            if (!iErr && rows) {
              rows.forEach(r => {
                if (!itemsByOrder[r.order_id]) itemsByOrder[r.order_id] = [];
                itemsByOrder[r.order_id].push(r);
              });
            }
            res.render('adminUserOrders', { user: admin, subjectUser, orders, itemsByOrder, messages: req.flash('success'), errors: req.flash('error'), page: safePage, totalPages });
          });
        });
      });
    });
  },

  // View pending refund requests (admin)
  refundRequests(req, res) {
    const admin = req.session.user;
    if (!admin || admin.role !== 'admin') {
      req.flash('error', 'Unauthorized');
      return res.redirect('/');
    }
    const db = require('../db');
    const sql = `
      SELECT o.*, u.username, u.email
      FROM orders o
      JOIN users u ON u.id = o.user_id
      WHERE o.refund_request_status = 'pending'
      ORDER BY o.refund_requested_at DESC, o.id DESC
    `;
    db.query(sql, (err, rows) => {
      if (err) {
        console.error('Failed to load refund requests:', err);
        req.flash('error', 'Failed to load refund requests.');
        return res.render('adminRefundRequests', { user: admin, requests: [], messages: req.flash('success'), errors: req.flash('error') });
      }
      return res.render('adminRefundRequests', { user: admin, requests: rows || [], messages: req.flash('success'), errors: req.flash('error') });
    });
  },

  // Manage vouchers (admin)
  async vouchersPage(req, res) {
    const admin = req.session.user;
    if (!admin || admin.role !== 'admin') {
      req.flash('error', 'Unauthorized');
      return res.redirect('/');
    }
    const vouchers = require('../services/vouchers');
    try {
      const list = await vouchers.listVouchers(100);
      return res.render('adminVouchers', { user: admin, vouchers: list, messages: req.flash('success'), errors: req.flash('error') });
    } catch (err) {
      console.error('Failed to load vouchers:', err);
      req.flash('error', 'Failed to load vouchers.');
      return res.render('adminVouchers', { user: admin, vouchers: [], messages: req.flash('success'), errors: req.flash('error') });
    }
  },

  async createVoucher(req, res) {
    const admin = req.session.user;
    if (!admin || admin.role !== 'admin') {
      req.flash('error', 'Unauthorized');
      return res.redirect('/');
    }
    const vouchers = require('../services/vouchers');
    const code = (req.body.code || '').trim().toUpperCase();
    const amount = Number(req.body.amount);
    const expiresIn = Number(req.body.expires_in_days || 30);
    const userId = req.body.user_id ? parseInt(req.body.user_id, 10) : null;
    const maxUses = req.body.max_uses ? parseInt(req.body.max_uses, 10) : 1;
    if (!Number.isFinite(amount) || amount <= 0) {
      req.flash('error', 'Voucher amount must be greater than 0.');
      return res.redirect('/admin/vouchers');
    }
    const days = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 30;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    try {
      const voucher = await vouchers.createVoucher({
        code: code || undefined,
        amount,
        expiresAt,
        userId: Number.isFinite(userId) && userId > 0 ? userId : null,
        maxUses: Number.isFinite(maxUses) && maxUses > 0 ? maxUses : 1,
        createdByAdminId: admin.id
      });
      req.flash('success', `Voucher created: ${voucher.code} (-$${Number(voucher.amount).toFixed(2)})`);
      return res.redirect('/admin/vouchers');
    } catch (err) {
      console.error('Failed to create voucher:', err);
      req.flash('error', 'Failed to create voucher. Code might already exist.');
      return res.redirect('/admin/vouchers');
    }
  },

  async deleteVoucher(req, res) {
    const admin = req.session.user;
    if (!admin || admin.role !== 'admin') {
      req.flash('error', 'Unauthorized');
      return res.redirect('/');
    }
    const voucherId = parseInt(req.params.id, 10);
    if (!voucherId) {
      req.flash('error', 'Invalid voucher id.');
      return res.redirect('/admin/vouchers');
    }
    const vouchers = require('../services/vouchers');
    try {
      const result = await vouchers.deleteVoucher(voucherId);
      if (result && result.blocked) {
        req.flash('error', 'Cannot remove voucher that has redemptions.');
      } else if (result && result.affectedRows) {
        req.flash('success', `Voucher #${voucherId} removed.`);
      } else {
        req.flash('error', 'Voucher not found or already removed.');
      }
      return res.redirect('/admin/vouchers');
    } catch (err) {
      console.error('Failed to delete voucher:', err);
      req.flash('error', 'Failed to remove voucher.');
      return res.redirect('/admin/vouchers');
    }
  },

  async undoLastCheckout(req, res) {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const logDir = process.env.CHECKOUT_LOG_DIR
      || (process.env.NODE_ENV === 'production'
        ? path.join(__dirname, '..', 'data')
        : path.join(os.tmpdir(), 'supermarketapp'));
    const logFile = path.join(logDir, 'checkout_log.json');
    if (!fs.existsSync(logFile)) {
      req.flash('error', 'No checkout history available');
      return res.redirect('/admin');
    }

    try {
      const raw = fs.readFileSync(logFile, 'utf8') || '[]';
      const entries = JSON.parse(raw);
      if (!entries.length) {
        req.flash('error', 'No checkout history available');
        return res.redirect('/admin');
      }

      const last = entries.pop();
      // restore quantities
      const Product = require('../models/Product');
      for (const item of last.items) {
        // fetch current product and add back quantity
        await new Promise((resolve, reject) => {
          Product.getById(item.productId, (err, prod) => {
            if (err) return reject(err);
            if (!prod) return resolve(); // product removed, skip
            const restoredQty = (prod.quantity || 0) + item.quantity;
            const updated = { productName: prod.productName, price: prod.price, image: prod.image, quantity: restoredQty };
            Product.update(prod.id, updated, (err2) => {
              if (err2) return reject(err2);
              resolve();
            });
          });
        });
      }

      // write back file without last
      fs.writeFileSync(logFile, JSON.stringify(entries, null, 2));
      req.flash('success', 'Last checkout undone and stock restored');
      res.redirect('/admin');
    } catch (e) {
      console.error('Undo checkout failed:', e);
      req.flash('error', 'Failed to undo checkout');
      res.redirect('/admin');
    }
  }
  ,
  // Refund an order (Stripe/PayPal supported; NETS/PayNow require manual refund)
  async refundOrder(req, res, options) {
    const admin = req.session.user;
    if (!admin || admin.role !== 'admin') {
      req.flash('error', 'Unauthorized');
      return res.redirect('/');
    }
    const orderId = parseInt(req.params.id, 10);
    if (!orderId) {
      req.flash('error', 'Invalid order id');
      return res.redirect('/admin/users');
    }
    const Order = require('../models/Order');

    Order.getById(orderId, async (err, order) => {
      if (err || !order) {
        req.flash('error', 'Order not found');
        return res.redirect('/admin/users');
      }
      if (order.refund_status && String(order.refund_status).toLowerCase() === 'refunded') {
        req.flash('error', 'Order already refunded.');
        return res.redirect(`/admin/users/${order.user_id}/orders`);
      }
      const rawAmount = req.body.amount;
      const amount = rawAmount ? Number(rawAmount) : Number(order.total);
      if (!Number.isFinite(amount) || amount <= 0) {
        req.flash('error', 'Invalid refund amount.');
        return res.redirect(`/admin/users/${order.user_id}/orders`);
      }
      if (amount > Number(order.total)) {
        req.flash('error', 'Refund amount exceeds order total.');
        return res.redirect(`/admin/users/${order.user_id}/orders`);
      }
      try {
        const refundResult = await executeRefund(order, amount);
        Order.markRefund(orderId, {
          refund_status: refundResult.status,
          refund_reference: refundResult.reference,
          refund_amount: amount.toFixed(2),
          refunded_at: new Date()
        }, (uErr) => {
          if (uErr) {
            req.flash('error', 'Refund completed but failed to update order record.');
          } else {
            req.flash('success', `Refund processed for Order #${orderId}.`);
          }
          if (options && options.approveRequest) {
            Order.updateRefundRequestStatus(orderId, {
              refund_request_status: 'approved',
              refund_request_note: (req.body.note || '').trim() || null,
              refund_decision_at: new Date()
            }, () => {
              return res.redirect(`/admin/users/${order.user_id}/orders`);
            });
            return;
          }
          return res.redirect(`/admin/users/${order.user_id}/orders`);
        });
      } catch (e) {
        console.error('Refund failed:', e);
        req.flash('error', e.message || 'Refund failed.');
        return res.redirect(`/admin/users/${order.user_id}/orders`);
      }
    });
  }
  ,
  // Approve a customer refund request (then process refund if possible)
  async approveRefundRequest(req, res) {
    const admin = req.session.user;
    if (!admin || admin.role !== 'admin') {
      req.flash('error', 'Unauthorized');
      return res.redirect('/');
    }
    const Order = require('../models/Order');
    const orderId = parseInt(req.params.id, 10);
    if (!orderId) {
      req.flash('error', 'Invalid order id');
      return res.redirect('/admin/users');
    }
    Order.getById(orderId, async (err, order) => {
      if (err || !order) {
        req.flash('error', 'Order not found');
        return res.redirect('/admin/users');
      }
      const status = String(order.refund_request_status || '').toLowerCase();
      if (status !== 'pending') {
        req.flash('error', 'No pending refund request for this order.');
        return res.redirect(`/admin/users/${order.user_id}/orders`);
      }
      const amount = req.body.amount ? Number(req.body.amount) : Number(order.refund_request_amount || order.total);
      if (!Number.isFinite(amount) || amount <= 0 || amount > Number(order.total)) {
        req.flash('error', 'Invalid refund amount.');
        return res.redirect(`/admin/users/${order.user_id}/orders`);
      }
      const provider = (order.payment_provider || order.delivery_method || '').toLowerCase();
      if (provider !== 'stripe' && provider !== 'paypal') {
        Order.updateRefundRequestStatus(orderId, {
          refund_request_status: 'approved',
          refund_request_note: (req.body.note || '').trim() || 'Manual refund required.',
          refund_decision_at: new Date()
        }, () => {
          Order.markRefund(orderId, {
            refund_status: 'manual',
            refund_reference: null,
            refund_amount: amount.toFixed(2),
            refunded_at: null
          }, () => {
            req.flash('success', 'Refund approved. Manual processing required for this payment method.');
            return res.redirect(`/admin/users/${order.user_id}/orders`);
          });
        });
        return;
      }
      req.body.amount = amount;
      return module.exports.refundOrder(req, res, { approveRequest: true });
    });
  }
  ,
  // Deny a customer refund request
  denyRefundRequest(req, res) {
    const admin = req.session.user;
    if (!admin || admin.role !== 'admin') {
      req.flash('error', 'Unauthorized');
      return res.redirect('/');
    }
    const Order = require('../models/Order');
    const orderId = parseInt(req.params.id, 10);
    if (!orderId) {
      req.flash('error', 'Invalid order id');
      return res.redirect('/admin/users');
    }
    Order.getById(orderId, (err, order) => {
      if (err || !order) {
        req.flash('error', 'Order not found');
        return res.redirect('/admin/users');
      }
      const status = String(order.refund_request_status || '').toLowerCase();
      if (status !== 'pending') {
        req.flash('error', 'No pending refund request for this order.');
        return res.redirect(`/admin/users/${order.user_id}/orders`);
      }
      Order.updateRefundRequestStatus(orderId, {
        refund_request_status: 'denied',
        refund_request_note: (req.body.note || '').trim() || null,
        refund_decision_at: new Date()
      }, (uErr) => {
        if (uErr) {
          req.flash('error', 'Failed to update refund request.');
        } else {
          req.flash('success', 'Refund request denied.');
        }
        return res.redirect(`/admin/users/${order.user_id}/orders`);
      });
    });
  }
  ,
  // Cleanup duplicate order_items by aggregating per order/product
  cleanupOrderItems(req, res) {
    const admin = req.session.user;
    if (!admin || admin.role !== 'admin') {
      req.flash('error', 'Unauthorized');
      return res.redirect('/');
    }
    const db = require('../db');
    const aggregateSql = `
      SELECT order_id,
             product_id,
             SUM(quantity) AS quantity,
             SUM(price * quantity) AS total_price
      FROM order_items
      GROUP BY order_id, product_id
    `;
    db.query(aggregateSql, (aErr, rows) => {
      if (aErr) {
        console.error('Aggregate order_items failed:', aErr);
        req.flash('error', 'Failed to aggregate order items.');
        return res.redirect('/admin');
      }
      db.beginTransaction((tErr) => {
        if (tErr) {
          console.error('Transaction start failed:', tErr);
          req.flash('error', 'Failed to start cleanup.');
          return res.redirect('/admin');
        }
        db.query('DELETE FROM order_items', (dErr) => {
          if (dErr) {
            return db.rollback(() => {
              console.error('Failed to clear order_items:', dErr);
              req.flash('error', 'Failed to clear order items.');
              return res.redirect('/admin');
            });
          }
          if (!rows.length) {
            return db.commit((cErr) => {
              if (cErr) {
                return db.rollback(() => {
                  req.flash('error', 'Cleanup failed.');
                  return res.redirect('/admin');
                });
              }
              req.flash('success', 'Order items already clean.');
              return res.redirect('/admin');
            });
          }
          const values = rows.map(r => {
            const qty = Number(r.quantity) || 0;
            const total = Number(r.total_price) || 0;
            const unit = qty > 0 ? (total / qty) : 0;
            return [r.order_id, r.product_id, qty, Number(unit.toFixed(2))];
          });
          const insertSql = 'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ?';
          db.query(insertSql, [values], (iErr) => {
            if (iErr) {
              return db.rollback(() => {
                console.error('Failed to reinsert order_items:', iErr);
                req.flash('error', 'Failed to rebuild order items.');
                return res.redirect('/admin');
              });
            }
            db.commit((cErr) => {
              if (cErr) {
                return db.rollback(() => {
                  req.flash('error', 'Cleanup failed.');
                  return res.redirect('/admin');
                });
              }
              req.flash('success', 'Order items cleaned up successfully.');
              return res.redirect('/admin');
            });
          });
        });
      });
    });
  }
  ,
  // Backfill orders.items_snapshot from current order_items
  backfillOrderSnapshots(req, res) {
    const admin = req.session.user;
    if (!admin || admin.role !== 'admin') {
      req.flash('error', 'Unauthorized');
      return res.redirect('/');
    }
    const db = require('../db');
    const sql = `
      SELECT oi.order_id,
             oi.product_id,
             SUM(oi.quantity) AS quantity,
             SUM(oi.price * oi.quantity) AS total_price,
             p.productName
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      GROUP BY oi.order_id, oi.product_id, p.productName
    `;
    db.query(sql, (err, rows) => {
      if (err) {
        console.error('Backfill snapshot query failed:', err);
        req.flash('error', 'Failed to load order items for snapshot backfill.');
        return res.redirect('/admin');
      }
      const byOrder = {};
      rows.forEach((r) => {
        const qty = Number(r.quantity) || 0;
        const lineTotal = Number(r.total_price) || 0;
        const unitPrice = qty > 0 ? Number((lineTotal / qty).toFixed(2)) : 0;
        if (!byOrder[r.order_id]) byOrder[r.order_id] = [];
        byOrder[r.order_id].push({
          productId: r.product_id,
          productName: r.productName,
          quantity: qty,
          unitPrice,
          lineTotal
        });
      });
      const orderIds = Object.keys(byOrder);
      if (!orderIds.length) {
        req.flash('success', 'No order items found to backfill.');
        return res.redirect('/admin');
      }
      let updated = 0;
      let pending = orderIds.length;
      orderIds.forEach((orderId) => {
        const payload = JSON.stringify(byOrder[orderId]);
        db.query('UPDATE orders SET items_snapshot = ? WHERE id = ?', [payload, orderId], (uErr) => {
          if (!uErr) updated += 1;
          pending -= 1;
          if (pending === 0) {
            if (updated) {
              req.flash('success', `Backfilled snapshots for ${updated} orders.`);
            } else {
              req.flash('error', 'No snapshots were updated.');
            }
            return res.redirect('/admin');
          }
        });
      });
    });
  }
};
