const db = require('../db');

const CartItems = {
    // Get all cart items for a user
    async getByUserId(userId) {
        const [rows] = await db.query('SELECT * FROM cart_items WHERE userId = ?', [userId]);
        return rows;
    },

    // Add a fine to the cart
    async add(userId, fineId) {
        await db.query('INSERT INTO cart_items (userId, fineId) VALUES (?, ?)', [userId, fineId]);
    },

    // Remove a fine from the cart
    async remove(userId, fineId) {
        await db.query('DELETE FROM cart_items WHERE userId = ? AND fineId = ?', [userId, fineId]);
    },

    // Remove multiple fines from the cart
    async removeBulk(userId, fineIds) {
        if (!fineIds || !fineIds.length) return;
        const placeholders = fineIds.map(() => '?').join(',');
        const sql = `DELETE FROM cart_items WHERE userId = ? AND fineId IN (${placeholders})`;
        await db.query(sql, [userId, ...fineIds]);
    },

    // Clear all fines from the cart
    async clear(userId) {
        await db.query('DELETE FROM cart_items WHERE userId = ?', [userId]);
    }
};

module.exports = CartItems;