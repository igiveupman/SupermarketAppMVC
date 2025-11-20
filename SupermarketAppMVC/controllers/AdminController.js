module.exports = {
  dashboard(req, res) {
    // Render a simple admin dashboard; reuse Product model to show counts
    const Product = require('../models/Product');
    const User = require('../models/User');

    Product.getAll((err, products) => {
      if (err) return res.status(500).send(err);
      User.getAll((err2, users) => {
        if (err2) return res.status(500).send(err2);
        res.render('adminDashboard', { products, users, user: req.session.user, messages: req.flash('success'), errors: req.flash('error') });
      });
    });
  }
  ,

  async undoLastCheckout(req, res) {
    const fs = require('fs');
    const path = require('path');
    const logFile = path.join(__dirname, '..', 'data', 'checkout_log.json');
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
};
