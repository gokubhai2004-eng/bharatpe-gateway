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

    if (!amount || isNaN(amount)) {
        return res.status(400).json({ status: "ERROR", message: "Amount required. Example: ?amount=1" });
    }

    try {
        // BharatPe exact date format: DD-MM-YYYY
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const todayStr = `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}`;

        // Yesterday
        const y = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const yestStr = `${pad(y.getDate())}-${pad(y.getMonth() + 1)}-${y.getFullYear()}`;

        // URL with BharatPe required query parameters
        const bpeUrl = `https://payments-tesseract.bharatpe.in/api/v1/merchant/transactions?merchantId=${BHARATPE_CONFIG.merchantId}&fromDate=${yestStr}&toDate=${todayStr}&module=PAYMENT&page=1&limit=20`;

        const response = await axios.get(bpeUrl, {
            headers: {
                'token': BHARATPE_CONFIG.token,
                'Cookie': BHARATPE_CONFIG.cookie,
                'Accept': 'application/json, text/plain, */*',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 8000
        });

        const txns = response.data?.data?.transactions || response.data?.transactions || [];

        for (const t of txns) {
            const txnAmount = parseFloat(t.amount || t.txnAmount);
            const statusUpper = String(t.status || t.txnStatus || '').toUpperCase();

            if (txnAmount === amount && ['SUCCESS', 'COMPLETED', 'SETTLED'].includes(statusUpper)) {
                return res.json({
                    status: "COMPLETED",
                    amount: txnAmount,
                    utr: t.bankReferenceNo || t.transactionId || t.bankRefNo || 'N/A',
                    payer_name: t.payerName || 'N/A'
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
            details: error.response?.data || error.message
        });
    }
});

app.get('/', (req, res) => {
    res.send("BharatPe Auto-Verify API is running!");
});

module.exports = app;
