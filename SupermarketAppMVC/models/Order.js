// Order model: creates orders and lists/clears them; optionally stores order_items
const db = require('../db');

const Order = {
  // Create an order and (optionally) its line items
  create(order, items, callback) {
    const sql = 'INSERT INTO orders (user_id, total, delivery_method, delivery_address, delivery_fee, created_at) VALUES (?, ?, ?, ?, ?, NOW())';
    const params = [order.user_id, order.total, order.delivery_method, order.delivery_address, order.delivery_fee];
    db.query(sql, params, (err, result) => {
      if (err) {
        console.error('Order insert failed:', { order, err });
        return callback(err);
      }
      const orderId = result.insertId;
      // optional: store order_items if table exists
      if (items && items.length) {
        const itemsSql = 'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ?';
        const values = items.map(i => [orderId, i.productId, i.quantity, i.price]);
        db.query(itemsSql, [values], (iErr) => {
          if (iErr) {
            if (iErr.code === 'ER_NO_SUCH_TABLE') {
              console.warn('order_items table missing; items not stored.');
            } else {
              console.error('Order items insert failed:', { orderId, items, iErr });
            }
          }
          return callback(null, { orderId });
        });
      } else {
        callback(null, { orderId });
      }
    });
  },
  // List orders for a specific user
  listByUser(userId, callback) {
    db.query('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC', [userId], callback);
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
};

module.exports = Order;
