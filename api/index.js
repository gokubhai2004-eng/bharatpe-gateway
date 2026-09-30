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
        return res.status(400).json({ status: "ERROR", message: "Amount missing" });
    }

    // Dates in YYYY-MM-DD
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    // Try multiple standard query variations for BharatPe
    const attempts = [
        {
            url: `https://payments-tesseract.bharatpe.in/api/v1/merchant/transactions?merchantId=${BHARATPE_CONFIG.merchantId}&sDate=${yesterday}&eDate=${today}`,
            headers: { 'token': BHARATPE_CONFIG.token, 'Cookie': BHARATPE_CONFIG.cookie }
        },
        {
            url: `https://payments-tesseract.bharatpe.in/api/v1/merchant/transactions?userId=${BHARATPE_CONFIG.merchantId}&limit=10`,
            headers: { 'token': BHARATPE_CONFIG.token, 'Cookie': BHARATPE_CONFIG.cookie }
        },
        {
            url: `https://payments-tesseract.bharatpe.in/api/v1/merchant/transactions?merchantId=${BHARATPE_CONFIG.merchantId}&limit=10`,
            headers: { 
                'token': BHARATPE_CONFIG.token,
                'Cookie': `token=${BHARATPE_CONFIG.cookie}`
            }
        }
    ];

    let lastErr = null;

    for (const attempt of attempts) {
        try {
            const response = await axios.get(attempt.url, {
                headers: {
                    ...attempt.headers,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json, text/plain, */*'
                },
                timeout: 5000
            });

            const data = response.data;
            const txns = data?.data?.transactions || data?.transactions || (Array.isArray(data?.data) ? data.data : []);

            for (const t of txns) {
                const txnAmount = parseFloat(t.amount || t.txnAmount || 0);
                const statusStr = String(t.status || t.txnStatus || '').toUpperCase();

                if (txnAmount === amount && ['SUCCESS', 'COMPLETED', 'SETTLED'].includes(statusStr)) {
                    return res.json({
                        status: "COMPLETED",
                        amount: txnAmount,
                        utr: t.bankReferenceNo || t.transactionId || t.bankRefNo || 'N/A'
                    });
                }
            }

            return res.json({
                status: "PENDING",
                message: "Fetched BharatPe successfully, payment not matched",
                txns_found: txns.length
            });

        } catch (e) {
            lastErr = {
                url: attempt.url,
                msg: e.response?.data || e.message
            };
        }
    }

    return res.status(500).json({
        status: "ERROR",
        last_failed_attempt: lastErr
    });
});

app.get('/', (req, res) => res.send("BharatPe Verify Engine Running"));

module.exports = app;
