/**
 * Review model
 * - Manages product_reviews table (one review per user per product)
 */
const db = require('../db');

const Review = {
  // Ensure table exists (idempotent)
  tableInit(callback) {
    const sql = `CREATE TABLE IF NOT EXISTS product_reviews (
      id INT AUTO_INCREMENT PRIMARY KEY,
      product_id INT NOT NULL,
      user_id INT NOT NULL,
      rating TINYINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
      title VARCHAR(100) NULL,
      comment TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_user_product (user_id, product_id),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;`;
    db.query(sql, callback || (() => {}));
  },

  addOrUpdate(userId, productId, rating, title, comment, callback) {
    const sql = `
      INSERT INTO product_reviews (user_id, product_id, rating, title, comment)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE rating = VALUES(rating), title = VALUES(title), comment = VALUES(comment), created_at = CURRENT_TIMESTAMP
    `;
    db.query(sql, [userId, productId, rating, title || null, comment || null], (err, result) => {
      if (err) return callback(err);
      callback(null, { affectedRows: result.affectedRows });
    });
  },

  listByProduct(productId, { limit = 5, offset = 0 } = {}, callback) {
    const sql = `
      SELECT r.id, r.user_id, r.rating, r.title, r.comment, r.created_at, u.username
      FROM product_reviews r
      JOIN users u ON u.id = r.user_id
      WHERE r.product_id = ?
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?
    `;
    db.query(sql, [productId, limit, offset], (err, rows) => callback(err, rows || []));
  },

  getStats(productId, callback) {
    const sql = 'SELECT COUNT(*) AS reviewCount, AVG(rating) AS averageRating FROM product_reviews WHERE product_id = ?';
    db.query(sql, [productId], (err, rows) => {
      if (err) return callback(err);
      const row = rows && rows[0] ? rows[0] : { reviewCount: 0, averageRating: null };
      const count = row.reviewCount ? Number(row.reviewCount) : 0;
      const avgRaw = row.averageRating;
      const avgNum = (avgRaw === null || typeof avgRaw === 'undefined') ? null : Number(avgRaw);
      const averageRating = (avgNum === null || Number.isNaN(avgNum)) ? null : Number(avgNum.toFixed(2));
      callback(null, { reviewCount: count, averageRating });
    });
  },

  // Bulk stats for multiple products
  getStatsForProducts(productIds, callback) {
    if (!Array.isArray(productIds) || !productIds.length) {
      return callback(null, {});
    }
    const placeholders = productIds.map(() => '?').join(',');
    const sql = `
      SELECT product_id, COUNT(*) AS reviewCount, AVG(rating) AS averageRating
      FROM product_reviews
      WHERE product_id IN (${placeholders})
      GROUP BY product_id
    `;
    db.query(sql, productIds, (err, rows) => {
      if (err) return callback(err);
      const map = {};
      (rows || []).forEach(r => {
        const count = r.reviewCount ? Number(r.reviewCount) : 0;
        const avgRaw = r.averageRating;
        const avgNum = (avgRaw === null || typeof avgRaw === 'undefined') ? null : Number(avgRaw);
        const averageRating = (avgNum === null || Number.isNaN(avgNum)) ? null : Number(avgNum.toFixed(1));
        map[r.product_id] = { reviewCount: count, averageRating };
      });
      callback(null, map);
    });
  },

  getUserReview(userId, productId, callback) {
    const sql = 'SELECT id, rating, title, comment FROM product_reviews WHERE user_id = ? AND product_id = ? LIMIT 1';
    db.query(sql, [userId, productId], (err, rows) => {
      if (err) return callback(err);
      callback(null, rows && rows[0] ? rows[0] : null);
    });
  }
};

module.exports = Review;
