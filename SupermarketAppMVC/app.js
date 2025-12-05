// Core Express application setup
// Load environment variables early; explicit path for reliability
const path = require('path');
const envPath = path.join(__dirname, '.env');
require('dotenv').config({ path: envPath }); // Load environment variables early
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
// Multer handles file uploads (used by admin to upload product images)
const multer = require('multer');
const app = express();
// path already required above

// Configure Multer to store uploaded images in /public/images
// Set up multer for file uploads (use absolute path so root launcher works)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, 'public', 'images')); // Directory to save uploaded files
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});

const upload = multer({ storage: storage });
// Import centralized middleware
const { checkAuthenticated, checkAdmin, validateRegistration } = require('./middleware');

// Central DB connection (single source of truth)
// DB password presence check removed (was for debugging)
const connection = require('./db');
// Ensure required columns exist (runs once at startup)
connection.query('ALTER TABLE products ADD COLUMN featured TINYINT(1) NOT NULL DEFAULT 0', (cErr) => {
    if (cErr && cErr.code !== 'ER_DUP_FIELDNAME') {
        console.error('Failed to ensure featured column:', cErr.code);
    }
});
connection.query('ALTER TABLE products ADD COLUMN discount_price DECIMAL(10,2) NULL', (dErr) => {
    if (dErr && dErr.code !== 'ER_DUP_FIELDNAME') {
        console.error('Failed to ensure discount_price column:', dErr.code);
    }
});
// Ensure cart_items table exists for persistent carts
connection.query(
    'CREATE TABLE IF NOT EXISTS cart_items (' +
    'id INT AUTO_INCREMENT PRIMARY KEY,' +
    'user_id INT NOT NULL,' +
    'product_id INT NOT NULL,' +
    'quantity INT NOT NULL DEFAULT 0,' +
    'updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,' +
    'UNIQUE KEY uq_user_product (user_id, product_id)' +
    ')',
    (cErr) => {
        if (cErr) {
            console.error('Failed to ensure cart_items table:', cErr.code || cErr);
        }
    }
);
// Ensure product_reviews table exists (ratings)
connection.query(
    'CREATE TABLE IF NOT EXISTS product_reviews (' +
    'id INT AUTO_INCREMENT PRIMARY KEY,' +
    'product_id INT NOT NULL,' +
    'user_id INT NOT NULL,' +
    'rating TINYINT NOT NULL CHECK (rating BETWEEN 1 AND 5),' +
    'title VARCHAR(100) NULL,' +
    'comment TEXT,' +
    'created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,' +
    'UNIQUE KEY uq_user_product (user_id, product_id),' +
    'FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,' +
    'FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE' +
    ')',
    (rErr) => {
        if (rErr) {
            console.error('Failed to ensure product_reviews table:', rErr.code || rErr);
        }
    }
);

// View engine: EJS templates in /views
// Set up view engine
app.set('view engine', 'ejs');
// ensure views directory is explicit so Express looks in this project views folder
app.set('views', path.join(__dirname, 'views'));
// Static files: CSS/JS/images served from /public
//  enable static files (absolute path ensures correct when required from parent)
app.use(express.static(path.join(__dirname, 'public')));
// Parse URL-encoded form data (e.g., login forms)
// enable form processing
app.use(express.urlencoded({
    extended: false
}));
// Parse JSON bodies for API endpoints (used by AJAX routes)
// parse JSON bodies for API endpoints
app.use(express.json());

// Session middleware: stores user + cart data in server-side session
//TO DO: Insert code for Session Middleware below 
const isProd = process.env.NODE_ENV === 'production';
app.use(session({
    secret: process.env.SESSION_SECRET || 'secret',
    resave: false,
    saveUninitialized: false,
    // Session expires after 1 week of inactivity
    cookie: { 
        maxAge: 1000 * 60 * 60 * 24 * 7,
        httpOnly: true,
        sameSite: 'lax',
        secure: isProd
    } 
}));

// Flash messages: short-lived success/error notifications between redirects
app.use(flash());

// Global cart count middleware for header badge
app.use((req, res, next) => {
    const cart = req.session.cart || [];
    res.locals.cart = cart;
    res.locals.cartCount = cart.reduce((sum,i)=> sum + i.quantity, 0);
    next();
});


// Controllers & routers
// Define routes
const ProductController = require('./controllers/ProductController');
const ProductModel = require('./models/Product');
const CartController = require('./controllers/CartController');
const FavoriteController = require('./controllers/FavoriteController');
const Favorite = require('./models/Favorite');
const UserController = require('./controllers/UserController');
const adminRouter = require('./routes/adminRouter');
const OrderController = require('./controllers/OrderController');
const ReviewController = require('./controllers/ReviewController');
// Lazy-load puppeteer for PDF generation
let puppeteer;
const AuthController = require('./controllers/AuthController');
// Simple in-memory rate limiter for login
const loginAttempts = new Map();
function loginRateLimit(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const windowMs = 15 * 60 * 1000;
    const maxAttempts = 10;
    const entry = loginAttempts.get(ip) || { count: 0, ts: now };
    if (now - entry.ts > windowMs) {
        entry.count = 0;
        entry.ts = now;
    }
    entry.count += 1;
    loginAttempts.set(ip, entry);
    if (entry.count > maxAttempts) {
        return res.status(429).send('Too many login attempts. Please try again later.');
    }
    next();
}

// Home page: shows landing or quick links; passes session user + flash messages
app.get('/',  (req, res) => {
    res.render('index', { user: req.session.user, messages: req.flash('success') || [], errors: req.flash('error') || [] });
});

// Admin inventory dashboard (products CRUD)
app.get('/inventory', checkAuthenticated, checkAdmin, ProductController.index);

app.get('/register', (req, res) => {
    res.render('register', {
        user: req.session.user || null,
        messages: req.flash('success') || [],
        errors: req.flash('error') || [],
        formData: req.flash('formData')[0]
    });
});

app.post('/register', validateRegistration, (req, res) => {
    const { username, email, password, address, contact } = req.body;
    const role = 'user';
    const sql = 'INSERT INTO users (username, email, password, address, contact, role) VALUES (?, ?, SHA1(?), ?, ?, ?)';
    connection.query(sql, [username, email, password, address, contact, role], (err, result) => {
        if (err) {
            throw err;
        }
        console.log(result);
        req.flash('success', 'Registration successful! Please log in.');
        res.redirect('/login');
    });
});

// Auth routes: login form, login submit, logout
app.get('/login', AuthController.loginForm);
app.post('/login', loginRateLimit, AuthController.login);
app.get('/logout', AuthController.logout);
// Shopping: product listing with filters/pagination
app.get('/shopping', checkAuthenticated, ProductController.index);

// Traditional post (form submit) to add to cart, then redirect
app.post('/add-to-cart/:id', checkAuthenticated, CartController.addToCart);
// AJAX endpoint: add to cart and return JSON (used by public/js/cartAjax.js)
// JSON API endpoint for adding to cart without page reload
app.post('/api/cart/add/:id', checkAuthenticated, CartController.apiAddToCart);

// Cart pages: view, remove item, checkout, and API checkout
app.get('/cart', checkAuthenticated, CartController.viewCart);
app.get('/cart/remove/:id', checkAuthenticated, CartController.removeFromCart);
app.post('/cart/update/:id', checkAuthenticated, CartController.updateQuantity);
// Convenience: allow GET navigation to clear cart (same auth guard)
app.get('/cart/clear', checkAuthenticated, CartController.clearCart);
app.post('/cart/clear', checkAuthenticated, CartController.clearCart);
app.post('/cart/checkout', checkAuthenticated, CartController.checkout);
// API checkout (JSON response)
app.post('/api/cart/checkout', checkAuthenticated, CartController.apiCheckout);
// New purchase flow
app.get('/purchase', checkAuthenticated, CartController.paymentForm);
app.post('/purchase', checkAuthenticated, CartController.paymentProcess);
// Orders history page and JSON API
app.get('/orders', checkAuthenticated, OrderController.index);
// Printable invoice per order
app.get('/orders/:id/invoice', checkAuthenticated, OrderController.invoice);
// Invoice PDF export
app.get('/orders/:id/invoice.pdf', checkAuthenticated, async (req, res) => {
    try {
        const orderId = parseInt(req.params.id, 10);
        if (!orderId) return res.status(400).send('Invalid order id');
        // Ensure invoice page is reachable, then render to PDF via headless browser
        const baseUrl = req.protocol + '://' + req.get('host');
        const url = baseUrl + '/orders/' + orderId + '/invoice';
        if (!puppeteer) puppeteer = require('puppeteer');
        const browser = await puppeteer.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'networkidle0' });
        const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' } });
        await browser.close();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="invoice-' + orderId + '.pdf"');
        return res.send(pdfBuffer);
    } catch (e) {
        console.error('Invoice PDF generation failed:', e);
        return res.status(500).send('Failed to generate PDF');
    }
});
app.get('/api/orders', checkAuthenticated, (req, res) => {
    const Order = require('./models/Order');
    Order.listByUser(req.session.user.id, (err, orders) => {
        if (err) return res.status(500).json({ error: 'Failed to load orders' });
        res.json({ orders });
    });
});

// Favourites
Favorite.tableInit();
app.get('/favorites', checkAuthenticated, FavoriteController.index);
app.get('/favorites/toggle/:id', checkAuthenticated, FavoriteController.toggle);

// Reviews (per product)
app.post('/product/:id/review', checkAuthenticated, ReviewController.upsert);
app.get('/product/:id/reviews', checkAuthenticated, ReviewController.list);


// mount admin router at /admin
app.use('/admin', checkAuthenticated, checkAdmin, adminRouter);

app.get('/product/:id', checkAuthenticated, ProductController.show);

app.get('/addProduct', checkAuthenticated, checkAdmin, ProductController.createForm);
app.post('/addProduct', checkAuthenticated, checkAdmin, upload.single('image'), ProductController.store);

app.get('/updateProduct/:id', checkAuthenticated, checkAdmin, ProductController.editForm);
app.post('/updateProduct/:id', checkAuthenticated, checkAdmin, upload.single('image'), ProductController.update);

app.get('/deleteProduct/:id', checkAuthenticated, checkAdmin, ProductController.destroy);

// Feature toggle (admin)
app.post('/product/:id/feature', checkAuthenticated, checkAdmin, (req, res) => {
    console.log('Feature route hit for id', req.params.id);
    ProductModel.getById(req.params.id, (gErr, product) => {
        const name = (!gErr && product && product.productName) ? product.productName : `Product #${req.params.id}`;
        ProductModel.updateFeatured(req.params.id, true, (err) => {
            if (err) {
                console.error('Failed to feature product', err);
                req.flash('error', `Couldn't feature ${name}`);
            } else {
                req.flash('success', `Featured: ${name}`);
            }
            return res.redirect('/inventory');
        });
    });
});
app.post('/product/:id/unfeature', checkAuthenticated, checkAdmin, (req, res) => {
    console.log('Unfeature route hit for id', req.params.id);
    ProductModel.getById(req.params.id, (gErr, product) => {
        const name = (!gErr && product && product.productName) ? product.productName : `Product #${req.params.id}`;
        ProductModel.updateFeatured(req.params.id, false, (err) => {
            if (err) {
                console.error('Failed to unfeature product', err);
                req.flash('error', `Couldn't remove from trending: ${name}`);
            } else {
                req.flash('success', `Removed from trending: ${name}`);
            }
            return res.redirect('/inventory');
        });
    });
});

// Debug route to list all registered routes (dev only)
app.get('/debug/routes', (req, res) => {
    try {
        const routes = [];
        const stack = app && app._router && Array.isArray(app._router.stack) ? app._router.stack : [];
        stack.forEach(mw => {
            const route = mw && mw.route;
            if (route && route.path) {
                const methods = route.methods ? Object.keys(route.methods).join(',').toUpperCase() : 'GET';
                routes.push(methods + ' ' + route.path);
                return;
            }
            const isRouter = mw && mw.name === 'router' && mw.handle && Array.isArray(mw.handle.stack);
            if (isRouter) {
                mw.handle.stack.forEach(r => {
                    const rRoute = r && r.route;
                    if (rRoute && rRoute.path) {
                        const m = rRoute.methods ? Object.keys(rRoute.methods).join(',').toUpperCase() : 'GET';
                        routes.push(m + ' ' + rRoute.path);
                    }
                });
            }
        });
        res.json({ routes });
    } catch (e) {
        res.status(500).json({ error: 'Failed to list routes', detail: String(e) });
    }
});

const PORT = process.env.PORT || 3000;
// Start server only when this file is executed directly (not when required by root app.js)
if (require.main === module) {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;

