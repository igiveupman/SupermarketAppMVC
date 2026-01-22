const CartItems = require('../models/CartItem');
const Fines = require('../models/Fine');

const CartItemsController = {
    // List all cart items for the logged-in user
    list: async (req, res) => {
        try {
            const userId = req.session.user.userId;
            const cartItems = await CartItems.getByUserId(userId);
            res.render('cart', { cartItems, user: req.session.user });
        } catch (err) {
            res.status(500).send('Error retrieving cart');
        }
    },

    // Add a fine to the cart
    add: async (req, res) => {
        try {
            const userId = req.session.user.userId;
            const fineId = parseInt(req.body.fineId, 10);
            const fines = await Fines.getByIds([fineId]);
            if (!fines.length || fines[0].paid) {
                req.flash('error', 'Cannot add paid or invalid fine');
                return res.redirect('/fines');
            }
            await CartItems.add(userId, fineId);
            req.flash('success', 'Fine added to cart');
            res.redirect('/fines');
        } catch (err) {
            req.flash('error', 'Could not add to cart');
            res.redirect('/fines');
        }
    },

    // Remove a fine from the cart
    remove: async (req, res) => {
        try {
            const userId = req.session.user.userId;
            const fineId = parseInt(req.body.fineId, 10);
            await CartItems.remove(userId, fineId);
            if (req.headers['content-type'] === 'application/json') {
                return res.json({ success: true, fineId });
            } else {
                req.flash('success', 'Fine removed from cart');
                res.redirect('/fines');
            }
        } catch (err) {
            if (req.headers['content-type'] === 'application/json') {
                return res.status(500).json({ success: false, message: 'Could not remove from cart' });
            } else {
                req.flash('error', 'Could not remove from cart');
                res.redirect('/fines');
            }
        }
    },

    // Clear all fines from the cart
    clear: async (req, res) => {
        try {
            const userId = req.session.user.userId;
            await CartItems.clear(userId);
            if (req.headers['content-type'] === 'application/json') {
                return res.json({ success: true });
            } else {
                req.flash('success', 'Cart cleared');
                res.redirect('/fines');
            }
        } catch (err) {
            if (req.headers['content-type'] === 'application/json') {
                return res.status(500).json({ success: false, message: 'Could not clear cart' });
            } else {
                req.flash('error', 'Could not clear cart');
                res.redirect('/fines');
            }
        }
    }
};

module.exports = CartItemsController;