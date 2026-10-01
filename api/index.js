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
// 1. DUAL-MODE ENDPOINT: /checkout/create (Fixed + Open QR)
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

        const targetUpi = upi_id || 'BHARATPE.9K0O0W0A8H734919@unitype';
        const orderUid = 'BP-' + Math.random().toString(36).substring(2, 9).toUpperCase();

        const inputAmt = parseFloat(amount || 0);
        const isOpenMode = !inputAmt || isNaN(inputAmt) || inputAmt <= 0;

        let finalAmount = null;
        let upiUri = '';

        if (isOpenMode) {
            // Open Mode: Bina amount ka generic QR
            upiUri = `upi://pay?pa=${targetUpi}&pn=Merchant&cu=INR`;
        } else {
            // Fixed Mode: 0.01 se lekar 0.50 tak paise add karega (e.g. 1.03, 1.25)
            const randomPaise = (Math.floor(Math.random() * 50) + 1) / 100;
            finalAmount = (inputAmt + randomPaise).toFixed(2);
            upiUri = `upi://pay?pa=${targetUpi}&pn=Merchant&am=${finalAmount}&cu=INR`;
        }

        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(upiUri)}`;

        // Stateless Token Payload (Zero Database Required)
        const tokenPayload = {
            order_uid: orderUid,
            mode: isOpenMode ? 'OPEN' : 'FIXED',
            amount: finalAmount ? parseFloat(finalAmount) : null,
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
            mode: isOpenMode ? 'OPEN' : 'FIXED',
            order_uid: orderUid,
            pay_url: `https://${req.headers.host}/pay/${orderUid}`,
            amount: finalAmount || 'OPEN',
            qr_url: qrUrl,
            upi_uri: upiUri,
            upi_id: targetUpi,
            amount_charged: finalAmount || 'USER_CHOICE',
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
// 2. DUAL-MODE ENDPOINT: /checkout/verify (Polling + Webhook Dispatch)
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

        for (const t of txns) {
            const txnAmount = parseFloat(t.amount || t.txnAmount || 0);
            const statusUpper = String(t.status || t.txnStatus || '').toUpperCase();

            // Transaction timestamp validation (Fresh payment check)
            const txnTime = new Date(t.paymentTimestamp || t.transactionTime || t.createdAt || Date.now()).getTime();
            const isFresh = txnTime >= (order.created_at - 60000);

            if (['SUCCESS', 'COMPLETED', 'SETTLED'].includes(statusUpper) && txnAmount > 0) {
                let isMatched = false;

                if (order.mode === 'FIXED') {
                    // Exact 0.01 - 0.50 decimal match
                    if (Math.abs(txnAmount - order.amount) < 0.01) {
                        isMatched = true;
                    }
                } else if (order.mode === 'OPEN' && isFresh) {
                    // Open mode me recent fresh payment match
                    isMatched = true;
                }

                if (isMatched) {
                    const utr = t.bankReferenceNo || t.transactionId || t.bankRefNo || 'N/A';
                    const txnId = 'BP-TXN-' + Math.floor(100000 + Math.random() * 900000);
                    const payerName = t.payerName || 'Verified Payer';

                    // Signed Webhook trigger (agar configured ho)
                    if (order.webhook_url) {
                        dispatchSignedWebhook(order, txnAmount, utr, txnId, payerName);
                    }

                    return res.json({
                        status: "SUCCESS",
                        mode: order.mode,
                        amount: txnAmount,
                        utr: utr,
                        txn_id: txnId,
                        payer_name: payerName
                    });
                }
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
async function dispatchSignedWebhook(order, paidAmount, utr, txnId, payerName) {
    const payload = {
        event: 'order.paid',
        data: {
            order_uid: order.order_uid,
            mode: order.mode,
            amount: String(paidAmount),
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
        // Safe fail
    }
}

app.get('/', (req, res) => {
    res.send("BharatPe Dual Enterprise Engine Live!");
});

module.exports = app;
