const express = require('express');
const bodyParser = require("body-parser");
const netsQr= require("./services/nets");
const axios = require('axios');
const app = express();

//variables in the .env file will be available in process.env
require('dotenv').config();

app.set('view engine', 'ejs');
app.use(bodyParser.json());
app.use(express.static('public'));
app.use(express.urlencoded({
    extended: true
}));

// Define routes here
app.get("/", (req, res) => { res.render("shopping") })
app.post('/generateNETSQR', netsQr.generateQrCode);
app.get("/nets-qr/success", (req, res) => {
    res.render('netsTxnSuccessStatus', { message: 'Transaction Successful!' });
});
app.get("/nets-qr/fail", (req, res) => {
    res.render('netsTxnFailStatus', { message: 'Transaction Failed. Please try again.' });
})


//errors
app.get('/401', (req, res) => {
    res.render('401', { errors: req.flash('error') });
});

//Endpoint in your backend which is a Server-Sent Events (SSE) endpoint that allows your frontend (browser) 
//to receive real-time updates about the payment status of a NETS QR transaction.
app.get('/sse/payment-status/:txnRetrievalRef', async (req, res) => {
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    const txnRetrievalRef = req.params.txnRetrievalRef;
    let pollCount = 0;
    const maxPolls = 60; // 5 minutes if polling every 5s
    let frontendTimeoutStatus = 0;

    const interval = setInterval(async () => {
        pollCount++;

        try {
            // Call the NETS query API
            const response = await axios.post(
                'https://sandbox.nets.openapipaas.com/api/v1/common/payments/nets-qr/query',
                { txn_retrieval_ref: txnRetrievalRef, frontend_timeout_status: frontendTimeoutStatus },
                {
                    headers: {
                        'api-key': process.env.API_KEY,
                        'project-id': process.env.PROJECT_ID,
                        'Content-Type': 'application/json'
                    }
                }
            );

            console.log("Polling response:", response.data);
            // Send the full response to the frontend
            res.write(`data: ${JSON.stringify(response.data)}\n\n`);
        
          const resData = response.data.result.data;

            // Decide when to end polling and close the connection
            //Check if payment is successful
            if (resData.response_code == "00" && resData.txn_status === 1) {
                // Payment success: send a success message
                res.write(`data: ${JSON.stringify({ success: true })}\n\n`);
                clearInterval(interval);
                res.end();
            } else if (frontendTimeoutStatus == 1 && resData && (resData.response_code !== "00" || resData.txn_status === 2)) {
                // Payment failure: send a fail message
                res.write(`data: ${JSON.stringify({ fail: true, ...resData })}\n\n`);
                clearInterval(interval);
                res.end();
            }

        } catch (err) {
            clearInterval(interval);
            res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
            res.end();
        }


        // Timeout
        if (pollCount >= maxPolls) {
            clearInterval(interval);
            frontendTimeoutStatus = 1;
            res.write(`data: ${JSON.stringify({ fail: true, error: "Timeout" })}\n\n`);
            res.end();
        }
    }, 5000);

    req.on('close', () => {
        clearInterval(interval);
    });
});

//Start express server and bind it to a port
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
