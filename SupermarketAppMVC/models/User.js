// User model: SQL helpers for users table
const db = require('../db');

// User model — `users` table fields: id, username, email, password, address, contact, role, free_delivery (optional).
// Removed legacy `image` field references to avoid SQL errors.
const User = {
  // List all users (admin page)
  getAll(callback) {
    db.query('SELECT id, username, email, address, contact, role, free_delivery FROM users', (err, results) => callback(err, results));
  },

  // Fetch one user by id
  getById(id, callback) {
    db.query('SELECT id, username, email, address, contact, role, free_delivery FROM users WHERE id = ?', [id], (err, results) => {
      if (err) return callback(err);
      callback(null, results[0] || null);
    });
  },

  // Create a new user; password hashed with SHA1 in SQL (demo purposes)
  add(user, callback) {
    const sql = 'INSERT INTO users (username, email, password, address, contact, role, free_delivery) VALUES (?, ?, SHA1(?), ?, ?, ?, ?)';
    db.query(sql, [user.username, user.email, user.password, user.address || null, user.contact || null, user.role || 'user', user.free_delivery ? 1 : 0], (err, result) => {
      if (err) return callback(err);
      callback(null, { insertId: result.insertId, affectedRows: result.affectedRows });
    });
  },

  // Update user details
  update(id, user, callback) {
    const sql = 'UPDATE users SET username=?, email=?, address=?, contact=?, role=?, free_delivery=? WHERE id = ?';
    db.query(sql, [user.username, user.email, user.address || null, user.contact || null, user.role || 'user', user.free_delivery ? 1 : 0, id], (err, result) => {
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