const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// AAPKI BHARATPE DETAILS
const MY_CONFIG = {
    merchantId: "67978226",
    upiId: "BHARATPE.9K0O0W0A8H734919@unitype",
    token: "e1166dc3665a462997e43c6a6b87154d",
    cookie: "eyJpdiI6ImpWaEg3d004ck5UeWNzcUtrUDM2dFE9PSIsInZhbHVlIjoiZmYxOU9cL1I4d2JFQWdqelVWeHh2UFRERXBxbTVYWSs4U0FwbGNRSHREeGlva2pmSng0dWljNzcwTnpsaTZ5SlwvODhwbFNRR0J4ZXlETTJwb0pjOXVDbFdrUTlqcWI4bnNvMmFWS1A3S0Z0bUthQnlkVjdQTWl6VmFueVE4WDJaNiIsIm1hYyI6IjIzZjhlZDAwMDZiNjY4Mjg4NmZlNzk0YWI3YmYyMjFhYjQzZjJmZmM5YmY0NmQ1YTVkMzRkN2E0ZWYwN2VmNzEifQ=="
};

// Orders memory
const orders = {};

// ----------------------------------------------------
// 1. JSON API: CREATE ORDER (QR + Intent link generate)
// ----------------------------------------------------
app.get('/api/create-order', (req, res) => {
    const amount = req.query.amount;
    if (!amount) {
        return res.status(400).json({ status: "error", message: "amount is required. Example: ?amount=100" });
    }

    const orderId = 'ORD' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes expiry

    const upiIntent = `upi://pay?pa=${MY_CONFIG.upiId}&pn=Merchant&am=${amount}&cu=INR&tn=${orderId}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(upiIntent)}`;

    orders[orderId] = {
        order_id: orderId,
        amount: parseFloat(amount),
        status: 'PENDING',
        expires_at: expiresAt,
        created_at: Date.now()
    };

    return res.json({
        status: "success",
        order_id: orderId,
        amount: parseFloat(amount),
        upi_id: MY_CONFIG.upiId,
        upi_intent: upiIntent,
        qr_url: qrUrl,
        expires_in_seconds: 600,
        checkout_page: `https://${req.headers.host}/pay?order_id=${orderId}`
    });
});

// ----------------------------------------------------
// 2. JSON API: CHECK STATUS (Auto-detect + Expire check)
// ----------------------------------------------------
app.get('/api/check', async (req, res) => {
    const { order_id } = req.query;
    const order = orders[order_id];

    if (!order) {
        return res.status(404).json({ status: "NOT_FOUND", message: "Invalid order ID" });
    }

    // Already completed
    if (order.status === 'COMPLETED') {
        return res.json({
            status: "COMPLETED",
            order_id: order.order_id,
            amount: order.amount,
            utr: order.utr
        });
    }

    // Expire logic (10 min over)
    if (Date.now() > order.expires_at) {
        order.status = 'EXPIRED';
        return res.json({ status: "EXPIRED", order_id: order.order_id });
    }

    // BharatPe se live check karna
    try {
        const bpeUrl = `https://payments-tesseract.bharatpe.in/api/v1/merchant/transactions?merchantId=${MY_CONFIG.merchantId}&limit=12`;
        const response = await axios.get(bpeUrl, {
            headers: {
                'token': MY_CONFIG.token,
                'Cookie': MY_CONFIG.cookie,
                'User-Agent': 'Mozilla/5.0'
            },
            timeout: 5000
        });

        const txns = response.data?.data?.transactions || [];
        for (const t of txns) {
            if (parseFloat(t.amount) === order.amount && (t.status || '').toUpperCase() === 'SUCCESS') {
                order.status = 'COMPLETED';
                order.utr = t.bankReferenceNo || 'N/A';

                return res.json({
                    status: "COMPLETED",
                    order_id: order.order_id,
                    amount: order.amount,
                    utr: order.utr
                });
            }
        }
    } catch (err) {}

    return res.json({
        status: "PENDING",
        order_id: order.order_id,
        amount: order.amount
    });
});

// ----------------------------------------------------
// 3. HTML CHECKOUT (Agar browser me QR dekhna ho)
// ----------------------------------------------------
app.get('/pay', (req, res) => {
    let order_id = req.query.order_id;
    let order = orders[order_id];

    if (!order) {
        const amount = req.query.amount;
        if (!amount) return res.send("Order not found or amount missing!");
        
        order_id = 'ORD' + crypto.randomBytes(4).toString('hex').toUpperCase();
        order = {
            order_id: order_id,
            amount: parseFloat(amount),
            status: 'PENDING',
            expires_at: Date.now() + 10 * 60 * 1000
        };
        orders[order_id] = order;
    }

    const upiIntent = `upi://pay?pa=${MY_CONFIG.upiId}&pn=Merchant&am=${order.amount}&cu=INR&tn=${order.order_id}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(upiIntent)}`;

    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>UPI Checkout</title>
        <style>
            body { font-family: sans-serif; background: #0f172a; color: #fff; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
            .box { background: #1e293b; padding: 25px; border-radius: 16px; width: 330px; text-align: center; }
            .amt { font-size: 32px; font-weight: bold; color: #38bdf8; margin: 10px 0; }
            .timer { color: #f87171; font-weight: bold; margin-bottom: 12px; }
            .qr img { width: 210px; height: 210px; border-radius: 10px; background: white; padding: 6px; }
            .btn { display: block; background: #2563eb; color: #fff; text-decoration: none; padding: 12px; border-radius: 8px; margin-top: 15px; font-weight: bold; }
        </style>
    </head>
    <body>
        <div class="box" id="card">
            <p>Scan to Pay</p>
            <div class="amt">₹${order.amount}</div>
            <div class="timer" id="t">Expires in: 10:00</div>
            <div class="qr"><img src="${qrUrl}"></div>
            <p id="msg" style="color:#94a3b8; font-size: 13px; margin-top: 10px;">Checking payment status...</p>
            <a href="${upiIntent}" class="btn">Pay via App</a>
        </div>
        <script>
            let sec = Math.max(0, Math.floor((${order.expires_at} - Date.now()) / 1000));
            const t = document.getElementById('t');
            const timer = setInterval(() => {
                if (sec <= 0) {
                    clearInterval(timer);
                    document.getElementById('card').innerHTML = '<h2 style="color:#f87171">QR Expired!</h2>';
                } else {
                    let m = Math.floor(sec / 60);
                    let s = sec % 60;
                    t.innerText = 'Expires in: ' + m + ':' + (s < 10 ? '0' : '') + s;
                    sec--;
                }
            }, 1000);

            const checker = setInterval(async () => {
                if (sec <= 0) return clearInterval(checker);
                try {
                    let r = await fetch('/api/check?order_id=${order.order_id}');
                    let d = await r.json();
                    if(d.status === 'COMPLETED'){
                        clearInterval(checker);
                        clearInterval(timer);
                        document.getElementById('card').innerHTML = '<h2 style="color:#4ade80">✅ Payment Received!</h2><p>UTR: ' + d.utr + '</p>';
                    }
                } catch(e){}
            }, 3000);
        </script>
    </body>
    </html>
    `);
});

module.exports = app;
