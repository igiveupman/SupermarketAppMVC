// AuthController: handles login form, login submission, and logout
const db = require('../db');
const CartController = require('./CartController');

module.exports = {
  // Render the login form, passing any flash messages
  loginForm(req, res) {
    res.render('login', {
      user: req.session.user || null,
      messages: req.flash('success') || [],
      errors: req.flash('error') || []
    });
  },
  // Validate credentials; on success store user in session and redirect to home
  login(req, res) {
    const { email, password } = req.body;
    if (!email || !password) {
      req.flash('error', 'All fields are required.');
      return res.redirect('/login');
    }
    const sql = 'SELECT * FROM users WHERE email = ? AND password = SHA1(?)';
    db.query(sql, [email, password], (err, results) => {
      if (err) return res.status(500).send('Server error');
      if (!results.length) {
        req.flash('error', 'Invalid email or password.');
        return res.redirect('/login');
      }
      const userRecord = results[0];
      req.session.regenerate((regenErr) => {
        if (regenErr) return res.status(500).send('Session error');
        req.session.user = userRecord;
        req.flash('success', 'Login successful!');
        // Hydrate cart from DB so it persists across logouts
        CartController.loadCartForUser(req.session.user.id)
          .then(cart => { req.session.cart = cart; })
          .catch(() => { req.session.cart = []; })
          .finally(() => {
            if (req.session.user.role === 'admin') {
              db.query('SELECT productName FROM products WHERE quantity <= 0', (perr, soldOut) => {
                if (!perr && soldOut.length) {
                  const names = soldOut.map(r => r.productName).join(', ');
                  const msg = 'Sold out: ' + names + '. Please restock.';
                  const existingErrors = req.flash('error') || [];
                  if (!existingErrors.includes(msg)) {
                    req.flash('error', msg);
                  }
                  existingErrors.filter(e => e !== msg).forEach(e => req.flash('error', e));
                }
                return res.redirect('/');
              });
            } else {
              return res.redirect('/');
            }
          });
      });
    });
  },
  // Destroy session and return to login page
  logout(req, res) {
    req.session.destroy(() => {
      res.redirect('/login');
    });
  }
};
