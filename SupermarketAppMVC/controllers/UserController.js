const User = require('../models/User');

module.exports = {
  list(req, res) {
    User.getAll((err, users) => {
      if (err) return res.status(500).send(err);
      res.render('index', { users, user: req.session.user });
    });
  },

  show(req, res) {
    User.getById(req.params.id, (err, user) => {
      if (err) return res.status(500).send(err);
      if (!user) return res.status(404).send('Not found');
      res.render('user', { user, userSession: req.session.user });
    });
  },

  registerForm(req, res) {
    res.render('register');
  },

  register(req, res) {
    User.add(req.body, (err) => {
      if (err) return res.status(500).send(err);
      res.redirect('/login');
    });
  },

  editForm(req, res) {
    User.getById(req.params.id, (err, user) => {
      if (err) return res.status(500).send(err);
      res.render('updateUser', { user });
    });
  },

  update(req, res) {
    User.update(req.params.id, req.body, (err) => {
      if (err) return res.status(500).send(err);
      res.redirect('/users');
    });
  },

  destroy(req, res) {
    User.delete(req.params.id, (err) => {
      if (err) return res.status(500).send(err);
      res.redirect('/users');
    });
  }
};