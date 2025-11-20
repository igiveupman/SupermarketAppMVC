const express = require('express');
const router = express.Router();

const AdminController = require('../controllers/AdminController');
const UserController = require('../controllers/UserController');
const ProductController = require('../controllers/ProductController');

// Dashboard
router.get('/', AdminController.dashboard);

// User management (admin)
router.get('/users', UserController.list);
router.get('/users/:id', UserController.show);
router.post('/users/:id/role', (req, res) => {
  // simple role update handler
  const { role } = req.body;
  const id = req.params.id;
  const User = require('../models/User');
  User.update(id, { role }, (err) => {
    if (err) {
      req.flash('error', 'Failed to update role');
      return res.redirect('/admin/users');
    }
    req.flash('success', 'User role updated');
    res.redirect('/admin/users');
  });
});

// Product management routes reuse ProductController
router.get('/products', ProductController.index);
router.get('/products/add', ProductController.createForm);
router.post('/products/add', ProductController.store);
router.get('/products/:id', ProductController.show);
router.get('/products/:id/edit', ProductController.editForm);
router.post('/products/:id/edit', ProductController.update);
router.get('/products/:id/delete', ProductController.destroy);

// undo last checkout (admin)
router.post('/undo-last-checkout', AdminController.undoLastCheckout);

module.exports = router;
