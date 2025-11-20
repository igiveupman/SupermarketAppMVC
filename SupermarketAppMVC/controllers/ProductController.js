const Product = require('../models/Product');

module.exports = {
  index(req, res) {
    // For shopping page, support search and category filter
    const search = req.query.search || '';
    let category = req.query.category || '';
    // Map UI label to DB category value if needed
    if (category === 'Fruits and Vegetables') {
      category = 'Produce';
    }
    Product.getAllFiltered({ search, category }, (err, products) => {
      if (err) return res.status(500).send(err);
      // Render shopping.ejs if user is not admin, else inventory.ejs
      if (req.session.user && req.session.user.role === 'admin') {
        res.render('inventory', { products, user: req.session.user, messages: req.flash('success'), errors: req.flash('error') });
      } else {
        res.render('shopping', { products, user: req.session.user, search, category });
      }
    });
  },

  show(req, res) {
    Product.getById(req.params.id, (err, product) => {
      if (err) return res.status(500).send(err);
      if (!product) return res.status(404).send('Not found');
      res.render('product', { product, user: req.session.user });
    });
  },

  createForm(req, res) {
    res.render('addProduct', { user: req.session.user, messages: req.flash('success'), errors: req.flash('error') });
  },

  // expects multer to have populated req.file if an image was uploaded
  store(req, res) {
    // Normalize and validate inputs
    const product = {
      productName: (req.body.name || req.body.productName || '').trim(),
      price: parseFloat(req.body.price) || 0,
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

  editForm(req, res) {
    Product.getById(req.params.id, (err, product) => {
      if (err) return res.status(500).send(err);
      if (!product) return res.status(404).send('Not found');
  res.render('updateProduct', { product, user: req.session.user, messages: req.flash('success'), errors: req.flash('error') });
    });
  },

  // expects multer to populate req.file if a new image was uploaded
  update(req, res) {
    const product = {
      productName: req.body.name || req.body.productName,
      price: parseFloat(req.body.price) || 0,
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

  destroy(req, res) {
    Product.delete(req.params.id, (err) => {
      if (err) return res.status(500).send(err);
      res.redirect('/inventory');
    });
  }
};