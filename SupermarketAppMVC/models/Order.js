/**
 * Order model
 * - Creates orders and optionally persists order_items
 * - Lists, fetches, and clears orders (optionally per-user)
 */
const db = require('../db');

const Order = {
  // Create an order and (optionally) its line items
  create(order, items, callback) {
    db.beginTransaction((tErr) => {
      if (tErr) return callback(tErr);
      const sql = 'INSERT INTO orders (user_id, total, delivery_method, delivery_address, delivery_fee, payment_provider, payment_reference, payment_order_id, refund_status, voucher_code, voucher_amount, items_snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())';
      const params = [
        order.user_id,
        order.total,
        order.delivery_method,
        order.delivery_address,
        order.delivery_fee,
        order.payment_provider || null,
        order.payment_reference || null,
        order.payment_order_id || null,
        order.refund_status || null,
        order.voucher_code || null,
        order.voucher_amount || null,
        order.items_snapshot || null
      ];
      db.query(sql, params, (err, result) => {
        if (err) {
          console.error('Order insert failed:', { order, err });
          return db.rollback(() => callback(err));
        }
        const orderId = result.insertId;
        if (items && items.length) {
          const itemsSql = 'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ?';
          const values = items.map(i => [orderId, i.productId, i.quantity, i.price]);
          db.query(itemsSql, [values], (iErr) => {
            if (iErr && iErr.code !== 'ER_NO_SUCH_TABLE') {
              console.error('Order items insert failed:', { orderId, items, iErr });
              return db.rollback(() => callback(iErr));
            }
            db.commit((cErr) => {
              if (cErr) return db.rollback(() => callback(cErr));
              return callback(null, { orderId });
            });
          });
        } else {
          db.commit((cErr) => {
            if (cErr) return db.rollback(() => callback(cErr));
            callback(null, { orderId });
          });
        }
      });
    });
  },
  // List orders for a specific user
  listByUser(userId, callback) {
    db.query('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC', [userId], callback);
  },
  // Count orders for a specific user
  countByUser(userId, callback) {
    db.query('SELECT COUNT(*) AS total FROM orders WHERE user_id = ?', [userId], (err, rows) => {
      if (err) return callback(err);
      callback(null, rows && rows[0] ? rows[0].total : 0);
    });
  },
  // List orders for a user with pagination
  listByUserPaged(userId, limit, offset, callback) {
    db.query('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?', [userId, limit, offset], callback);
  },
  // Fetch a single order by id
  getById(orderId, callback) {
    db.query('SELECT * FROM orders WHERE id = ?', [orderId], (err, rows) => {
      if (err) return callback(err);
      callback(null, rows && rows[0] ? rows[0] : null);
    });
  },
  // Admin maintenance: clear all orders (and their items if table exists)
  clearAll(callback) {
    // attempt to delete order_items first (if table exists), then orders
    const deleteItems = 'DELETE FROM order_items';
    db.query(deleteItems, (itemErr) => {
      if (itemErr && itemErr.code === 'ER_NO_SUCH_TABLE') {
        // table absent, proceed to clear orders only
        console.warn('order_items table missing; skipping its purge.');
      } else if (itemErr) {
        console.error('Failed to clear order_items:', itemErr);
        // continue anyway to clear orders
      }
      db.query('DELETE FROM orders', (orderErr, result) => {
        if (orderErr) return callback(orderErr);
        callback(null, { affectedRows: result.affectedRows });
      });
    });
  },
  // Admin: clear orders for a specific user (and items)
  clearByUser(userId, callback) {
    // delete order_items for this user's orders then the orders
    const findSql = 'SELECT id FROM orders WHERE user_id = ?';
    db.query(findSql, [userId], (fErr, rows) => {
      if (fErr) return callback(fErr);
      if (!rows.length) return callback(null, { affectedRows: 0 });
      const orderIds = rows.map(r => r.id);
      const itemsSql = 'DELETE FROM order_items WHERE order_id IN (?)';
      db.query(itemsSql, [orderIds], (iErr) => {
        if (iErr && iErr.code === 'ER_NO_SUCH_TABLE') {
          console.warn('order_items table missing; skipping item purge for user', userId);
        } else if (iErr) {
          console.error('Failed to delete order_items for user', userId, iErr);
        }
        db.query('DELETE FROM orders WHERE user_id = ?', [userId], (oErr, result) => {
          if (oErr) return callback(oErr);
          callback(null, { affectedRows: result.affectedRows });
        });
      });
    });
  }
  ,
  // Update refund status and metadata for an order
  markRefund(orderId, data, callback) {
    const sql = 'UPDATE orders SET refund_status = ?, refund_reference = ?, refund_amount = ?, refunded_at = ? WHERE id = ?';
    const params = [
      data.refund_status || null,
      data.refund_reference || null,
      data.refund_amount || null,
      data.refunded_at || null,
      orderId
    ];
    db.query(sql, params, (err, result) => {
      if (err) return callback(err);
      callback(null, result);
    });
  }
  ,
  // Create a refund request for an order (customer-side)
  setRefundRequest(orderId, userId, data, callback) {
    const sql = 'UPDATE orders SET refund_request_status = ?, refund_request_reason = ?, refund_request_type = ?, refund_request_amount = ?, refund_requested_at = ? WHERE id = ? AND user_id = ?';
    const params = [
      data.refund_request_status || null,
      data.refund_request_reason || null,
      data.refund_request_type || null,
      data.refund_request_amount || null,
      data.refund_requested_at || null,
      orderId,
      userId
    ];
    db.query(sql, params, (err, result) => {
      if (err) return callback(err);
      callback(null, result);
    });
  }
  ,
  // Update refund request status (admin decision)
  updateRefundRequestStatus(orderId, data, callback) {
    const sql = 'UPDATE orders SET refund_request_status = ?, refund_request_note = ?, refund_decision_at = ? WHERE id = ?';
    const params = [
      data.refund_request_status || null,
      data.refund_request_note || null,
      data.refund_decision_at || null,
      orderId
    ];
    db.query(sql, params, (err, result) => {
      if (err) return callback(err);
      callback(null, result);
    });
  }
};

module.exports = Order;
