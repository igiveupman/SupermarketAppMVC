/**
 * Admin router
 * - Maps admin URLs to controller actions (dashboard, users, orders, products)
 */
const express = require('express');
const router = express.Router();

const AdminController = require('../controllers/AdminController');
const UserController = require('../controllers/UserController');
const ProductController = require('../controllers/ProductController');
const Order = require('../models/Order');

// Dashboard
router.get('/', AdminController.dashboard);

// User management (admin)
router.get('/users', UserController.list);
router.get('/users/:id', UserController.show);
router.get('/users/:id/edit', UserController.editForm);
router.post('/users/:id/edit', UserController.update);
router.post('/users/:id/delete', UserController.destroy);
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

// clear one user's orders
router.post('/users/:id/orders/clear', (req, res) => {
  const admin = req.session.user;
  if (!admin || admin.role !== 'admin') {
    req.flash('error', 'Unauthorized');
    return res.redirect('/');
  }
  const userId = req.params.id;
  Order.clearByUser(userId, (err, result) => {
    if (err) {
      req.flash('error', 'Failed to clear user order history');
    } else {
      req.flash('success', `Cleared ${result.affectedRows} orders for user #${userId}.`);
    }
    res.redirect('/admin/users');
  });
});

// View a user's order history (admin)
router.get('/users/:id/orders', AdminController.userOrders);

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
