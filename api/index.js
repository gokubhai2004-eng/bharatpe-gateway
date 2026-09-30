const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// ==========================================
// AAPKI VERIFIED BHARATPE DETAILS
// ==========================================
const MY_CONFIG = {
    merchantId: "67978226",
    upiId: "BHARATPE.9K0O0W0A8H734919@unitype",
    token: "e1166dc3665a462997e43c6a6b87154d",
    cookie: "eyJpdiI6ImpWaEg3d004ck5UeWNzcUtrUDM2dFE9PSIsInZhbHVlIjoiZmYxOU9cL1I4d2JFQWdqelVWeHh2UFRERXBxbTVYWSs4U0FwbGNRSHREeGlva2pmSng0dWljNzcwTnpsaTZ5SlwvODhwbFNRR0J4ZXlETTJwb0pjOXVDbFdrUTlqcWI4bnNvMmFWS1A3S0Z0bUthQnlkVjdQTWl6VmFueVE4WDJaNiIsIm1hYyI6IjIzZjhlZDAwMDZiNjY4Mjg4NmZlNzk0YWI3YmYyMjFhYjQzZjJmZmM5YmY0NmQ1YTVkMzRkN2E0ZWYwN2VmNzEifQ=="
};

// In-memory active payments tracker
const orders = {};

// ------------------------------------------
// 1. CHECKOUT UI (QR + 10-MIN TIMER + AUTO DETECT)
// ------------------------------------------
app.get('/pay', (req, res) => {
    const amount = req.query.amount;
    if (!amount) {
        return res.status(400).send("Amount missing! Use format: /pay?amount=100");
    }

    const orderId = 'ORD' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const expiresAt = Date.now() + 10 * 60 * 1000;

    orders[orderId] = {
        amount: parseFloat(amount),
        status: 'PENDING',
        expiresAt: expiresAt
    };

    const upiIntent = `upi://pay?pa=${MY_CONFIG.upiId}&pn=Merchant&am=${amount}&cu=INR&tn=${orderId}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(upiIntent)}`;

    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Fast UPI Checkout</title>
        <style>
            * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
            body { background: #0b0f19; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 15px; }
            .card { background: #1e293b; border: 1px solid #334155; border-radius: 20px; padding: 25px; width: 100%; max-width: 360px; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.4); }
            .badge { display: inline-block; background: #0284c7; color: #fff; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 20px; margin-bottom: 10px; }
            .amount { font-size: 36px; font-weight: 800; color: #38bdf8; margin-bottom: 6px; }
            .timer { font-size: 13px; font-weight: 600; color: #f87171; margin-bottom: 14px; }
            .qr-wrap { background: #ffffff; padding: 12px; border-radius: 12px; display: inline-block; }
            .qr-wrap img { width: 200px; height: 200px; display: block; }
            .status-text { margin-top: 14px; font-size: 13px; color: #94a3b8; }
            .btn { display: block; margin-top: 15px; background: #2563eb; color: #ffffff; font-weight: 700; text-decoration: none; padding: 12px; border-radius: 8px; font-size: 14px; }
        </style>
    </head>
    <body>
        <div class="card" id="card">
            <div class="badge">UPI AUTO VERIFY</div>
            <div class="amount">₹${amount}</div>
            <div class="timer" id="t">Expires in: 10:00</div>
            <div class="qr-wrap"><img src="${qrUrl}" alt="QR"></div>
            <div class="status-text" id="status">Waiting for payment...</div>
            <a href="${upiIntent}" class="btn">Pay via UPI App</a>
        </div>

        <script>
            let sec = 600;
            const t = document.getElementById('t');
            const timer = setInterval(() => {
                if (sec <= 0) {
                    clearInterval(timer);
                    document.getElementById('card').innerHTML = '<h2 style="color:#f87171; margin-bottom:8px;">Expired</h2><p style="color:#94a3b8;">Please create a new link.</p>';
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
                    const res = await fetch('/api/check?order_id=${orderId}');
                    const data = await res.json();
                    if (data.status === 'COMPLETED') {
                        clearInterval(checker);
                        clearInterval(timer);
                        document.getElementById('card').innerHTML = '<h2 style="color:#4ade80;font-size:24px;margin-bottom:12px;">✅ Payment Successful!</h2><p style="color:#cbd5e1;font-size:15px;margin-bottom:6px;"><b>Amount:</b> ₹' + data.amount + '</p><p style="color:#cbd5e1;font-size:13px;"><b>UTR:</b> ' + data.utr + '</p>';
                    }
                } catch(e) {}
            }, 3500);
        </script>
    </body>
    </html>
    `;

    res.send(html);
});

// ------------------------------------------
// 2. AUTO VERIFY ENGINE (BharatPe Sync)
// ------------------------------------------
app.get('/api/check', async (req, res) => {
    const { order_id } = req.query;
    const order = orders[order_id];

    if (!order) return res.status(404).json({ status: 'NOT_FOUND' });
    if (order.status === 'COMPLETED') return res.json(order);

    if (Date.now() > order.expiresAt) {
        order.status = 'EXPIRED';
        return res.json({ status: 'EXPIRED' });
    }

    try {
        const bpeUrl = `https://payments-tesseract.bharatpe.in/api/v1/merchant/transactions?merchantId=${MY_CONFIG.merchantId}&limit=10`;
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
                return res.json(order);
            }
        }
    } catch (err) {}

    return res.json({ status: 'PENDING' });
});

module.exports = app;
