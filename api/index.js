const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

app.get('/api/check', async (req, res) => {
    const { merchantId, token, cookie, amount } = req.query;

    if (!merchantId || !token || !cookie) {
        return res.status(400).json({
            status: "ERROR",
            message: "Missing parameters: 'merchantId', 'token', and 'cookie' are required."
        });
    }

    try {
        const now = Date.now();
        const yesterday = now - (24 * 60 * 60 * 1000);

        const bpeUrl = `https://payments-tesseract.bharatpe.in/api/v1/merchant/transactions?module=PAYMENT_QR&merchantId=${merchantId}&sDate=${yesterday}&eDate=${now}&pageSize=15&pageCount=0&isFromOtDashboard=1`;

        const response = await axios.get(bpeUrl, {
            headers: {
                'token': token,
                'Cookie': cookie,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Referer': 'https://merchant.bharatpe.com/',
                'Origin': 'https://merchant.bharatpe.com'
            },
            timeout: 8000
        });

        const txns = response.data?.data?.transactions || response.data?.transactions || [];
        const checkAmount = parseFloat(amount);

        // Open QR Mode (agar amount na bheja ho ya 0 ho)
        if (!checkAmount || checkAmount === 0 || isNaN(checkAmount)) {
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
            return res.json({ status: "PENDING", message: "No recent payments found" });
        }

        // Fixed / Decimal Mode
        for (const t of txns) {
            const txnAmount = parseFloat(t.amount || t.txnAmount || 0);
            const statusUpper = String(t.status || t.txnStatus || '').toUpperCase();

            if (Math.abs(txnAmount - checkAmount) < 0.01 && ['SUCCESS', 'COMPLETED', 'SETTLED'].includes(statusUpper)) {
                return res.json({
                    status: "COMPLETED",
                    amount: txnAmount,
                    utr: t.bankReferenceNo || t.transactionId || t.bankRefNo || 'N/A',
                    payer_name: t.payerName || 'N/A'
                });
            }
        }

        return res.json({ status: "PENDING", message: "Payment not received yet" });

    } catch (error) {
        return res.status(500).json({
            status: "ERROR",
            details: error.response?.data || error.message
        });
    }
});

app.get('/', (req, res) => {
    res.send("BharatPe Dynamic Multi-Merchant Gateway Live!");
});

module.exports = app;
