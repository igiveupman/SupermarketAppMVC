const db = require('../db'); // This is now the promise-based pool

const Transaction = {
  create: async (data) => {
    const sql = `INSERT INTO transactions (orderId, payerId, payerEmail, amount, currency, status, time)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`;
    const params = [data.orderId, data.payerId, data.payerEmail, data.amount, data.currency, data.status, data.time];
    await db.query(sql, params); // Now this returns a promise!
  }
};

module.exports = Transaction;