/**
 * Root server bootstrap
 * - Creates the Express host app and mounts the MVC app located in SupermarketAppMVC/
 * - Keep this file minimal so the MVC app encapsulates the feature logic
 */
const express = require('express');
const path = require('path');
const app = express();

// Import the MVC sub-app which configures routes, views, static assets, sessions, etc.
const mvcApp = require('./SupermarketAppMVC/app');

// Mount the MVC app at root (all feature routes live under this)
app.use('/', mvcApp);

// Start HTTP server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
