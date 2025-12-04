// ReviewController: create/update and list product reviews
const Review = require('../models/Review');
const Product = require('../models/Product');

module.exports = {
  // Create or update a review (one per user/product)
  upsert(req, res) {
    const productId = parseInt(req.params.id, 10);
    if (!productId) {
      req.flash('error', 'Invalid product id.');
      return res.redirect('/shopping');
    }
    const rating = parseInt(req.body.rating, 10);
    const title = (req.body.title || '').trim();
    const comment = (req.body.comment || '').trim();
    if (Number.isNaN(rating) || rating < 1 || rating > 5) {
      req.flash('error', 'Rating must be between 1 and 5.');
      return res.redirect('/product/' + productId);
    }
    // Ensure product exists before writing review
    Product.getById(productId, (pErr, product) => {
      if (pErr || !product) {
        req.flash('error', 'Product not found.');
        return res.redirect('/shopping');
      }
      Review.addOrUpdate(req.session.user.id, productId, rating, title, comment, (rErr) => {
        if (rErr) {
          req.flash('error', 'Failed to save review.');
          return res.redirect('/product/' + productId);
        }
        req.flash('success', 'Review saved.');
        res.redirect('/product/' + productId);
      });
    });
  },

  // JSON list endpoint (optional for AJAX pagination)
  list(req, res) {
    const productId = parseInt(req.params.id, 10);
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const pageSize = Math.min(20, parseInt(req.query.pageSize || '5', 10));
    const offset = (page - 1) * pageSize;
    Review.listByProduct(productId, { limit: pageSize, offset }, (err, rows) => {
      if (err) return res.status(500).json({ success: false, error: 'Failed to load reviews' });
      res.json({ success: true, reviews: rows });
    });
  }
};
