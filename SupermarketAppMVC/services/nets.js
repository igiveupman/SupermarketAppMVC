const axios = require('axios');
const https = require('https');
const dns = require('dns');
const { computeCartPricing } = require('./subscriptionPricing');
const vouchers = require('./vouchers');

const NETS_API_BASE = process.env.NETS_API_BASE || 'https://sandbox.nets.openapipaas.com';

function getCourseInitId() {
  try {
    require.resolve('../course_init_id');
    const { courseInitId } = require('../course_init_id');
    return courseInitId ? String(courseInitId) : '';
  } catch (err) {
    return '';
  }
}

function buildTxnId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `sandbox_nets|m|${Date.now()}_${rand}`;
}

const netsHttpsAgent = new https.Agent({
  keepAlive: true,
  lookup: (hostname, options, cb) => {
    dns.lookup(hostname, { ...options, family: 4 }, cb);
  }
});

async function postWithRetry(url, body, headers, attempts = 2) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await axios.post(url, body, {
        headers,
        timeout: 30000,
        httpsAgent: netsHttpsAgent
      });
    } catch (err) {
      lastErr = err;
      const status = err.response && err.response.status ? err.response.status : null;
      const isTimeout = err.code === 'ECONNABORTED';
      const retryable = isTimeout || (status && status >= 500);
      if (!retryable || i === attempts - 1) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }
  throw lastErr;
}

// NETS QR for cart checkout (amount derived from current cart snapshot).
exports.generateQrCode = async (req, res) => {
  const cart = req.session.cart || [];
  if (!cart.length) {
    req.flash('error', 'Your cart is empty.');
    return res.redirect('/cart');
  }
  // 1. Always compute cart total on the server (prevents client-side manipulation).
  const voucher = await vouchers.resolveAppliedVoucher(req);
  const pricing = computeCartPricing(cart, req.session.user, voucher);
  if (pricing.voucherRejected) {
    req.session.applied_voucher = null;
  }
  const cartTotal = pricing.total.toFixed(2);
  if (!process.env.NETS_API_KEY || !process.env.NETS_PROJECT_ID) {
    return res.render('netsQrFail', {
      user: req.session.user,
      pageTitle: 'NETS QR Failed',
      responseCode: 'N.A.',
      instructions: '',
      errorMsg: 'NETS configuration is missing. Set NETS_API_KEY and NETS_PROJECT_ID.'
    });
  }
  try {
    // 2. Build the NETS payload with our generated txn_id and the final amount.
    const requestBody = {
      txn_id: buildTxnId(),
      amt_in_dollars: cartTotal,
      notify_mobile: 0
    };

    // 3. POST to the NETS QR endpoint (supports sandbox/production via NETS_API_BASE).
    const response = await postWithRetry(
      `${NETS_API_BASE}/api/v1/common/payments/nets-qr/request`,
      requestBody,
      {
        'api-key': process.env.NETS_API_KEY,
        'project-id': process.env.NETS_PROJECT_ID,
        'Content-Type': 'application/json'
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
      // 4. Store NETS reference in session so webhook polling/checkout knows it belongs to NETS.
      // Store NETS transaction reference for later status polling.
      if (req && req.session) {
        req.session.payment_provider = 'nets';
        req.session.payment_reference = txnRetrievalRef;
      }
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
    const status = error.response && error.response.status ? error.response.status : null;
    const details = error.response && error.response.data ? JSON.stringify(error.response.data) : '';
    console.error('NETS QR request failed:', status ? `${status} ${error.message}` : error.message, details);
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

// NETS QR for subscriptions (amount comes from the selected tier, not the cart).
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
      txn_id: buildTxnId(),
      amt_in_dollars: totalAmount,
      notify_mobile: 0
    };

    // Subscription uses a fixed amount, but same NETS QR request.
    const response = await postWithRetry(
      `${NETS_API_BASE}/api/v1/common/payments/nets-qr/request`,
      requestBody,
      {
        'api-key': process.env.NETS_API_KEY,
        'project-id': process.env.NETS_PROJECT_ID,
        'Content-Type': 'application/json'
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
      if (req && req.session) {
        req.session.payment_provider = 'nets';
        req.session.payment_reference = txnRetrievalRef;
      }
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
    const status = error.response && error.response.status ? error.response.status : null;
    const details = error.response && error.response.data ? JSON.stringify(error.response.data) : '';
    console.error('NETS QR request failed:', status ? `${status} ${error.message}` : error.message, details);
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
