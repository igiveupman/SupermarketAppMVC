/**
 * Product model
 * - Encapsulates SQL for CRUD and filtered listing
 */
// Product model: SQL accessors for products table
const db = require('../db');

// Product model aligned with the rest of the app which uses `productName` as the
// column for the product's name (and `id`, `price`, `quantity`, `image`, ...).
const Product = {
  // List products with optional search and category filters
  getAllFiltered({ search, category, featured }, callback) {
    let sql = 'SELECT id, productName, price, discount_price, image, quantity, category, featured FROM products WHERE 1=1';
    const params = [];
    if (search) {
      sql += ' AND productName LIKE ?';
      params.push('%' + search + '%');
    }
    if (category) {
      // Treat multiple UI labels as produce; match any variant stored in DB
      if (['Produce','Fruits & Vegs','Fruits and Vegetables','Fruits & Vegetables'].includes(category)) {
        sql += ' AND ((category IN ("Produce","Fruits & Vegs","Fruits and Vegetables","Fruits & Vegetables"))'
              + ' OR (category IS NULL AND productName IN ("Apples","Bananas","Tomatoes","Broccoli")))';
        // no params needed for variant list
      } else {
        sql += ' AND category = ?';
        params.push(category);
      }
    }
    if (featured) {
      sql += ' AND featured = 1';
    }
    db.query(sql, params, (err, results) => callback(err, results));
  },

  // Fetch single product by id
  getById(id, callback) {
    const sql = 'SELECT id, productName, price, discount_price, image, quantity, category, featured FROM products WHERE id = ?';
    db.query(sql, [id], (err, results) => {
      if (err) return callback(err);
      callback(null, results[0] || null);
    });
  },

  // Create a new product
  add(product, callback) {
    const sql = 'INSERT INTO products (productName, price, discount_price, image, quantity, category, featured) VALUES (?, ?, ?, ?, ?, ?, ?)';
    const params = [product.productName || product.name, product.price, product.discount_price || null, product.image || null, product.quantity || 0, product.category || null, product.featured ? 1 : 0];
    console.log('Product.add SQL:', sql, 'params:', params);
    db.query(sql, params, (err, result) => {
      if (err) {
        console.error('Product.add - SQL error:', err);
        return callback(err);
      }
      callback(null, { insertId: result.insertId, affectedRows: result.affectedRows });
    });
  },

  // Update existing product fields (optional category)
  update(id, product, callback) {
    // If category not supplied, keep existing value
    let sql = 'UPDATE products SET productName = ?, price = ?, discount_price = ?, image = ?, quantity = ?';
    const params = [product.productName || product.name, product.price, (product.discount_price || null), product.image || null, product.quantity || 0];
    if (typeof product.category !== 'undefined' && product.category !== null && product.category !== '') {
      sql += ', category = ?';
      params.push(product.category);
    }
    sql += ' WHERE id = ?';
    params.push(id);
    console.log('Product.update SQL:', sql, 'params:', params);
    db.query(sql, params, (err, result) => {
      if (err) {
        console.error('Product.update - SQL error:', err);
        return callback(err);
      }
      callback(null, { changedRows: result.changedRows, affectedRows: result.affectedRows });
    });
  },

  // Delete product by id
  delete(id, callback) {
    const sql = 'DELETE FROM products WHERE id = ?';
    db.query(sql, [id], (err, result) => {
      if (err) return callback(err);
      callback(null, { affectedRows: result.affectedRows });
    });
  },

  // Return products with zero or negative stock
  getSoldOut(callback) {
    const sql = 'SELECT id, productName FROM products WHERE quantity <= 0';
    db.query(sql, [], (err, results) => callback(err, results));
  },

  // List all products
  getAll(callback) {
    const sql = 'SELECT id, productName, price, discount_price, image, quantity, category, featured FROM products';
    db.query(sql, [], (err, results) => callback(err, results));
  },

  // Mark/unmark product as featured
  updateFeatured(id, featured, callback) {
    const sql = 'UPDATE products SET featured = ? WHERE id = ?';
    db.query(sql, [featured ? 1 : 0, id], (err, result) => {
      if (err) return callback(err);
      callback(null, { affectedRows: result.affectedRows });
    });
  }
};

module.exports = Product;