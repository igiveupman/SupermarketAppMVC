# SupermarketAppMVC – Annotated Overview

This document is a guided tour of the codebase with commentary on purpose, data flow, and key files. It does not change runtime behavior.

## Top-level
- `app.js` (root): Starts the Express server that mounts the MVC app in `SupermarketAppMVC/`.
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

