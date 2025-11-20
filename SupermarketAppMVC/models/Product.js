const db = require('../db');

// Product model aligned with the rest of the app which uses `productName` as the
// column for the product's name (and `id`, `price`, `quantity`, `image`, ...).
const Product = {
  getAllFiltered({ search, category }, callback) {
    let sql = 'SELECT id, productName, price, image, quantity, category FROM products WHERE 1=1';
    const params = [];
    if (search) {
      sql += ' AND productName LIKE ?';
      params.push('%' + search + '%');
    }
    if (category) {
      if (category === 'Produce') {
        // include legacy rows where category is NULL but name matches known produce items
        sql += ' AND (category = ? OR (category IS NULL AND productName IN ("Apples","Bananas","Tomatoes","Broccoli")))';
        params.push(category);
      } else {
        sql += ' AND category = ?';
        params.push(category);
      }
    }
    db.query(sql, params, (err, results) => callback(err, results));
  },

  getById(id, callback) {
  const sql = 'SELECT id, productName, price, image, quantity, category FROM products WHERE id = ?';
    db.query(sql, [id], (err, results) => {
      if (err) return callback(err);
      callback(null, results[0] || null);
    });
  },

  add(product, callback) {
  const sql = 'INSERT INTO products (productName, price, image, quantity, category) VALUES (?, ?, ?, ?, ?)';
  const params = [product.productName || product.name, product.price, product.image || null, product.quantity || 0, product.category || null];
  console.log('Product.add SQL:', sql, 'params:', params);
    db.query(sql, params, (err, result) => {
      if (err) {
        console.error('Product.add - SQL error:', err);
        return callback(err);
      }
      callback(null, { insertId: result.insertId, affectedRows: result.affectedRows });
    });
  },

  update(id, product, callback) {
  // If category not supplied, keep existing value
  let sql = 'UPDATE products SET productName = ?, price = ?, image = ?, quantity = ?';
  const params = [product.productName || product.name, product.price, product.image || null, product.quantity || 0];
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

  delete(id, callback) {
    const sql = 'DELETE FROM products WHERE id = ?';
    db.query(sql, [id], (err, result) => {
      if (err) return callback(err);
      callback(null, { affectedRows: result.affectedRows });
    });
  }
};

module.exports = Product;