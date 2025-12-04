/**
 * ProductController
 * - Lists products for shopping with filters, favorites and pagination
 * - Admin CRUD: create, update, delete products
 */
const Product = require('../models/Product');
const Favorite = require('../models/Favorite');
const Review = require('../models/Review');

module.exports = {
  index(req, res) {
  // Shared filters (shopping + admin inventory)
  const search = req.query.search || req.query.q || '';
  let category = req.query.category || '';
  const trendingRaw = (req.query.trending || '').toString().trim().toLowerCase();
  const trendingMode = ['1','true','on','yes'].includes(trendingRaw);
  const featuredOnly = ['1','true','on','yes'].includes((req.query.featured || '').toString().toLowerCase());
    // Map UI label to DB category value if needed
    if (['Fruits and Vegetables','Fruits & Vegs','Fruits & Vegetables'].includes(category)) {
      category = 'Produce';
    }
    // 'Meats' passes through directly; no mapping needed
  const sortBy = req.query.sortBy || 'id';
  const sortDir = req.query.sortDir || 'desc';
  const pageSize = 10;
  let page = parseInt(req.query.page || '1', 10);
  if (isNaN(page) || page < 1) page = 1;

  const commonFilters = { search, category, featured: featuredOnly };
  Product.countFiltered(commonFilters, (countErr, totalCount) => {
    if (countErr) return res.status(500).send(countErr);
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    if (page > totalPages) page = totalPages;
    const offset = (page - 1) * pageSize;
    Product.listFilteredPaged({ ...commonFilters, limit: pageSize, offset, sortBy, sortDir }, (err, products) => {
      if (err) return res.status(500).send(err);
      const applyRatings = (prods, trendingProducts, cb) => {
        const ids = Array.from(new Set([...prods, ...trendingProducts].map(p => p.id))).filter(Boolean);
        if (!ids.length) return cb(null, prods, trendingProducts);
        Review.getStatsForProducts(ids, (rErr, statsMap) => {
          if (rErr) return cb(rErr);
          const addStats = (arr) => arr.map(p => {
            const stats = statsMap[p.id] || { reviewCount: 0, averageRating: null };
            return { ...p, reviewCount: stats.reviewCount, averageRating: stats.averageRating };
          });
          cb(null, addStats(prods), addStats(trendingProducts));
        });
      };

      const renderWithFavorites = (prods, trendingProducts) => {
        if (req.session.user) {
          Favorite.list(req.session.user.id, (favErr, favs) => {
            if (favErr) return res.status(500).send(favErr);
            const favIds = new Set(favs.map(f => f.id || f.product_id));
            prods = prods.map(p => ({ ...p, favorited: favIds.has(p.id) }));
            trendingProducts = trendingProducts.map(p => ({ ...p, favorited: favIds.has(p.id) }));
            return finishRender(prods, trendingProducts);
          });
        } else {
          finishRender(prods, trendingProducts);
        }
      };

      const finishRender = (prods, trendingProducts) => {
        if (req.session.user && req.session.user.role === 'admin') {
          Product.getSoldOut((soErr, soldOut) => {
            let errors = req.flash('error') || [];
            if (!soErr && soldOut.length) {
              const names = soldOut.map(p => p.productName).join(', ');
              const msg = 'Sold out: ' + names + '. Please restock.';
              if (!errors.includes(msg)) errors.push(msg);
            }
            const featuredCount = prods.filter(p => p.featured).length;
            return res.render('inventory', { products: prods, featuredCount, user: req.session.user, messages: req.flash('success') || [], errors, search, category, featuredOnly });
          });
          return;
        }

        return res.render('shopping', {
          products: prods,
          trendingProducts: trendingMode ? [] : trendingProducts,
          user: req.session.user,
          currentPage: 'shopping',
          page,
          totalPages,
          search,
          category,
          trendingMode,
          messages: req.flash('success') || [],
          errors: req.flash('error') || []
        });
      };

      // Fetch featured subset for trending section (respect filters)
      if (trendingMode) {
        // main list already featured-only via featuredOnly flag when toggled
        applyRatings(products, [], (rErr, ratedProds, ratedTrending) => {
          if (rErr) return res.status(500).send(rErr);
          renderWithFavorites(ratedProds, ratedTrending);
        });
      } else {
        Product.getFeatured({ search, category, limit: 6 }, (featErr, featuredRows) => {
          if (featErr) return res.status(500).send(featErr);
          applyRatings(products, featuredRows || [], (rErr, ratedProds, ratedTrending) => {
            if (rErr) return res.status(500).send(rErr);
            renderWithFavorites(ratedProds, ratedTrending);
          });
        });
      }
    });
  });
},

  // Product details page
  show(req, res) {
    // Fetch a single product, its favorites state, and reviews
    const reviewPage = Math.max(1, parseInt(req.query.reviewPage || '1', 10));
    const reviewPageSize = 5;
    Product.getById(req.params.id, (err, product) => {
      if (err) return res.status(500).send(err);
      if (!product) return res.status(404).send('Not found');

      const loadReviewData = (cb) => {
        const offset = (reviewPage - 1) * reviewPageSize;
        Review.listByProduct(product.id, { limit: reviewPageSize, offset }, (rErr, reviews) => {
          if (rErr) return cb(rErr);
          Review.getStats(product.id, (sErr, stats) => {
            if (sErr) return cb(sErr);
            if (req.session.user) {
              Review.getUserReview(req.session.user.id, product.id, (uErr, userReview) => {
                if (uErr) return cb(uErr);
                cb(null, { reviews, stats, userReview });
              });
            } else {
              cb(null, { reviews, stats, userReview: null });
            }
          });
        });
      };

      const renderProduct = (favorited) => {
        product.favorited = favorited;
        loadReviewData((revErr, reviewData) => {
          if (revErr) return res.status(500).send(revErr);
          const messages = req.flash('success') || [];
          const errors = req.flash('error') || [];
          return res.render('product', {
            product,
            user: req.session.user || null,
            messages,
            errors,
            reviews: reviewData.reviews || [],
            reviewStats: reviewData.stats || { reviewCount: 0, averageRating: null },
            userReview: reviewData.userReview,
            reviewPage,
            reviewPageSize
          });
        });
      };

      if (req.session.user) {
        Favorite.list(req.session.user.id, (favErr, favs) => {
          if (favErr) return res.status(500).send(favErr);
          const favIds = new Set(favs.map(f => f.id || f.product_id));
          return renderProduct(favIds.has(product.id));
        });
      } else {
        return renderProduct(false);
      }
    });
  },

  // Admin: render create product form
  createForm(req, res) {
    // Simple form render; validation handled in store()
    res.render('addProduct', { user: req.session.user, messages: req.flash('success'), errors: req.flash('error') });
  },

  // expects multer to have populated req.file if an image was uploaded
  // Admin: save new product (image comes from Multer in req.file)
  store(req, res) {
    // Normalize and validate inputs
    // Calculate discount from percentage if provided; keep legacy discount_price for compatibility
    const priceNum = parseFloat(req.body.price) || 0;
    let discountPrice = null;
    if (req.body.discount_percent !== undefined && req.body.discount_percent !== '') {
      const pct = Math.max(0, Math.min(100, parseFloat(req.body.discount_percent)));
      discountPrice = Number((priceNum * (1 - pct / 100)).toFixed(2));
    } else if (req.body.discount_price) {
      discountPrice = parseFloat(req.body.discount_price);
    }

    const product = {
      productName: (req.body.name || req.body.productName || '').trim(),
      price: priceNum,
      discount_price: isNaN(discountPrice) ? null : discountPrice,
      quantity: parseInt(req.body.quantity, 10) || 0,
      image: req.file ? req.file.filename : (req.body.currentImage || null),
      category: req.body.category || null
    };

    console.log('ProductController.store - incoming product:', product, 'file:', !!req.file);

    Product.add(product, (err, result) => {
      if (err) {
        console.error('ProductController.store - error adding product:', err);
        // show a friendly message and redirect back to form
        req.flash('error', 'Failed to add product.');
        return res.redirect('/addProduct');
      }
      req.flash('success', 'Product added successfully.');
      res.redirect('/inventory');
    });
  },

  // Admin: render edit form populated with product
  editForm(req, res) {
    // Load product then pass to template for editing
    Product.getById(req.params.id, (err, product) => {
      if (err) return res.status(500).send(err);
      if (!product) return res.status(404).send('Not found');
  res.render('updateProduct', { product, user: req.session.user, messages: req.flash('success'), errors: req.flash('error') });
    });
  },

  // expects multer to populate req.file if a new image was uploaded
  // Admin: update product details (handles optional new image)
  update(req, res) {
    // Construct update payload from form fields
    const updPriceNum = parseFloat(req.body.price) || 0;
    let updDiscountPrice = null;
    if (req.body.discount_percent !== undefined && req.body.discount_percent !== '') {
      const pct = Math.max(0, Math.min(100, parseFloat(req.body.discount_percent)));
      updDiscountPrice = Number((updPriceNum * (1 - pct / 100)).toFixed(2));
    } else if (req.body.discount_price) {
      updDiscountPrice = parseFloat(req.body.discount_price);
    }

    const product = {
      productName: req.body.name || req.body.productName,
      price: updPriceNum,
      discount_price: isNaN(updDiscountPrice) ? null : updDiscountPrice,
      quantity: parseInt(req.body.quantity, 10) || 0,
      image: req.file ? req.file.filename : (req.body.currentImage || null),
      category: req.body.category || null
    };

    console.log('ProductController.update - id:', req.params.id, 'product:', product);
    Product.update(req.params.id, product, (err, result) => {
      if (err) {
        console.error('ProductController.update - error updating product:', err);
        req.flash('error', 'Failed to update product.');
        return res.redirect('/updateProduct/' + req.params.id);
      }
      req.flash('success', 'Product updated successfully.');
      res.redirect('/inventory');
    });
  },

  // Admin: delete product by id
  destroy(req, res) {
    // Business rule: prevent deletion and inform the admin
    const id = req.params.id;
    Product.getById(id, (gErr, product) => {
      const name = (!gErr && product && product.productName) ? product.productName : `Product #${id}`;
      req.flash('error', `Product cannot be deleted as it is important. (${name})`);
      return res.redirect('/inventory');
    });
  }
};
