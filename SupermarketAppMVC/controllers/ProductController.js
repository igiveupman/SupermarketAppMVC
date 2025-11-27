/**
 * ProductController
 * - Lists products for shopping with filters, favorites and pagination
 * - Admin CRUD: create, update, delete products
 */
const Product = require('../models/Product');
const Favorite = require('../models/Favorite');

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
  // Fetch products from DB based on filters
  Product.getAllFiltered({ search, category, featured: featuredOnly }, (err, products) => {
      if (err) return res.status(500).send(err);
      // If user logged in, fetch favorites to mark hearts
      if (req.session.user) {
        Favorite.list(req.session.user.id, (favErr, favs) => {
          if (favErr) return res.status(500).send(favErr);
          // Favorite.list selects product columns aliased as p.id etc. Ensure we reference the product id correctly.
          // Build a lookup of favorited product IDs for quick marking in view
          const favIds = new Set(favs.map(f => f.id || f.product_id));
          products = products.map(p => ({ ...p, favorited: favIds.has(p.id) }));
      // Admin inventory: compute sold-out notice then render inventory view
      if (req.session.user.role === 'admin') {
            // gather sold-out products to notify admin
            // Admin: compute sold-out notice and render inventory view
            Product.getSoldOut((soErr, soldOut) => {
              let errors = req.flash('error') || [];
              if (!soErr && soldOut.length) {
                const names = soldOut.map(p => p.productName).join(', ');
                const msg = 'Sold out: ' + names + '. Please restock.';
                // Only add if not already present
                if (!errors.includes(msg)) {
                  errors.push(msg);
                }
              }
              const featuredCount = products.filter(p => p.featured).length;
        return res.render('inventory', { products, featuredCount, user: req.session.user, messages: req.flash('success') || [], errors, search, category, featuredOnly });
            });
            return; // prevent further rendering
          }
          // Featured products subset used for trending module (avoid shadowing outer featuredOnly flag)
          const featuredProducts = products.filter(p => p.featured);
          // If trending mode active: show only featured in main list; hide separate trending section
          const trendingProducts = trendingMode ? [] : featuredProducts;
          if (trendingMode) {
            products = featuredProducts;
          }
          // Pagination
          // Simple in-memory pagination after filtering
          const pageSize = 10;
          let page = parseInt(req.query.page || '1', 10);
          const totalPages = Math.max(1, Math.ceil(products.length / pageSize));
          if (page < 1) page = 1; if (page > totalPages) page = totalPages;
          const start = (page - 1) * pageSize;
          const pagedProducts = products.slice(start, start + pageSize);
          return res.render('shopping', { products: pagedProducts, trendingProducts, user: req.session.user, currentPage: 'shopping', page, totalPages, search, category, trendingMode, messages: req.flash('success') || [], errors: req.flash('error') || [] });
        });
      } else {
        // Not logged in (though route protected) fallback
        const pageSize = 10;
        let page = parseInt(req.query.page || '1', 10);
        const totalPages = Math.max(1, Math.ceil(products.length / pageSize));
        if (page < 1) page = 1; if (page > totalPages) page = totalPages;
        const start = (page - 1) * pageSize;
        const pagedProducts = products.slice(start, start + pageSize);
  return res.render('shopping', { products: pagedProducts, trendingProducts: [], user: null, currentPage: 'shopping', page, totalPages, search, category, trendingMode, messages: req.flash('success') || [], errors: req.flash('error') || [] });
      }
    });
  },

  // Product details page
  show(req, res) {
    // Fetch a single product and optionally mark favorited state for logged-in users
    Product.getById(req.params.id, (err, product) => {
      if (err) return res.status(500).send(err);
      if (!product) return res.status(404).send('Not found');
      // If user logged in, fetch favorites to mark heart state
      if (req.session.user) {
        Favorite.list(req.session.user.id, (favErr, favs) => {
          if (favErr) return res.status(500).send(favErr);
          const favIds = new Set(favs.map(f => f.id || f.product_id));
          product.favorited = favIds.has(product.id);
          return res.render('product', { product, user: req.session.user, messages: req.flash('success') || [], errors: req.flash('error') || [] });
        });
      } else {
        return res.render('product', { product, user: null, messages: [], errors: [] });
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
    const product = {
      productName: (req.body.name || req.body.productName || '').trim(),
      price: parseFloat(req.body.price) || 0,
      discount_price: req.body.discount_price ? parseFloat(req.body.discount_price) : null,
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
    const product = {
      productName: req.body.name || req.body.productName,
      price: parseFloat(req.body.price) || 0,
      discount_price: req.body.discount_price ? parseFloat(req.body.discount_price) : null,
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
    // Hard delete; consider soft delete in future if audit trail needed
    Product.delete(req.params.id, (err) => {
      if (err) return res.status(500).send(err);
      res.redirect('/inventory');
    });
  }
};