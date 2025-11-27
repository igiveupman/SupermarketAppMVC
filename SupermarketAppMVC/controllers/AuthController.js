// AuthController: handles login form, login submission, and logout
const db = require('../db');

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
      req.session.user = results[0];
      req.flash('success', 'Login successful!');
  // Admins: also check sold-out products and show a restock notice
  if (req.session.user.role === 'admin') {
        // Check sold out products to flash message
        db.query('SELECT productName FROM products WHERE quantity <= 0', (perr, soldOut) => {
          if (!perr && soldOut.length) {
            const names = soldOut.map(r => r.productName).join(', ');
            const msg = 'Sold out: ' + names + '. Please restock.';
            // Prevent duplicate sold-out message on same session cycle
            const existingErrors = req.flash('error') || [];
            if (!existingErrors.includes(msg)) {
              req.flash('error', msg);
            }
            // Re-add previously popped errors so they persist along with the new one
            existingErrors.filter(e => e !== msg).forEach(e => req.flash('error', e));
          }
          return res.redirect('/');
        });
      } else {
        return res.redirect('/');
      }
    });
  },
  // Destroy session and return to login page
  logout(req, res) {
    req.session.destroy(() => {
      res.redirect('/login');
    });
  }
};
