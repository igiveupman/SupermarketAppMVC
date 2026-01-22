const express = require('express');
const path = require('path');
const session = require('express-session'); 
const flash = require('connect-flash'); 
const UserController = require('./controllers/UserController');
const FinesController = require('./controllers/FinesController');
const CartItemsController = require('./controllers/CartItemsController');
const { checkAuthenticated, checkAuthorised } = require('./middleware');
const paypal = require('./services/paypal');
const Fine = require('./models/Fine'); // Make sure this is required

const app = express();

// views & body parsing
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: false }));
app.use(express.json()); // <-- ensure this is present
app.use(express.static(path.join(__dirname, 'public')));

// session + flash
app.use(session({
  secret: process.env.SESSION_SECRET || 'secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 day
}));

app.use(flash());

// expose session and flash messages to views
app.use((req, res, next) => {
  res.locals.session = req.session;
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  next();
});

// homepage
app.get('/', (req,res)=>{ res.render('index', {user: req.session.user})});

// add auth routes and fines (protected)
app.get('/login', UserController.loginForm);
app.post('/login', UserController.login);
app.get('/logout', checkAuthenticated, UserController.logout);

// Fines routes
app.get('/fines', checkAuthenticated, FinesController.list);
app.get('/fines/:id', checkAuthenticated,FinesController.getDetails);
app.post('/fines/pay', checkAuthenticated,FinesController.pay);
app.get('/admin/fine-user', checkAuthenticated, checkAuthorised(['admin']), FinesController.showFineUserForm);
app.post('/admin/fine-user', checkAuthenticated, checkAuthorised(['admin']), FinesController.fineUser);

// Cart routes
app.get('/cart', checkAuthenticated, CartItemsController.list);
app.post('/cart/add', checkAuthenticated, CartItemsController.add);
app.post('/cart/remove', checkAuthenticated, CartItemsController.remove);
app.post('/cart/clear', checkAuthenticated,CartItemsController.clear);

app.get('/admin/dashboard', checkAuthenticated, checkAuthorised(['admin']), FinesController.adminDashboard);

// PayPal: Create Order
app.post('/api/paypal/create-order', async (req, res) => {
  try {
    const { amount } = req.body;
    const order = await paypal.createOrder(amount);
    if (order && order.id) {
      res.json({ id: order.id });
    } else {
      res.status(500).json({ error: 'Failed to create PayPal order', details: order });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to create PayPal order', message: err.message });
  }
});

// PayPal: Capture Order
app.post('/api/paypal/capture-order', async (req, res) => {
  try {
    const { orderID } = req.body;
    const capture = await paypal.captureOrder(orderID);
console.log('PayPal captureOrder response:', capture);

    if (capture.status === "COMPLETED") {
      // Call your pay method, passing transaction details and user info
      await FinesController.pay(req, res, capture);
    } else {
      res.status(400).json({ error: 'Payment not completed', details: capture });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to capture PayPal order', message: err.message });
  }
});

// Invoice route
app.get('/invoice', checkAuthenticated, async (req, res) => {
  let fineIds = req.query.fines;
  if (typeof fineIds === 'string') {
    fineIds = fineIds.split(',').map(id => Number(id));
  }
  let fines = [];
  if (Array.isArray(fineIds) && fineIds.length) {
    fines = await Fine.getByIdsWithType(fineIds);
  }
  res.render('invoice', { user: req.session.user, fines });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

