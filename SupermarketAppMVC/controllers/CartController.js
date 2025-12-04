// CartController: manages session-based cart and checkout
const Product = require('../models/Product');
const Order = require('../models/Order');
const db = require('../db');

// Helper: adjust product quantity in DB by delta (can be positive to restock or negative to reserve)
function adjustStock(productId, delta) {
  return new Promise((resolve, reject) => {
    Product.getById(productId, (err, prod) => {
      if (err) return reject(err);
      if (!prod) return reject(new Error('Product not found'));
      const current = Number(prod.quantity) || 0;
      const newQty = current + delta;
      if (newQty < 0) {
        return reject(new Error('Not enough stock. Available: ' + current));
      }
      const updated = {
        productName: prod.productName,
        price: prod.price,
        discount_price: prod.discount_price,
        image: prod.image,
        quantity: newQty,
        category: prod.category
      };
      Product.update(prod.id, updated, (err2) => {
        if (err2) return reject(err2);
        resolve({ product: prod, newQty });
      });
    });
  });
}

// Load cart items for a user from DB (used on login)
async function loadCartForUser(userId) {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT c.product_id, c.quantity, p.productName, p.price, p.discount_price, p.image
      FROM cart_items c
      JOIN products p ON p.id = c.product_id
      WHERE c.user_id = ?
    `;
    db.query(sql, [userId], (err, rows) => {
      if (err) return reject(err);
      const cart = rows.map(r => ({
        productId: r.product_id,
        productName: r.productName,
        price: r.discount_price ? parseFloat(r.discount_price) : parseFloat(r.price),
        originalPrice: parseFloat(r.price),
        discountApplied: !!r.discount_price,
        quantity: r.quantity,
        image: r.image
      }));
      resolve(cart);
    });
  });
}

// Persist a cart line item quantity (insert or update)
function setCartItem(userId, productId, quantity) {
  return new Promise((resolve, reject) => {
    const sql = 'INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE quantity = VALUES(quantity)';
    db.query(sql, [userId, productId, quantity], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function deleteCartItem(userId, productId) {
  return new Promise((resolve, reject) => {
    db.query('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?', [userId, productId], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function clearCartDb(userId) {
  return new Promise((resolve, reject) => {
    db.query('DELETE FROM cart_items WHERE user_id = ?', [userId], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

module.exports = {
  // Show current items in the user's cart
  viewCart(req, res) {
  const cart = req.session.cart || [];
  res.render('cart', { cart, user: req.session.user, messages: req.flash('success'), errors: req.flash('error') });
  },
  // Render payment method selection (dummy PayNow or card)
  paymentForm(req, res) {
    const cart = req.session.cart || [];
    if (!cart.length) { req.flash('error', 'Your cart is empty.'); return res.redirect('/cart'); }
    res.render('paymentMethod', { cart, user: req.session.user, messages: req.flash('success'), errors: req.flash('error') });
  },

  // Add a product to the session cart via traditional form submit
  addToCart(req, res) {
    const productId = parseInt(req.params.id, 10);
    const quantity = parseInt(req.body.quantity, 10) || 1;
    if (quantity < 1) {
      req.flash('error', 'Quantity must be at least 1.');
      const destFail = req.body.returnTo && /^\/.+/.test(req.body.returnTo) ? req.body.returnTo : '/shopping';
      return res.redirect(destFail);
    }

    adjustStock(productId, -quantity)
      .then(({ product }) => {
        if (!req.session.cart) req.session.cart = [];
        const existing = req.session.cart.find(item => item.productId === productId);
        if (existing) {
          existing.quantity += quantity;
        } else {
          req.session.cart.push({
            productId: product.id,
            productName: product.productName,
            // Coerce prices to numbers to avoid toFixed errors in views
            price: product.discount_price ? parseFloat(product.discount_price) : parseFloat(product.price),
            originalPrice: parseFloat(product.price),
            discountApplied: !!product.discount_price,
            quantity: quantity,
            image: product.image
          });
        }
        // Persist to DB (best-effort)
        setCartItem(req.session.user.id, productId, existing ? existing.quantity : quantity).catch(()=>{});

        const addedMsg = quantity + ' ' + product.productName + (quantity > 1 ? 's' : '') + ' added to cart.';
        req.flash('success', addedMsg);
        const dest = req.body.returnTo && /^\/.+/.test(req.body.returnTo) ? req.body.returnTo : '/shopping';
        res.redirect(dest);
      })
      .catch((err) => {
        req.flash('error', err.message || 'Unable to add to cart.');
        const destFail = req.body.returnTo && /^\/.+/.test(req.body.returnTo) ? req.body.returnTo : '/shopping';
        res.redirect(destFail);
      });
  },

  // Add to cart via JSON API (used by AJAX) and reserve stock immediately
  apiAddToCart(req, res) {
    const productId = parseInt(req.params.id, 10);
    const quantity = parseInt(req.body.quantity, 10) || 1;
    if (quantity < 1) {
      return res.status(400).json({ success:false, error:'Quantity must be at least 1.' });
    }
    adjustStock(productId, -quantity)
      .then(({ product, newQty }) => {
        if (!req.session.cart) req.session.cart = [];
        const existing = req.session.cart.find(i => i.productId === productId);
        if (existing) {
          existing.quantity += quantity;
        } else {
          req.session.cart.push({
            productId: product.id,
            productName: product.productName,
            price: product.discount_price ? parseFloat(product.discount_price) : parseFloat(product.price),
            originalPrice: parseFloat(product.price),
            discountApplied: !!product.discount_price,
            quantity: quantity,
            image: product.image
          });
        }
        const cartCount = req.session.cart.reduce((sum,i)=> sum + i.quantity, 0);
        setCartItem(req.session.user.id, productId, existing ? existing.quantity : quantity).catch(()=>{});
        res.json({
          success:true,
          message: quantity + ' ' + product.productName + (quantity>1?'s':'') + ' added to cart.',
          cartCount,
          remaining: newQty
        });
      })
      .catch(err => {
        res.status(400).json({ success:false, error: err.message || 'Unable to add to cart.' });
      });
  },

  // Remove item from cart by product id
  removeFromCart(req, res) {
    const productId = parseInt(req.params.id, 10);
    if (!req.session.cart) return res.redirect('/cart');
    const existing = req.session.cart.find(item => item.productId === productId);
    if (!existing) return res.redirect('/cart');

    adjustStock(productId, existing.quantity)
      .then(() => {
        req.session.cart = req.session.cart.filter(item => item.productId !== productId);
        deleteCartItem(req.session.user.id, productId).catch(()=>{});
        req.flash('success', 'Item removed from cart.');
        res.redirect('/cart');
      })
      .catch((err) => {
        req.flash('error', err.message || 'Failed to update stock when removing.');
        res.redirect('/cart');
      });
  }

  ,
  // Update quantity for a cart line item
  updateQuantity(req, res) {
    const productId = parseInt(req.params.id, 10);
    const qty = parseInt(req.body.quantity, 10);
    if (!req.session.cart) req.session.cart = [];
    const item = req.session.cart.find(i => i.productId === productId);
    if (!item) {
      req.flash('error', 'Item not found in cart.');
      return res.redirect('/cart');
    }
    if (isNaN(qty) || qty < 1) {
      req.flash('error', 'Quantity must be at least 1.');
      return res.redirect('/cart');
    }
    const delta = qty - item.quantity; // positive means reserve more, negative means release
    if (delta === 0) {
      req.flash('success', 'Quantity unchanged.');
      return res.redirect('/cart');
    }

    adjustStock(productId, -delta)
      .then(() => {
        item.quantity = qty;
        setCartItem(req.session.user.id, productId, qty).catch(()=>{});
        req.flash('success', 'Quantity updated.');
        res.redirect('/cart');
      })
      .catch((err) => {
        req.flash('error', err.message || 'Unable to update quantity.');
        res.redirect('/cart');
      });
  }

  ,
  // Clear all items from the cart
  clearCart(req, res) {
    const cart = req.session.cart || [];
    if (!cart.length) {
      req.flash('error', 'Your cart is already empty.');
      return res.redirect('/cart');
    }

    Promise.all(cart.map(item => adjustStock(item.productId, item.quantity)))
      .then(() => {
        req.session.cart = [];
        clearCartDb(req.session.user.id).catch(()=>{});
        req.flash('success', 'Cart cleared and stock restored.');
        res.redirect('/cart');
      })
      .catch((err) => {
        req.flash('error', err.message || 'Failed to restore stock while clearing cart.');
        res.redirect('/cart');
      });
  }

  ,


  // Checkout: verify stock, decrement product quantities, clear cart, and record order
  checkout(req, res) {
    const cart = req.session.cart || [];
    if (!cart.length) {
      req.flash('error', 'Your cart is empty.');
      return res.redirect('/cart');
    }

    // process all items: ensure products still exist (stock already reserved at add-to-cart time)
    Promise.all(cart.map(item => new Promise((resolve, reject) => {
      Product.getById(item.productId, (err, prod) => {
        if (err) return reject(err);
        if (!prod) return reject(new Error('Product not found: ' + item.productId));
        resolve(prod);
      });
    })))
      .then((products) => {
        // Recompute totals and item prices from latest DB values
        const priceMap = new Map(products.map(p => [p.id, p]));
        const orderItems = cart.map(i => {
          const prod = priceMap.get(i.productId);
          const price = prod && prod.discount_price ? parseFloat(prod.discount_price) : parseFloat(prod.price);
          return { productId: i.productId, quantity: i.quantity, price };
        });
        const total = orderItems.reduce((sum,i)=> sum + (i.price * i.quantity), 0);
        Order.create({
          user_id: req.session.user.id,
          total: total.toFixed(2),
            delivery_method: req.session.payment_method || 'card',
          delivery_address: req.session.checkout_address || '',
          delivery_fee: '0.00'
    }, orderItems, (oErr, data) => {
          if (oErr) {
            console.error('Order log failed:', oErr);
          } else {
            console.log('Order stored id', data.orderId);
      // Store last order id for invoice link on success page
      req.session.lastOrderId = data.orderId;
          }
        });
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
        clearCartDb(req.session.user.id).catch(()=>{});
        // If coming from payment page, show success screen, else redirect
        if (req.path === '/purchase') {
          const successMsg = 'Payment successful. Delivery to: ' + (req.session.checkout_address || 'N/A');
          return res.render('paymentSuccess', { user: req.session.user, messages: [successMsg], errors: [], lastOrderId: req.session.lastOrderId });
        }
        req.flash('success', 'Order placed successfully.');
        res.redirect('/shopping');
      })
      .catch((err) => {
        console.error('Checkout error:', err);
        req.flash('error', err.message || 'Failed to place order.');
        res.redirect('/cart');
      });
  },
  // Simulate processing payment, validate delivery info, then reuse checkout flow
  paymentProcess(req, res) {
  const { method, card_number, expiry, cvv, delivery_address, delivery_contact } = req.body; // removed card_name (simulation)
    if (!method) {
      req.flash('error', 'Select a payment method.');
      return res.redirect('/purchase');
    }
    if (method !== 'paynow') {
      if (!card_number || !expiry || !cvv) {
        req.flash('error', 'Complete all card details.');
        return res.redirect('/purchase');
      }
      if (card_number.replace(/\s+/g,'').length < 13) {
        req.flash('error', 'Card number seems too short.');
        return res.redirect('/purchase');
      }
    }
    // Validate delivery info
    if (!delivery_address || !delivery_address.trim()) {
      req.flash('error', 'Please provide a delivery address.');
      return res.redirect('/purchase');
    }
    // Persist for use in checkout/order creation and success page
    req.session.checkout_address = delivery_address.trim();
    req.session.checkout_contact = (delivery_contact || '').trim();
    req.session.payment_method = method === 'paynow' ? 'paynow' : 'card';

  // PayNow method is a dummy; no extra flash message
    // Reuse checkout logic (path check will render success page)
    module.exports.checkout(req, res);
  },

};

// JSON API variant for programmatic checkout (returns JSON instead of rendering views)
module.exports.apiCheckout = function(req, res) {
  const cart = req.session.cart || [];
  if (!cart.length) {
    return res.status(400).json({ success:false, error:'Cart is empty' });
  }
  const Product = require('../models/Product');
  const results = [];
  const processItem = (item) => new Promise((resolve, reject) => {
    Product.getById(item.productId, (err, prod) => {
      if (err) return reject(err);
      if (!prod) return reject(new Error('Product not found: ' + item.productId));
      results.push({ id: prod.id, name: prod.productName, purchased: item.quantity, remaining: prod.quantity, unitPrice: prod.price });
      resolve();
    });
  });
  Promise.all(cart.map(processItem))
    .then(() => {
      const total = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
      req.session.cart = [];
      clearCartDb(req.session.user.id).catch(()=>{});
      res.json({ success:true, message:'Checkout complete', total: total.toFixed(2), items: results });
    })
    .catch(err => {
      res.status(400).json({ success:false, error: err.message || 'Checkout failed' });
    });
};

// Export helper for login to hydrate cart from DB
module.exports.loadCartForUser = loadCartForUser;
