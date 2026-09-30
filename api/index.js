const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// BHARATPE CREDENTIALS
const BHARATPE_CONFIG = {
    merchantId: "67978226",
    token: "e1166dc3665a462997e43c6a6b87154d",
    cookie: "eyJpdiI6ImpWaEg3d004ck5UeWNzcUtrUDM2dFE9PSIsInZhbHVlIjoiZmYxOU9cL1I4d2JFQWdqelVWeHh2UFRERXBxbTVYWSs4U0FwbGNRSHREeGlva2pmSng0dWljNzcwTnpsaTZ5SlwvODhwbFNRR0J4ZXlETTJwb0pjOXVDbFdrUTlqcWI4bnNvMmFWS1A3S0Z0bUthQnlkVjdQTWl6VmFueVE4WDJaNiIsIm1hYyI6IjIzZjhlZDAwMDZiNjY4Mjg4NmZlNzk0YWI3YmYyMjFhYjQzZjJmZmM5YmY0NmQ1YTVkMzRkN2E0ZWYwN2VmNzEifQ=="
};

// ----------------------------------------------------
// VERIFY PAYMENT ENDPOINT
// Usage: /api/check?amount=10
// ----------------------------------------------------
app.get('/api/check', async (req, res) => {
    const amount = parseFloat(req.query.amount);

    if (!amount || isNaN(amount)) {
        return res.status(400).json({ 
            status: "ERROR", 
            message: "Amount is required. Example: /api/check?amount=10" 
        });
    }

    try {
        const bpeUrl = `https://payments-tesseract.bharatpe.in/api/v1/merchant/transactions?merchantId=${BHARATPE_CONFIG.merchantId}&limit=15`;
        
        const response = await axios.get(bpeUrl, {
            headers: {
                'token': BHARATPE_CONFIG.token,
                'Cookie': BHARATPE_CONFIG.cookie,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            },
            timeout: 6000
        });

        const txns = response.data?.data?.transactions || [];

        // Check recent transactions matching amount and status SUCCESS
        for (const t of txns) {
            const txnAmount = parseFloat(t.amount);
            const txnStatus = (t.status || '').toUpperCase();

            if (txnAmount === amount && txnStatus === 'SUCCESS') {
                return res.json({
                    status: "COMPLETED",
                    amount: txnAmount,
                    utr: t.bankReferenceNo || t.transactionId || 'N/A',
                    payer_name: t.payerName || 'N/A',
                    payment_time: t.paymentTime || t.transactionTime || 'N/A'
                });
            }
        }

        return res.json({
            status: "PENDING",
            message: "Payment not received yet"
        });

    } catch (error) {
        return res.status(500).json({
            status: "ERROR",
            message: "Failed to fetch from BharatPe",
            error: error.message
        });
    }
});

// Root ping
app.get('/', (req, res) => {
    res.send("BharatPe Auto-Verify API is running live!");
});

module.exports = app;
