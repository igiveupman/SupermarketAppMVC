/**
 * Favorite model
 * - Manages favorites table and product joins per user
 */
const db = require('../db');

const Favorite = {
  // Ensure favorites table exists (idempotent)
  tableInit(callback){
    const sql = `CREATE TABLE IF NOT EXISTS favorites (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      product_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_user_product (user_id, product_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;`;
    db.query(sql, callback || (()=>{}));
  },
  // Add favorite for user/product pair
  add(userId, productId, callback){
    const sql = 'INSERT IGNORE INTO favorites (user_id, product_id) VALUES (?, ?)';
    db.query(sql, [userId, productId], (err, result) => {
      if (err) return callback(err);
      callback(null, { affectedRows: result.affectedRows });
    });
  },
  // Remove favorite
  remove(userId, productId, callback){
    const sql = 'DELETE FROM favorites WHERE user_id = ? AND product_id = ?';
    db.query(sql, [userId, productId], (err, result) => {
      if (err) return callback(err);
      callback(null, { affectedRows: result.affectedRows });
    });
  },
  // List favorite products for a user (joined with products)
  list(userId, callback){
    const sql = 'SELECT p.id, p.productName, p.price, p.image, p.quantity, p.category FROM favorites f JOIN products p ON f.product_id = p.id WHERE f.user_id = ?';
    db.query(sql, [userId], (err, results) => callback(err, results));
  },
  // Check if product is favorited by user
  isFavorited(userId, productId, callback){
    const sql = 'SELECT id FROM favorites WHERE user_id = ? AND product_id = ? LIMIT 1';
    db.query(sql, [userId, productId], (err, results) => {
      if (err) return callback(err);
      callback(null, results.length > 0);
    });
  }
};

module.exports = Favorite;
