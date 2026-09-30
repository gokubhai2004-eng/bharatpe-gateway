const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const BHARATPE_CONFIG = {
    merchantId: "67978226",
    token: "e1166dc3665a462997e43c6a6b87154d",
    cookie: "eyJpdiI6ImpWaEg3d004ck5UeWNzcUtrUDM2dFE9PSIsInZhbHVlIjoiZmYxOU9cL1I4d2JFQWdqelVWeHh2UFRERXBxbTVYWSs4U0FwbGNRSHREeGlva2pmSng0dWljNzcwTnpsaTZ5SlwvODhwbFNRR0J4ZXlETTJwb0pjOXVDbFdrUTlqcWI4bnNvMmFWS1A3S0Z0bUthQnlkVjdQTWl6VmFueVE4WDJaNiIsIm1hYyI6IjIzZjhlZDAwMDZiNjY4Mjg4NmZlNzk0YWI3YmYyMjFhYjQzZjJmZmM5YmY0NmQ1YTVkMzRkN2E0ZWYwN2VmNzEifQ=="
};

app.get('/api/check', async (req, res) => {
    const amount = parseFloat(req.query.amount);

    // Try primary BharatPe dashboard API
    const endpoints = [
        `https://payments-tesseract.bharatpe.in/api/v1/merchant/transactions?merchantId=${BHARATPE_CONFIG.merchantId}`,
        `https://payments-tesseract.bharatpe.in/api/v1/merchant/transactions?merchantId=${BHARATPE_CONFIG.merchantId}&module=PAYMENT`,
        `https://payments-tesseract.bharatpe.in/api/v1/merchant/transactions/recent?merchantId=${BHARATPE_CONFIG.merchantId}`
    ];

    let lastError = null;

    for (const url of endpoints) {
        try {
            const response = await axios.get(url, {
                headers: {
                    'token': BHARATPE_CONFIG.token,
                    'Token': BHARATPE_CONFIG.token,
                    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Cookie': `token=${BHARATPE_CONFIG.token}; session=${BHARATPE_CONFIG.cookie}; bharatpe_session=${BHARATPE_CONFIG.cookie}`,
                    'accept': 'application/json, text/plain, */*'
                },
                timeout: 6000
            });

            const txns = response.data?.data?.transactions || response.data?.data || response.data?.transactions || [];

            for (const t of txns) {
                const txnAmount = parseFloat(t.amount || t.txnAmount);
                const statusUpper = String(t.status || t.txnStatus || '').toUpperCase();

                if (txnAmount === amount && ['SUCCESS', 'COMPLETED', 'SETTLED'].includes(statusUpper)) {
                    return res.json({
                        status: "COMPLETED",
                        amount: txnAmount,
                        utr: t.bankReferenceNo || t.transactionId || t.bankRefNo || 'N/A'
                    });
                }
            }

            return res.json({
                status: "PENDING",
                message: "Fetched successfully, payment not matched yet",
                recent_count: txns.length
            });

        } catch (err) {
            lastError = {
                endpoint: url,
                status: err.response?.status,
                data: err.response?.data || err.message
            };
        }
    }

    return res.status(500).json({
        status: "ERROR",
        debug_info: lastError
    });
});

app.get('/', (req, res) => res.send("Running"));

module.exports = app;
