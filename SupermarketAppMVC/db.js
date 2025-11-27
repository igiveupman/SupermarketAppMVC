/**
 * MySQL connection helper
 * - Centralizes DB connection for models to import
 * - Loads credentials from environment variables (.env in dev)
 */
const mysql = require('mysql2');
require('dotenv').config(); // Load variables from .env

//Database connection details
// Support both DB_PASSWORD and legacy DB_PASS naming
const resolvedPassword = process.env.DB_PASSWORD || process.env.DB_PASS;
// Single shared connection (simple apps). For higher throughput, consider createPool.
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: resolvedPassword,
    database: process.env.DB_NAME
});

//Connecting to database
db.connect((err) => {
    if (err) {
        console.error('Error connecting to MySQL:', err);
        return;
    }
    console.log('Connected to MySQL database');
});

module.exports = db;
