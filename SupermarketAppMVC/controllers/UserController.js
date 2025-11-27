// UserController: admin user management (list, edit, update, delete)
const User = require('../models/User');

module.exports = {
  // Render admin users table
  list(req, res) {
    User.getAll((err, users) => {
      if (err) return res.status(500).send(err);
      res.render('adminUsers', { users, user: req.session.user, messages: req.flash('success') || [], errors: req.flash('error') || [] });
    });
  },

  // Show a single user in edit form
  show(req, res) {
    User.getById(req.params.id, (err, userRecord) => {
      if (err) return res.status(500).send(err);
      if (!userRecord) return res.status(404).send('Not found');
      res.render('updateUser', { editUser: userRecord, user: req.session.user, messages: req.flash('success') || [], errors: req.flash('error') || [] });
    });
  },

  // Public registration form
  registerForm(req, res) {
    res.render('register');
  },

  // Create new user (hashes password via SQL SHA1)
  register(req, res) {
    User.add(req.body, (err) => {
      if (err) return res.status(500).send(err);
      res.redirect('/login');
    });
  },

  // Admin: render edit form for a user
  editForm(req, res) {
    User.getById(req.params.id, (err, userRecord) => {
      if (err) return res.status(500).send(err);
      if (!userRecord) return res.status(404).send('Not found');
      res.render('updateUser', { editUser: userRecord, user: req.session.user, messages: req.flash('success') || [], errors: req.flash('error') || [] });
    });
  },

  // Admin: update user. Protect admin role from modification.
  update(req, res) {
    // Prevent updating admin user role or deleting admin account via edit form
    User.getById(req.params.id, (gErr, existing) => {
      if (gErr) { req.flash('error', 'Failed to load user'); return res.redirect('/admin/users'); }
      if (!existing) { req.flash('error', 'User not found'); return res.redirect('/admin/users'); }
      if (existing.role === 'admin') {
        req.flash('error', 'Admin account is protected and cannot be modified.');
        return res.redirect('/admin/users');
      }
      User.update(req.params.id, req.body, (err) => {
        if (err) { req.flash('error', 'Failed to update user'); return res.redirect('/admin/users'); }
        req.flash('success', 'User updated');
        res.redirect('/admin/users');
      });
    });
  },

  // Admin: delete user. Protect admin user from deletion.
  destroy(req, res) {
    const deletingOwn = parseInt(req.params.id, 10) === (req.session.user && req.session.user.id);
    User.getById(req.params.id, (gErr, existing) => {
      if (gErr) { req.flash('error', 'Failed to load user'); return res.redirect('/admin/users'); }
      if (!existing) { req.flash('error', 'User not found'); return res.redirect('/admin/users'); }
      if (existing.role === 'admin') {
        req.flash('error', 'Admin account is protected and cannot be deleted.');
        return res.redirect('/admin/users');
      }
      User.delete(req.params.id, (err) => {
        if (err) { req.flash('error', 'Failed to delete user'); return res.redirect('/admin/users'); }
        if (deletingOwn) {
          req.session.destroy(() => {
            req.flash('success', 'Your account was deleted');
          });
          return res.redirect('/');
        }
        req.flash('success', 'User deleted');
        res.redirect('/admin/users');
      });
    });
  }
};