const db = require('../db');
const bcrypt = require('bcrypt');

const User = {
    // Get all students (returns a promise)
    getAll: async () => {
        const [rows] = await db.query('SELECT * FROM users WHERE role = "student"');
        return rows;
    },

    // Get user by credentials (returns user object or null)
    getByCredentials: async (email, password) => {
        const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        const user = rows && rows.length ? rows[0] : null;
        if (!user) return null;
        const match = await bcrypt.compare(password, user.password);
        if (!match) return null;
        delete user.password;
        return user;
    }
};

module.exports = User;

