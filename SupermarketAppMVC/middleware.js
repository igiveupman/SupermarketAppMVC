// Centralized middleware definitions
// Authentication / authorization / validation helpers

module.exports.checkAuthenticated = (req, res, next) => {
  if (req.session.user) return next();
  req.flash('error', 'Please log in to view this resource');
  return res.redirect('/login');
};

module.exports.checkAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'admin') return next();
  req.flash('error', 'Access denied');
  return res.redirect('/shopping');
};

module.exports.validateRegistration = (req, res, next) => {
  const { username, email, password, address, contact } = req.body;
  if (!username || !email || !password || !address || !contact) {
    return res.status(400).send('All fields are required.');
  }
  if (password.length < 6) {
    req.flash('error', 'Password should be at least 6 or more characters long');
    req.flash('formData', req.body);
    return res.redirect('/register');
  }
  next();
};
