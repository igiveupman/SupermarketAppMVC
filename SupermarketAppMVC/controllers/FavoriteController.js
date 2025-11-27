// FavoriteController: list favorites and toggle favorite state for a product
const Favorite = require('../models/Favorite');
const Product = require('../models/Product');

module.exports = {
  // Show current user's favorites
  index(req, res){
    Favorite.list(req.session.user.id, (err, favorites) => {
      if (err) return res.status(500).send('Failed to load favorites');
      res.render('favorites', { user: req.session.user, products: favorites, messages: req.flash('success'), errors: req.flash('error') });
    });
  },
  // Toggle favorite on/off; validates product and supports JSON response
  toggle(req, res){
    const rawId = req.params.id;
    const productId = parseInt(rawId, 10);
    if (Number.isNaN(productId) || productId <= 0) {
      req.flash('error', 'Invalid product id');
      return res.redirect('/shopping');
    }
    const userId = req.session.user.id;
    // ensure product exists
    Product.getById(productId, (perr, product) => {
      if (perr) {
        req.flash('error', 'Failed to load product');
        return res.redirect('/shopping');
      }
      if (!product) {
        req.flash('error', 'Product not found');
        return res.redirect('/shopping');
      }
    Favorite.isFavorited(userId, productId, (err, isFav) => {
      if (err) return res.status(500).send('Error');
      const cb = (err2) => {
        if (err2) {
          req.flash('error', 'Error updating favorite');
          const refFail = req.get('Referrer');
          return res.redirect(refFail || '/shopping');
        }
        // For API requests expecting JSON
        if (req.headers['accept'] && req.headers['accept'].includes('application/json')) {
          return res.json({ success:true, favorited: !isFav });
        }
  req.flash('success', !isFav ? 'Added to favorites.' : 'Removed from favorites.');
  const ref = req.get('Referrer');
  res.redirect(ref || '/shopping');
      };
      if (isFav) {
        Favorite.remove(userId, productId, cb);
      } else {
        Favorite.add(userId, productId, cb);
      }
    });
    });
  }
};
