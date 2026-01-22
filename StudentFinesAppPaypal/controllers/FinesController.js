const Transaction = require("../models/Transaction");
const Fine = require("../models/Fine");
const User = require("../models/User");
const CartItems = require("../models/CartItem");

const FinesController = {
  // List all fines for the logged-in user
  list: async (req, res) => {
    try {
      const userId = req.session.user && req.session.user.userId;
      if (!userId) return res.status(401).send("Unauthorized");
      const fines = await Fine.getByUserIdWithType(userId);
      const cartItems = await CartItems.getByUserId(userId);
      const cart = cartItems.map((item) => item.fineId);
      res.render("fines", { fines, cart, user: req.session.user });
    } catch (err) {
      res.status(500).send("Error retrieving fines or cart");
    }
  },

  // Get details for a specific fine
  getDetails: async (req, res) => {
    try {
      const fineId = req.params.id;
      const fines = await Fine.getByIds([fineId]);
      if (!fines.length) return res.status(404).send("Fine not found");
      res.render("fineDetails", { fine: fines[0], user: req.session.user });
    } catch (err) {
      res.status(500).send("Error retrieving fine details");
    }
  },

  // Mark selected fines as paid and remove them from cart
  pay: async (req, res, capture) => {
    console.log("pay called");
    try {
      // Extract transaction details from PayPal response
      const isoString =
        capture.purchase_units[0].payments.captures[0].create_time;
      const mysqlDatetime = isoString.replace("T", " ").replace("Z", "");

      const transaction = {
        orderId: capture.id,
        payerId: capture.payer.payer_id,
        payerEmail: capture.payer.email_address,
        amount: capture.purchase_units[0].payments.captures[0].amount.value,
        currency:
          capture.purchase_units[0].payments.captures[0].amount.currency_code,
        status: capture.status,
        time: mysqlDatetime, // Use the converted value here
      };

      // Save transaction to DB
      await Transaction.create(transaction);

      // Mark fines as paid (customize logic as needed)
      // Example: mark all unpaid fines for this user as paid
      const userId = req.session.user.userId;
      // If you want to mark only specific fines, pass their IDs instead
      let fineIds = req.body.fineIds;
      if (typeof fineIds === "string") {
        try {
          fineIds = JSON.parse(fineIds);
        } catch (e) {
          fineIds = [fineIds];
        }
      }
      if (!Array.isArray(fineIds)) {
        fineIds = [];
      }
      await Fine.markPaid(fineIds);

      // Remove paid fines from cart
      await CartItems.removeBulk(req.session.user.userId, fineIds);

      console.log("Transaction to save:", transaction);
      console.log("User session:", req.session.user);
      console.log("Fine IDs:", req.body.fineIds);

      // Respond with success
      res.json({ success: true, transaction });
    } catch (err) {
      console.error("Pay error:", err);
      res
        .status(500)
        .json({ error: "Failed to process payment", message: err.message });
    }
  },

  showFineUserForm: async (req, res) => {
    try {
      if (!req.session.user || req.session.user.role !== "admin") {
        return res.status(403).send("Forbidden2");
      }
      const users = await User.getAll();
      const fineTypes = await Fine.getFineTypes();
      res.render("fineUser", { users, fineTypes, user: req.session.user });
    } catch (err) {
      res.status(500).send("Error retrieving users or fine types");
    }
  },

  fineUser: async (req, res) => {
    try {
      if (!req.session.user || req.session.user.role !== "admin") {
        return res.status(403).send("Forbidden2");
      }
      const { userId, fineTypeId, amount, description } = req.body;
      await Fine.addFine({
        userId,
        fineTypeId,
        amount,
        description,
        paid: false,
      });
      req.flash("success", "Fine assigned to user");
      res.redirect("/admin/dashboard");
    } catch (err) {
      req.flash("error", "Could not fine user");
      res.redirect("/admin/fine-user");
    }
  },

  adminDashboard: async (req, res) => {
    try {
      if (!req.session.user || req.session.user.role !== "admin") {
        return res.status(403).send("Forbidden");
      }
      const users = await User.getAll();
      const fines = await Fine.getAllWithUserAndType();
      res.render("adminDashboard", { users, fines, user: req.session.user });
    } catch (err) {
      res.status(500).send("Error retrieving users or fines");
    }
  },
};

module.exports = FinesController;
