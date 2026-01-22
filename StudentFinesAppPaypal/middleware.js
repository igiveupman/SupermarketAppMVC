
// Auth guard: checks authentication
const checkAuthenticated = (req, res, next) => {
  if (req.session && req.session.user) return next();
  req.flash('error', 'Please log in to view this resource');
  return res.redirect('/login');
};

// Auth guard: checks authorisation
const checkAuthorised = (roles = []) => {
  return (req, res, next) => {
    // Only check authorisation, assume authentication is already checked
    if (roles.length === 0 || roles.includes(req.session.user.role)) {
      return next();
    }
    req.flash('error', 'You do not have permission to view this resource');
    return res.redirect('/');
  };
};

module.exports = { checkAuthenticated, checkAuthorised };