const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// =========================================================================
// HELPER: CORE BHARATPE SETTLEMENT SCANNER (AAPKA EXACT FAST ENGINE)
// =========================================================================
async function fetchBharatPeTransactions(merchantId, token, cookie) {
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

    return response.data?.data?.transactions || response.data?.transactions || [];
}

// =========================================================================
// 1. NEW ENTERPRISE ENDPOINT: /checkout/create
// =========================================================================
app.post('/checkout/create', (req, res) => {
    try {
        const { 
            amount, 
            upi_id, 
            merchant_id, 
            merchant_token, 
            cookie, 
            webhook_url, 
            secret,
            redirect_url 
        } = req.body;

        if (!amount) {
            return res.status(400).json({ ok: false, error: "Missing 'amount' parameter" });
        }

        // Conflict-free random decimal generation (e.g. ₹349.42)
        const baseAmt = parseFloat(amount);
        const randomPaise = (Math.floor(Math.random() * 89) + 10) / 100;
        const finalAmount = (baseAmt + randomPaise).toFixed(2);

        const orderUid = 'BP-' + Math.random().toString(36).substring(2, 9).toUpperCase();
        const targetUpi = upi_id || 'BHARATPE.9K0O0W0A8H734919@unitype';
        const upiUri = `upi://pay?pa=${targetUpi}&pn=Merchant&am=${finalAmount}&cu=INR`;
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(upiUri)}`;

        // Stateless Token Payload (Zero Database Required)
        const tokenPayload = {
            order_uid: orderUid,
            amount: parseFloat(finalAmount),
            merchant_id: merchant_id,
            merchant_token: merchant_token,
            cookie: cookie,
            webhook_url: webhook_url || null,
            secret: secret || 'whsec_default',
            redirect_url: redirect_url || null,
            upi_id: targetUpi,
            created_at: Date.now()
        };

        const verifyToken = Buffer.from(JSON.stringify(tokenPayload)).toString('base64');

        return res.json({
            ok: true,
            order_uid: orderUid,
            pay_url: `https://${req.headers.host}/pay/${orderUid}`,
            amount: finalAmount,
            qr_url: qrUrl,
            upi_uri: upiUri,
            upi_id: targetUpi,
            amount_charged: finalAmount,
            merchant_name: 'BharatPe Merchant',
            verify_url: `https://${req.headers.host}/checkout/verify`,
            verify_token: verifyToken,
            expires_in: 600
        });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// =========================================================================
// 2. NEW ENTERPRISE ENDPOINT: /checkout/verify (Polling + Webhook Dispatch)
// =========================================================================
app.post('/checkout/verify', async (req, res) => {
    try {
        const token = req.body.t || req.query.t;
        if (!token) {
            return res.status(400).json({ status: "ERROR", message: "Token missing" });
        }

        let order;
        try {
            order = JSON.parse(Buffer.from(token, 'base64').toString('utf-8'));
        } catch (e) {
            return res.status(400).json({ status: "ERROR", message: "Invalid verify token" });
        }

        const txns = await fetchBharatPeTransactions(order.merchant_id, order.merchant_token, order.cookie);
        const checkAmount = parseFloat(order.amount);

        for (const t of txns) {
            const txnAmount = parseFloat(t.amount || t.txnAmount || 0);
            const statusUpper = String(t.status || t.txnStatus || '').toUpperCase();

            if (Math.abs(txnAmount - checkAmount) < 0.01 && ['SUCCESS', 'COMPLETED', 'SETTLED'].includes(statusUpper)) {
                const utr = t.bankReferenceNo || t.transactionId || t.bankRefNo || 'N/A';
                const txnId = 'BP-TXN-' + Math.floor(100000 + Math.random() * 900000);
                const payerName = t.payerName || 'Verified Payer';

                // Signed Webhook trigger (agar configured ho)
                if (order.webhook_url) {
                    dispatchSignedWebhook(order, utr, txnId, payerName);
                }

                return res.json({
                    status: "SUCCESS",
                    amount: txnAmount,
                    utr: utr,
                    txn_id: txnId,
                    payer_name: payerName
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

// =========================================================================
// 3. LEGACY ENDPOINT: /api/check (Purani integrations ke backward compatibility ke liye)
// =========================================================================
app.get('/api/check', async (req, res) => {
    const { merchantId, token, cookie, amount } = req.query;

    if (!merchantId || !token || !cookie) {
        return res.status(400).json({
            status: "ERROR",
            message: "Missing parameters: 'merchantId', 'token', and 'cookie' are required."
        });
    }

    try {
        const txns = await fetchBharatPeTransactions(merchantId, token, cookie);
        const checkAmount = parseFloat(amount);

        // Open QR Mode (agar amount missing ya 0 ho)
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

// =========================================================================
// 4. SIGNED WEBHOOK DISPATCHER (HMAC-SHA256)
// =========================================================================
async function dispatchSignedWebhook(order, utr, txnId, payerName) {
    const payload = {
        event: 'order.paid',
        data: {
            order_uid: order.order_uid,
            amount: String(order.amount),
            utr: utr,
            txn_id: txnId,
            merchant: order.merchant_id,
            payer_name: payerName,
            status: 'COMPLETED'
        },
        created: new Date().toISOString()
    };

    const rawBody = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', order.secret).update(rawBody).digest('hex');

    try {
        await axios.post(order.webhook_url, payload, {
            headers: {
                'Content-Type': 'application/json',
                'X-Gateway-Event': 'order.paid',
                'X-Gateway-Signature': `sha256=${signature}`
            },
            timeout: 5000
        });
    } catch (e) {
        // Log locally if customer endpoint fails
    }
}

app.get('/', (req, res) => {
    res.send("BharatPe Enterprise Gateway Engine Live!");
});

module.exports = app;
