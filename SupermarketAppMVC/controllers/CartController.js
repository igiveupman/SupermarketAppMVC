// CartController: manages session-based cart and checkout
const Product = require('../models/Product');
const Order = require('../models/Order');

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

    Product.getById(productId, (err, product) => {
      if (err) return res.status(500).send(err);
      if (!product) return res.status(404).send('Product not found');
      const available = Number(product.quantity) || 0;
  // Stock validation: compare requested and cumulative cart quantity against latest DB quantity.
      if (quantity > available) {
        req.flash('error', 'Not enough stock. Available: ' + available);
        const destFail = req.body.returnTo && /^\/.+/.test(req.body.returnTo) ? req.body.returnTo : '/shopping';
        return res.redirect(destFail);
      }

      if (!req.session.cart) req.session.cart = [];

      const existing = req.session.cart.find(item => item.productId === productId);
      if (existing) {
        // Re-validate with latest available quantity from DB
        const newTotal = existing.quantity + quantity;
        if (newTotal > available) {
          req.flash('error', 'Not enough stock. In cart: ' + existing.quantity + ', available: ' + available);
          const destFail2 = req.body.returnTo && /^\/.+/.test(req.body.returnTo) ? req.body.returnTo : '/shopping';
          return res.redirect(destFail2);
        }
        existing.quantity = newTotal;
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

  const totalQty = existing ? existing.quantity : quantity; // total for this line after update
  // Successful add; totalQty is the current line quantity after addition.
  const addedMsg = quantity + ' ' + product.productName + (quantity > 1 ? 's' : '') + ' added to cart.';
  req.flash('success', addedMsg);
  const dest = req.body.returnTo && /^\/.+/.test(req.body.returnTo) ? req.body.returnTo : '/shopping';
  res.redirect(dest);
    });
  },

  // Remove item from cart by product id
  removeFromCart(req, res) {
    const productId = parseInt(req.params.id, 10);
    if (!req.session.cart) return res.redirect('/cart');
    req.session.cart = req.session.cart.filter(item => item.productId !== productId);
  req.flash('success', 'Item removed from cart.');
  res.redirect('/cart');
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
    item.quantity = qty;
    req.flash('success', 'Quantity updated.');
    res.redirect('/cart');
  }

  ,
  // Clear all items from the cart
  clearCart(req, res) {
    if (req.session.cart && req.session.cart.length) {
      req.session.cart = [];
      req.flash('success', 'Cart cleared.');
    } else {
      req.flash('error', 'Your cart is already empty.');
    }
    res.redirect('/cart');
  }

  ,


  // Checkout: verify stock, decrement product quantities, clear cart, and record order
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
        // record order in orders table for history (quick purchase)
        const total = cart.reduce((sum,i)=> sum + (i.price * i.quantity), 0);
    Order.create({
          user_id: req.session.user.id,
          total: total.toFixed(2),
            delivery_method: req.session.payment_method || 'card',
          delivery_address: req.session.checkout_address || '',
          delivery_fee: '0.00'
    }, cart, (oErr, data) => {
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
      if ((prod.quantity || 0) < item.quantity) return reject(new Error('Insufficient stock for ' + prod.productName));
      const newQty = (prod.quantity || 0) - item.quantity;
      const updated = { productName: prod.productName, price: prod.price, image: prod.image, quantity: newQty, category: prod.category };
      Product.update(prod.id, updated, (err2) => {
        if (err2) return reject(err2);
        results.push({ id: prod.id, name: prod.productName, purchased: item.quantity, remaining: newQty, unitPrice: prod.price });
        resolve();
      });
    });
  });
  Promise.all(cart.map(processItem))
    .then(() => {
      const total = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
      req.session.cart = [];
      res.json({ success:true, message:'Checkout complete', total: total.toFixed(2), items: results });
    })
    .catch(err => {
      res.status(400).json({ success:false, error: err.message || 'Checkout failed' });
    });
};
