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

app.get('/api/check', async (req, res) => {
    const amount = parseFloat(req.query.amount);

    try {
        const now = Date.now();
        const yesterday = now - (24 * 60 * 60 * 1000);

        // Exact verified BharatPe inspect URL
        const bpeUrl = `https://payments-tesseract.bharatpe.in/api/v1/merchant/transactions?module=PAYMENT_QR&merchantId=${BHARATPE_CONFIG.merchantId}&sDate=${yesterday}&eDate=${now}&pageSize=15&pageCount=0&isFromOtDashboard=1`;

        const response = await axios.get(bpeUrl, {
            headers: {
                'token': BHARATPE_CONFIG.token,
                'Cookie': BHARATPE_CONFIG.cookie,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Referer': 'https://merchant.bharatpe.com/',
                'Origin': 'https://merchant.bharatpe.com'
            },
            timeout: 8000
        });

        const txns = response.data?.data?.transactions || response.data?.transactions || [];

        // SYSTEM 2: OPEN QR SUPPORT (Agar amount 0 ya missing ho toh latest payment pick karega)
        if (!amount || amount === 0 || isNaN(amount)) {
            for (const t of txns) {
                const txnAmount = parseFloat(t.amount || t.txnAmount || 0);
                const statusUpper = String(t.status || t.txnStatus || '').toUpperCase();

                if (txnAmount > 0 && ['SUCCESS', 'COMPLETED', 'SETTLED'].includes(statusUpper)) {
                    return res.json({
                        status: "COMPLETED",
                        recent_received: {
                            amount: txnAmount,
                            utr: t.bankReferenceNo || t.transactionId || t.bankRefNo || 'N/A',
                            payer_name: t.payerName || 'N/A'
                        }
                    });
                }
            }

            return res.json({
                status: "PENDING",
                message: "No recent payments found"
            });
        }

        // SYSTEM 1: EXACT / DECIMAL AMOUNT CHECK
        for (const t of txns) {
            const txnAmount = parseFloat(t.amount || t.txnAmount || 0);
            const statusUpper = String(t.status || t.txnStatus || '').toUpperCase();

            // Precision match up to 2 decimal places
            if (Math.abs(txnAmount - amount) < 0.01 && ['SUCCESS', 'COMPLETED', 'SETTLED'].includes(statusUpper)) {
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
    res.send("BharatPe Auto-Verify Payment Engine is Running Live!");
});

module.exports = app;
