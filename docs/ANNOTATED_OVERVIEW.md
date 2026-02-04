# SupermarketAppMVC – Annotated Overview

This document is a guided tour of the codebase with commentary on purpose, data flow, and key files. It does not change runtime behavior.

## Top-level
- `SupermarketAppMVC/app.js` (root entry): Starts the Express server, configures middleware, and mounts the internal MVC routes, views, and assets.
- `SupermarketAppMVC/` – Actual application code.

## Folder layout
- `controllers/` – Request handlers. Keep logic thin; call models and render views.
- `models/` – Database access (MySQL). Each model encapsulates queries for an entity.
- `views/` – EJS templates for pages.
- `public/` – Static assets (css, js, images).
- `routes/` – Express routers mapping URLs → controllers.
- `db.js` – MySQL connection pool helper.
- `middleware.js` – App middlewares (sessions, logging, etc.).

## Data flow (example: Shopping page)
1) Request to GET `/shopping` hits ProductController.index
2) Controller reads query params (search, category, featured, page)
3) Controller fetches products via `Product.getAllFiltered`
4) If logged in, controller fetches favorites to mark items
5) Applies pagination in-memory (pageSize=10) and renders `views/shopping.ejs`

## Payment flow
- `CartController` opens with a “Payment Flow Overview” comment that states the shared pattern: method selection on `/purchase`, an optional external capture phase, and finally `checkout()` to create the order and clear the cart. (`SupermarketAppMVC/controllers/CartController.js:1`)
- `paymentProcess()` validates the selected method and delivery information, saves the address/contact data, records the chosen provider, and either dispatches to the NETS QR generator or falls through to `checkout()` for simulated flows. (`SupermarketAppMVC/controllers/CartController.js:515`, `SupermarketAppMVC/controllers/CartController.js:545`)
- Stripe-based routes delegate to `StripeController.createOrderIntent`/`createOrderPayNowIntent`, which snapshot the cart/voucher totals, persist the checkout metadata in the session and call the helper that validates `STRIPE_SECRET_KEY`, converts the amount to minor units, and creates a PaymentIntent/PayNow intent. (`SupermarketAppMVC/controllers/StripeController.js:15`, `SupermarketAppMVC/controllers/StripeController.js:50`, `SupermarketAppMVC/services/stripe.js:5`, `SupermarketAppMVC/services/stripe.js:13`, `SupermarketAppMVC/services/stripe.js:19`, `SupermarketAppMVC/services/stripe.js:41`)
- `StripeController.completeOrder` then retrieves the intent, ensures its status/amount match the recomputed cart total, stamps the session with payment metadata, and invokes `CartController.checkout()`. (`SupermarketAppMVC/controllers/StripeController.js:104`, `SupermarketAppMVC/controllers/StripeController.js:141`)
- NETS QR flows call `netsQr.generateQrCode`, which recomputes the cart total, requires `NETS_API_KEY`/`NETS_PROJECT_ID`, stores the transaction reference in the session, and renders the QR page that eventually returns to `CartController.checkout()`. (`SupermarketAppMVC/services/nets.js:55`, `SupermarketAppMVC/services/nets.js:68`)
- PayPal uses `app.js` routes for `/api/paypal/create-order`, `/api/paypal/capture-order`, and `/paypal/complete`: the routes snapshot the cart/voucher, generate an order via `services/paypal`, capture it when the SDK posts the order ID, save delivery/payment metadata (including `payment_flow='paypal'`), and finally call `CartController.checkout()` once `req.session.paypal_captured` is true. (`SupermarketAppMVC/app.js:424-509`)
- The PayPal buttons in `views/paymentMethod.ejs` (and `views/subscriptionPayment.ejs`) load the PayPal JS SDK, delegate to the `/api/paypal/*` endpoints, and keep the regular `/purchase` form hidden while PayPal handles the capture, which keeps the “method selection → external capture → checkout” narrative intact. (`SupermarketAppMVC/views/paymentMethod.ejs:35-203`, `SupermarketAppMVC/views/subscriptionPayment.ejs:17-164`)
- Refunds move through `OrderController.requestRefund` (customers) and `AdminController.refundOrder` plus the refund-request admin pages; admins call `stripe.createRefund`/`paypal.refundCapture`, normalize statuses, track amounts/references, and reject or mark manual refunds for unsupported providers while making the `/admin/refund-requests` dashboard surface pending approvals. (`SupermarketAppMVC/controllers/OrderController.js:163-215`, `SupermarketAppMVC/controllers/AdminController.js:459-598`, `SupermarketAppMVC/routes/adminRouter.js:57-69`)
- `CartController.checkout` recomputes prices from the snapshot, resolves vouchers, persists the order and detailed item snapshot through `Order.create`, clears the cart and payment/session state, and finally renders `paymentSuccess` or redirects to shopping. (`SupermarketAppMVC/controllers/CartController.js:323`, `SupermarketAppMVC/controllers/CartController.js:383`, `SupermarketAppMVC/controllers/CartController.js:443`, `SupermarketAppMVC/controllers/CartController.js:500`)

## Orders
- When placing an order, model `Order.create` writes to `orders` and optionally `order_items`.
- Order history pages render with items fetched via SQL joins.
- Admin can view a specific user’s orders via `/admin/users/:id/orders` and may clear order history via POST.

## Security and roles
- Role is a simple string on `users.role` ("admin" or "user").
- Admin-only routes check `req.session.user.role === 'admin'`.

## Printing and invoices
- `views/invoice.ejs` provides a printable invoice, hides nav when printing, computes totals in controller.

## Pagination
- Simple in-memory `.slice()` with `pageSize=10`. For large datasets move to SQL LIMIT/OFFSET.

## Reviews
- Purpose: Let users post ratings and comments on products to inform others and improve discovery.
- Data model: Table `reviews` with columns `(id, product_id, user_id, rating INT 1-5, comment TEXT, created_at TIMESTAMP)`. Foreign keys to `products` and `users`.
- Controllers & routes:
	- `ProductController.show` loads product details plus aggregated review stats (average rating, count) and recent reviews.
	- `ReviewController.create` handles POST `/products/:id/reviews` (auth required). Validates rating 1–5, sanitizes comment, and inserts.
	- Optional `ReviewController.delete` for admins/moderators to remove inappropriate reviews.
- Views:
	- `views/product.ejs` displays average rating (stars) and a list of reviews; shows a form to add a review if logged in.
	- `views/partials/productCard.ejs` may show a compact star rating next to the price.
- UI/UX:
	- Prevent duplicate rapid submissions; show success/error flash messages.
	- Basic moderation cues and report link (future work).

