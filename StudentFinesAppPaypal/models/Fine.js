const db = require('../db');

const Fine = {
    // Get fines by an array of IDs
    getByIds: async (ids) => {
        if (!ids || !ids.length) return [];
        const placeholders = ids.map(() => '?').join(',');
        const [rows] = await db.query(`SELECT * FROM fines WHERE fineId IN (${placeholders})`, ids);
        return rows;
    },

    // Mark fines as paid by an array of IDs
    markPaid: async (ids) => {
        if (!ids || !ids.length) return;
        const placeholders = ids.map(() => '?').join(',');
        console.log('Marking these fines as paid:', ids);
        await db.query(`UPDATE fines SET paid = 1 WHERE fineId IN (${placeholders})`, ids);
    },

    // Add a new fine
    addFine: async (fine) => {
        await db.query(
            'INSERT INTO fines (userId, fineTypeId, amount, description, paid) VALUES (?, ?, ?, ?, ?)',
            [fine.userId, fine.fineTypeId, fine.amount, fine.description, fine.paid]
        );
    },

    // Get all fine types
    getFineTypes: async () => {
        const [rows] = await db.query('SELECT * FROM fine_types');
        return rows;
    },

    // Get all fines with user info
    getAllWithUser: async () => {
        const [rows] = await db.query(`
            SELECT f.*, u.name AS userName, ft.typeName
            FROM fines f
            JOIN users u ON f.userId = u.userId
            LEFT JOIN fine_types ft ON f.fineTypeId = ft.id
        `);
        return rows;
    },

    // Get all fines with user and type info (same as above)
    getAllWithUserAndType: async () => {
        const [rows] = await db.query(`
            SELECT f.*, u.name AS userName, ft.typeName
            FROM fines f
            JOIN users u ON f.userId = u.userId
            LEFT JOIN fine_types ft ON f.fineTypeId = ft.id
        `);
        return rows;
    },

    // Get fines for a user with type info
    getByUserIdWithType: async (userId) => {
        const [rows] = await db.query(`
            SELECT f.*, ft.typeName
            FROM fines f
            LEFT JOIN fine_types ft ON f.fineTypeId = ft.id
            WHERE f.userId = ?
        `, [userId]);
        return rows;
    },

    // Get fines by an array of IDs with type info
    getByIdsWithType: async (ids) => {
        if (!ids || !ids.length) return [];
        const placeholders = ids.map(() => '?').join(',');
        const [rows] = await db.query(`
            SELECT f.*, ft.typeName
            FROM fines f
            LEFT JOIN fine_types ft ON f.fineTypeId = ft.id
            WHERE f.fineId IN (${placeholders})
        `, ids);
        return rows;
    }
};

module.exports = Fine;