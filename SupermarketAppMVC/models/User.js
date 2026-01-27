/**
 * User model
 * - SQL helpers for users table (CRUD, list/get)
 */
const db = require('../db');

// User model — `users` table fields: id, username, email, password, address, contact, role, free_delivery (optional).
// Removed legacy `image` field references to avoid SQL errors.
const User = {
  // List all users (admin page)
  getAll(callback) {
    db.query(
      'SELECT id, username, email, address, contact, role, free_delivery, subscription_tier, subscription_price, subscription_started_at, subscription_cancel_reason, subscription_cancelled_at, subscription_cancel_effective_at FROM users',
      (err, results) => callback(err, results)
    );
  },

  // Fetch one user by id
  getById(id, callback) {
    db.query(
      'SELECT id, username, email, address, contact, role, free_delivery, subscription_tier, subscription_price, subscription_started_at, subscription_cancel_reason, subscription_cancelled_at, subscription_cancel_effective_at FROM users WHERE id = ?',
      [id],
      (err, results) => {
        if (err) return callback(err);
        callback(null, results[0] || null);
      }
    );
  },

  // Create a new user; password hashed with SHA1 in SQL (demo purposes)
  add(user, callback) {
    const sql = 'INSERT INTO users (username, email, password, address, contact, role, free_delivery, subscription_tier, subscription_price, subscription_started_at) VALUES (?, ?, SHA1(?), ?, ?, ?, ?, ?, ?, ?)';
    const tier = user.subscription_tier || 'basic';
    const price = Number.isFinite(user.subscription_price) ? user.subscription_price : 0;
    db.query(sql, [
      user.username,
      user.email,
      user.password,
      user.address || null,
      user.contact || null,
      user.role || 'user',
      user.free_delivery ? 1 : 0,
      tier,
      price,
      user.subscription_started_at || null
    ], (err, result) => {
      if (err) return callback(err);
      callback(null, { insertId: result.insertId, affectedRows: result.affectedRows });
    });
  },

  // Update user details
  update(id, user, callback) {
    const fields = ['username = ?', 'email = ?', 'address = ?', 'contact = ?', 'role = ?', 'free_delivery = ?'];
    const params = [user.username, user.email, user.address || null, user.contact || null, user.role || 'user', user.free_delivery ? 1 : 0];
    if (user.password && user.password.trim() !== '') {
      fields.push('password = SHA1(?)');
      params.push(user.password.trim());
    }
    const sql = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;
    params.push(id);
    db.query(sql, params, (err, result) => {
      if (err) return callback(err);
      callback(null, { changedRows: result.changedRows, affectedRows: result.affectedRows });
    });
  },

  // Update a user's subscription tier
  updateSubscription(id, tier, price, startedAt, callback) {
    const sql = 'UPDATE users SET subscription_tier = ?, subscription_price = ?, subscription_started_at = ?, subscription_cancel_reason = NULL, subscription_cancelled_at = NULL, subscription_cancel_effective_at = NULL WHERE id = ?';
    db.query(sql, [tier, price, startedAt || null, id], (err, result) => {
      if (err) return callback(err);
      callback(null, { changedRows: result.changedRows, affectedRows: result.affectedRows });
    });
  },

  // Cancel subscription with reason
  cancelSubscription(id, reason, cancelledAt, effectiveAt, callback) {
    const sql = 'UPDATE users SET subscription_cancel_reason = ?, subscription_cancelled_at = ?, subscription_cancel_effective_at = ? WHERE id = ?';
    db.query(sql, [reason || null, cancelledAt || null, effectiveAt || null, id], (err, result) => {
      if (err) return callback(err);
      callback(null, { changedRows: result.changedRows, affectedRows: result.affectedRows });
    });
  },


  // Delete user by id (admin only)
  delete(id, callback) {
    db.query('DELETE FROM users WHERE id = ?', [id], (err, result) => {
      if (err) return callback(err);
      callback(null, { affectedRows: result.affectedRows });
    });
  }
};

module.exports = User;
