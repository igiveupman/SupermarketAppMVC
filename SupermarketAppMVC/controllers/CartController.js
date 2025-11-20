const Product = require('../models/Product');

module.exports = {
  viewCart(req, res) {
  const cart = req.session.cart || [];
  res.render('cart', { cart, user: req.session.user, messages: req.flash('success'), errors: req.flash('error') });
  },

  addToCart(req, res) {
    const productId = parseInt(req.params.id, 10);
    const quantity = parseInt(req.body.quantity, 10) || 1;

    Product.getById(productId, (err, product) => {
      if (err) return res.status(500).send(err);
      if (!product) return res.status(404).send('Product not found');

      if (!req.session.cart) req.session.cart = [];

      const existing = req.session.cart.find(item => item.productId === productId);
      if (existing) {
        existing.quantity += quantity;
      } else {
        req.session.cart.push({
          productId: product.id,
          productName: product.productName,
          price: product.price,
          quantity: quantity,
          image: product.image
        });
      }

  const totalQty = existing ? existing.quantity : quantity; // not used directly but can extend
  const addedMsg = quantity + ' ' + product.productName + (quantity > 1 ? 's' : '') + ' added to cart.';
  req.flash('success', addedMsg);
  res.redirect('/cart');
    });
  },

  removeFromCart(req, res) {
    const productId = parseInt(req.params.id, 10);
    if (!req.session.cart) return res.redirect('/cart');
    req.session.cart = req.session.cart.filter(item => item.productId !== productId);
  req.flash('success', 'Item removed from cart.');
  res.redirect('/cart');
  }
,

  // Checkout: verify stock, decrement product quantities, clear cart
  checkout(req, res) {
    const cart = req.session.cart || [];
    if (!cart.length) {
      req.flash('error', 'Your cart is empty.');
      return res.redirect('/cart');
    }

    // Process items sequentially to simplify DB updates
    const Product = require('../models/Product');

    // helper to process one item
    const processItem = (item) => {
      return new Promise((resolve, reject) => {
        Product.getById(item.productId, (err, prod) => {
          if (err) return reject(err);
          if (!prod) return reject(new Error('Product not found: ' + item.productId));
          if ((prod.quantity || 0) < item.quantity) return reject(new Error('Insufficient stock for ' + prod.productName));

          const newQty = (prod.quantity || 0) - item.quantity;
          const updated = {
            productName: prod.productName,
            price: prod.price,
            image: prod.image,
            quantity: newQty,
            category: prod.category // preserve existing category
          };
          Product.update(prod.id, updated, (err2) => {
            if (err2) return reject(err2);
            resolve();
          });
        });
      });
    };

    // process all items
    Promise.all(cart.map(processItem))
      .then(() => {
        // success: log the checkout so it can be undone later
        try {
          const fs = require('fs');
          const path = require('path');
          const logDir = path.join(__dirname, '..', 'data');
          const logFile = path.join(logDir, 'checkout_log.json');
          if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
          let entries = [];
          if (fs.existsSync(logFile)) {
            const raw = fs.readFileSync(logFile, 'utf8') || '[]';
            entries = JSON.parse(raw);
          }
          entries.push({ timestamp: Date.now(), items: cart, userId: req.session.user ? req.session.user.id : null });
          fs.writeFileSync(logFile, JSON.stringify(entries, null, 2));
        } catch (e) {
          console.error('Failed to write checkout log:', e);
        }

        // clear cart and redirect
        req.session.cart = [];
        req.flash('success', 'Order placed successfully.');
        res.redirect('/shopping');
      })
      .catch((err) => {
        console.error('Checkout error:', err);
        req.flash('error', err.message || 'Failed to place order.');
        res.redirect('/cart');
      });
  }
,
  // API checkout returning JSON
  apiCheckout(req, res) {
    const cart = req.session.cart || [];
    if (!cart.length) {
      return res.status(400).json({ success:false, error:'Cart is empty' });
    }
    const Product = require('../models/Product');
    const processItem = (item) => new Promise((resolve, reject) => {
      Product.getById(item.productId, (err, prod) => {
        if (err) return reject(err);
        if (!prod) return reject(new Error('Product not found: ' + item.productId));
        if ((prod.quantity || 0) < item.quantity) return reject(new Error('Insufficient stock for ' + prod.productName));
        const newQty = (prod.quantity || 0) - item.quantity;
        const updated = { productName: prod.productName, price: prod.price, image: prod.image, quantity: newQty, category: prod.category };
        Product.update(prod.id, updated, (err2) => {
          if (err2) return reject(err2);
          resolve({ id: prod.id, name: prod.productName, purchased: item.quantity, remaining: newQty });
        });
      });
    });
    Promise.all(cart.map(processItem))
      .then(results => {
        const total = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
        req.session.cart = [];
        res.json({ success:true, message:'Checkout complete', total: total.toFixed(2), items: results });
      })
      .catch(err => {
        res.status(400).json({ success:false, error: err.message || 'Checkout failed' });
      });
  }
};
