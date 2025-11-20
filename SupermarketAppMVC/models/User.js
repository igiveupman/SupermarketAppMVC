const db = require('../db');

// User model — this project uses a `users` table (see app.js) with fields like
// username, email, password, address, contact, role, image. Update methods to
// operate on that table so controllers work consistently.
const User = {
  getAll(callback) {
    db.query('SELECT id, username, email, address, contact, role, image FROM users', (err, results) => callback(err, results));
  },

  getById(id, callback) {
    db.query('SELECT id, username, email, address, contact, role, image FROM users WHERE id = ?', [id], (err, results) => {
      if (err) return callback(err);
      callback(null, results[0] || null);
    });
  },

  add(user, callback) {
    const sql = 'INSERT INTO users (username, email, password, address, contact, role, image) VALUES (?, ?, SHA1(?), ?, ?, ?, ?)';
    db.query(sql, [user.username, user.email, user.password, user.address || null, user.contact || null, user.role || 'user', user.image || null], (err, result) => {
      if (err) return callback(err);
      callback(null, { insertId: result.insertId, affectedRows: result.affectedRows });
    });
  },

  update(id, user, callback) {
    const sql = 'UPDATE users SET username=?, email=?, address=?, contact=?, role=?, image=? WHERE id = ?';
    db.query(sql, [user.username, user.email, user.address || null, user.contact || null, user.role || 'user', user.image || null, id], (err, result) => {
      if (err) return callback(err);
      callback(null, { changedRows: result.changedRows, affectedRows: result.affectedRows });
    });
  },

  delete(id, callback) {
    db.query('DELETE FROM users WHERE id = ?', [id], (err, result) => {
      if (err) return callback(err);
      callback(null, { affectedRows: result.affectedRows });
    });
  }
};

module.exports = User;