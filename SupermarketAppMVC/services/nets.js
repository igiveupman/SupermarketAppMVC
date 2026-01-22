const axios = require('axios');
const { computeCartPricing } = require('./subscriptionPricing');

function getCourseInitId() {
  try {
    require.resolve('../course_init_id');
    const { courseInitId } = require('../course_init_id');
    return courseInitId ? String(courseInitId) : '';
  } catch (err) {
    return '';
  }
}

// NETS QR for cart checkout (amount from cart total).
exports.generateQrCode = async (req, res) => {
  const cart = req.session.cart || [];
  if (!cart.length) {
    req.flash('error', 'Your cart is empty.');
    return res.redirect('/cart');
  }
  if (!process.env.NETS_API_KEY || !process.env.NETS_PROJECT_ID) {
    return res.render('netsQrFail', {
      user: req.session.user,
      pageTitle: 'NETS QR Failed',
      responseCode: 'N.A.',
      instructions: '',
      errorMsg: 'NETS configuration is missing. Set NETS_API_KEY and NETS_PROJECT_ID.'
    });
  }

  const pricing = computeCartPricing(cart, req.session.user);
  const cartTotal = pricing.total.toFixed(2);
  try {
    const requestBody = {
      txn_id: 'sandbox_nets|m|8ff8e5b6-d43e-4786-8ac5-7accf8c5bd9b',
      amt_in_dollars: cartTotal,
      notify_mobile: 0
    };

    const response = await axios.post(
      'https://sandbox.nets.openapipaas.com/api/v1/common/payments/nets-qr/request',
      requestBody,
      {
        headers: {
          'api-key': process.env.NETS_API_KEY,
          'project-id': process.env.NETS_PROJECT_ID
        }
      }
    );

    const qrData = response.data && response.data.result && response.data.result.data;
    if (
      qrData &&
      qrData.response_code === '00' &&
      qrData.txn_status === 1 &&
      qrData.qr_code
    ) {
      const txnRetrievalRef = qrData.txn_retrieval_ref;
      const courseInitId = getCourseInitId();
      const webhookUrl = `https://sandbox.nets.openapipaas.com/api/v1/common/payments/nets/webhook?txn_retrieval_ref=${txnRetrievalRef}&course_init_id=${courseInitId}`;
      return res.render('netsQr', {
        user: req.session.user,
        pageTitle: 'NETS QR',
        messages: req.flash('success') || [],
        errors: req.flash('error') || [],
        total: cartTotal,
        qrCodeUrl: `data:image/png;base64,${qrData.qr_code}`,
        txnRetrievalRef,
        timer: 300,
        webhookUrl,
        cancelUrl: '/cart'
      });
    }

    const errorMsg = qrData && qrData.error_message ? qrData.error_message : 'An error occurred while generating the QR code.';
    return res.render('netsQrFail', {
      user: req.session.user,
      pageTitle: 'NETS QR Failed',
      messages: req.flash('success') || [],
      errors: req.flash('error') || [],
      responseCode: qrData && qrData.response_code ? qrData.response_code : 'N.A.',
      instructions: qrData && qrData.instruction ? qrData.instruction : '',
      errorMsg
    });
  } catch (error) {
    console.error('NETS QR request failed:', error.message);
    return res.render('netsQrFail', {
      user: req.session.user,
      pageTitle: 'NETS QR Failed',
      messages: req.flash('success') || [],
      errors: req.flash('error') || [],
      responseCode: 'N.A.',
      instructions: '',
      errorMsg: 'Failed to connect to NETS gateway.'
    });
  }
};

// NETS QR for subscriptions (fixed amount).
exports.generateQrCodeForAmount = async (req, res, amount) => {
  if (!process.env.NETS_API_KEY || !process.env.NETS_PROJECT_ID) {
    return res.render('netsQrFail', {
      user: req.session.user,
      pageTitle: 'NETS QR Failed',
      responseCode: 'N.A.',
      instructions: '',
      errorMsg: 'NETS configuration is missing. Set NETS_API_KEY and NETS_PROJECT_ID.'
    });
  }

  const totalAmount = Number(amount || 0).toFixed(2);
  try {
    const requestBody = {
      txn_id: 'sandbox_nets|m|8ff8e5b6-d43e-4786-8ac5-7accf8c5bd9b',
      amt_in_dollars: totalAmount,
      notify_mobile: 0
    };

    const response = await axios.post(
      'https://sandbox.nets.openapipaas.com/api/v1/common/payments/nets-qr/request',
      requestBody,
      {
        headers: {
          'api-key': process.env.NETS_API_KEY,
          'project-id': process.env.NETS_PROJECT_ID
        }
      }
    );

    const qrData = response.data && response.data.result && response.data.result.data;
    if (
      qrData &&
      qrData.response_code === '00' &&
      qrData.txn_status === 1 &&
      qrData.qr_code
    ) {
      const txnRetrievalRef = qrData.txn_retrieval_ref;
      const courseInitId = getCourseInitId();
      const webhookUrl = `https://sandbox.nets.openapipaas.com/api/v1/common/payments/nets/webhook?txn_retrieval_ref=${txnRetrievalRef}&course_init_id=${courseInitId}`;
      return res.render('netsQr', {
        user: req.session.user,
        pageTitle: 'NETS QR',
        messages: req.flash('success') || [],
        errors: req.flash('error') || [],
        total: totalAmount,
        qrCodeUrl: `data:image/png;base64,${qrData.qr_code}`,
        txnRetrievalRef,
        timer: 300,
        webhookUrl,
        cancelUrl: '/subscription'
      });
    }

    const errorMsg = qrData && qrData.error_message ? qrData.error_message : 'An error occurred while generating the QR code.';
    return res.render('netsQrFail', {
      user: req.session.user,
      pageTitle: 'NETS QR Failed',
      messages: req.flash('success') || [],
      errors: req.flash('error') || [],
      responseCode: qrData && qrData.response_code ? qrData.response_code : 'N.A.',
      instructions: qrData && qrData.instruction ? qrData.instruction : '',
      errorMsg
    });
  } catch (error) {
    console.error('NETS QR request failed:', error.message);
    return res.render('netsQrFail', {
      user: req.session.user,
      pageTitle: 'NETS QR Failed',
      messages: req.flash('success') || [],
      errors: req.flash('error') || [],
      responseCode: 'N.A.',
      instructions: '',
      errorMsg: 'Failed to connect to NETS gateway.'
    });
  }
};
