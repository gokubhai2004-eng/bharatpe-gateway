const crypto = require('crypto');
const axios = require('axios');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const url = new URL(req.url, `https://${req.headers.host}`);
    const pathname = url.pathname;

    // =========================================================================
    // 1. ENDPOINT: /checkout/create
    // =========================================================================
    if ((pathname === '/checkout/create' || pathname === '/api/create') && req.method === 'POST') {
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
                return res.status(400).json({ ok: false, error: 'Amount is required' });
            }

            // Conflict-free decimal calculation (e.g., 349.42)
            const baseAmt = parseFloat(amount);
            const randomPaise = (Math.floor(Math.random() * 89) + 10) / 100;
            const finalAmount = (baseAmt + randomPaise).toFixed(2);

            const orderUid = 'BP-' + Math.random().toString(36).substring(2, 9).toUpperCase();
            const targetUpi = upi_id || 'BHARATPE.9K0O0W0A8H734919@unitype';
            const upiUri = `upi://pay?pa=${targetUpi}&pn=Store&am=${finalAmount}&cu=INR`;
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(upiUri)}`;

            // Stateless Token Payload (Zero Database Required)
            const tokenPayload = {
                order_uid: orderUid,
                amount: finalAmount,
                merchant_id: merchant_id || '67978226',
                merchant_token: merchant_token || '',
                cookie: cookie || '',
                webhook_url: webhook_url || null,
                secret: secret || 'whsec_default_secret',
                redirect_url: redirect_url || null,
                upi_id: targetUpi,
                created_at: Date.now()
            };

            const verifyToken = Buffer.from(JSON.stringify(tokenPayload)).toString('base64');

            return res.status(200).json({
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
    }

    // =========================================================================
    // 2. ENDPOINT: /checkout/verify (Polling & Webhook Push)
    // =========================================================================
    if ((pathname === '/checkout/verify' || pathname === '/api/verify') && req.method === 'POST') {
        try {
            const token = req.body.t || req.query.t;
            if (!token) {
                return res.status(400).json({ status: 'ERROR', message: 'Token missing' });
            }

            let order;
            try {
                order = JSON.parse(Buffer.from(token, 'base64').toString('utf-8'));
            } catch (e) {
                return res.status(400).json({ status: 'ERROR', message: 'Invalid verify token' });
            }

            // Direct BharatPe Settlement API Ledger Hit
            const bpApiUrl = `https://merchant.bharatpe.com/api/v1/merchants/${order.merchant_id}/transactions?module=PAYMENT_QR`;
            const bpRes = await axios.get(bpApiUrl, {
                headers: {
                    'token': order.merchant_token,
                    'Cookie': order.cookie,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
                },
                timeout: 6000
            }).catch(() => null);

            if (bpRes && bpRes.data && bpRes.data.data) {
                const txns = bpRes.data.data.transactions || [];
                const matched = txns.find(tx => parseFloat(tx.amount).toFixed(2) === order.amount);

                if (matched) {
                    const utr = matched.bankReferenceNo || matched.utr || '423901782341';
                    const payerName = matched.payerName || 'Verified Payer';
                    const txnId = 'BP-TXN-' + Math.floor(100000 + Math.random() * 900000);

                    // Webhook Push if URL is present
                    if (order.webhook_url) {
                        dispatchSignedWebhook(order, utr, txnId, payerName);
                    }

                    return res.status(200).json({
                        status: 'SUCCESS',
                        amount: order.amount,
                        utr: utr,
                        txn_id: txnId,
                        payer_name: payerName
                    });
                }
            }

            return res.status(200).json({ status: 'PENDING' });
        } catch (err) {
            return res.status(500).json({ status: 'ERROR', error: err.message });
        }
    }

    return res.status(404).json({ error: 'Endpoint Not Found' });
};

// =============================================================================
// HMAC SHA-256 SIGNED WEBHOOK DISPATCHER
// =============================================================================
async function dispatchSignedWebhook(order, utr, txnId, payerName) {
    const payload = {
        event: 'order.paid',
        data: {
            order_uid: order.order_uid,
            amount: order.amount,
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
        // Log locally if merchant webhook fails
    }
}
