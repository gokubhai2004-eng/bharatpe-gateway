const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// MongoDB Models
const Merchant = mongoose.models.Merchant || mongoose.model('Merchant', new mongoose.Schema({
    userId: { type: Number, unique: true },
    apiKey: { type: String, unique: true },
    merchantId: String,
    upiId: String,
    token: String,
    cookie: String,
    step: { type: String, default: 'IDLE' }
}));

const Order = mongoose.models.Order || mongoose.model('Order', new mongoose.Schema({
    orderId: { type: String, unique: true },
    apiKey: String,
    amount: Number,
    status: { type: String, default: 'PENDING' },
    createdAt: { type: Date, default: Date.now },
    expiresAt: Date,
    utr: String
}));

// DB Connection Helper
async function connectDB() {
    if (mongoose.connection.readyState === 0) {
        await mongoose.connect(process.env.MONGO_URI);
    }
}

// Telegram Message Helper
async function sendTgMessage(chatId, text, replyMarkup = null) {
    const url = `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`;
    const payload = { chat_id: chatId, text: text, parse_mode: 'HTML' };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    await axios.post(url, payload).catch(err => console.error(err.message));
}

// -------------------------------------------------------------
// 1. TELEGRAM BOT WEBHOOK (Step-by-Step Setup)
// -------------------------------------------------------------
app.post('/api/webhook', async (req, res) => {
    await connectDB();
    const update = req.body;
    if (!update || !update.message) return res.send('OK');

    const chatId = update.message.chat.id;
    const text = update.message.text ? update.message.text.trim() : '';

    let user = await Merchant.findOne({ userId: chatId });
    if (!user) {
        user = new Merchant({ userId: chatId, step: 'IDLE' });
        await user.save();
    }

    if (text === '/start') {
        user.step = 'IDLE';
        await user.save();
        const keyboard = {
            keyboard: [[{ text: '⚙️ SETUP BHARATPE GATEWAY' }]],
            resize_keyboard: true
        };
        await sendTgMessage(chatId, '👋 <b>Welcome to BharatPe Gateway Creator!</b>\n\nNiche diye button par tap karke apna gateway setup karein.', keyboard);
        return res.send('OK');
    }

    if (text === '⚙️ SETUP BHARATPE GATEWAY') {
        user.step = 'AWAITING_MERCHANT_ID';
        await user.save();
        await sendTgMessage(chatId, '👉 <b>Step 1/4:</b> Apna <b>BharatPe Merchant ID</b> bhejein:\n\n<i>(Example: 12345678)</i>');
        return res.send('OK');
    }

    if (user.step === 'AWAITING_MERCHANT_ID') {
        user.merchantId = text;
        user.step = 'AWAITING_UPI_ID';
        await user.save();
        await sendTgMessage(chatId, '👉 <b>Step 2/4:</b> Apni <b>BharatPe UPI ID</b> bhejein:\n\n<i>(Example: username@yesbankltd)</i>');
        return res.send('OK');
    }

    if (user.step === 'AWAITING_UPI_ID') {
        user.upiId = text;
        user.step = 'AWAITING_TOKEN';
        await user.save();
        await sendTgMessage(chatId, '👉 <b>Step 3/4:</b> Apna <b>BharatPe Token</b> paste karein:');
        return res.send('OK');
    }

    if (user.step === 'AWAITING_TOKEN') {
        user.token = text;
        user.step = 'AWAITING_COOKIE';
        await user.save();
        await sendTgMessage(chatId, '👉 <b>Step 4/4:</b> Apni <b>BharatPe Cookie</b> paste karein:');
        return res.send('OK');
    }

    if (user.step === 'AWAITING_COOKIE') {
        user.cookie = text;
        user.apiKey = 'key_' + crypto.randomBytes(6).toString('hex');
        user.step = 'IDLE';
        await user.save();

        const host = req.headers.host;
        const msg = `🎉 <b>Gateway Setup Successful!</b>\n\n` +
                    `🔑 <b>API Key:</b>\n<code>${user.apiKey}</code>\n\n` +
                    `━━━━━━━━━━━━━━━━━━━\n` +
                    `🌐 <b>Checkout Page (10m Expiry + Auto Detect):</b>\n` +
                    `<code>https://${host}/pay?api_key=${user.apiKey}&amount=100</code>\n\n` +
                    `━━━━━━━━━━━━━━━━━━━\n` +
                    `⚙️ <b>Check Order Status API:</b>\n` +
                    `<code>https://${host}/api/order/check?order_id=ORDER_ID</code>`;

        await sendTgMessage(chatId, msg);
        return res.send('OK');
    }

    return res.send('OK');
});

// -------------------------------------------------------------
// 2. CHECKOUT PAGE (Dynamic QR + 10-Min Timer + Auto Detection)
// -------------------------------------------------------------
app.get('/pay', async (req, res) => {
    await connectDB();
    const { api_key, amount } = req.query;

    if (!api_key || !amount) return res.status(400).send('Missing api_key or amount');

    const merchant = await Merchant.findOne({ apiKey: api_key });
    if (!merchant) return res.status(401).send('Invalid API Key');

    const orderId = 'ORD' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await Order.create({
        orderId,
        apiKey: api_key,
        amount: parseFloat(amount),
        expiresAt
    });

    const upiIntent = `upi://pay?pa=${merchant.upiId}&pn=Merchant&am=${amount}&cu=INR&tn=${orderId}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(upiIntent)}`;

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Fast UPI Checkout</title>
        <style>
            body { font-family: -apple-system, sans-serif; background: #0f172a; color: #fff; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
            .box { background: #1e293b; padding: 25px; border-radius: 16px; width: 90%; max-width: 350px; text-align: center; }
            .amt { font-size: 28px; font-weight: bold; color: #38bdf8; margin: 10px 0; }
            .qr { background: #fff; padding: 12px; border-radius: 10px; display: inline-block; }
            .qr img { width: 200px; height: 200px; display: block; }
            .timer { color: #f87171; font-weight: bold; margin-bottom: 12px; }
            .btn { display: block; background: #2563eb; color: #fff; text-decoration: none; padding: 12px; border-radius: 8px; margin-top: 15px; font-weight: bold; }
        </style>
    </head>
    <body>
        <div class="box" id="card">
            <h3>Scan & Pay</h3>
            <div class="amt">₹${amount}</div>
            <div class="timer" id="t">Time Left: 10:00</div>
            <div class="qr"><img src="${qrUrl}"></div>
            <p id="msg" style="color:#94a3b8; font-size: 13px;">Checking payment automatically...</p>
            <a href="${upiIntent}" class="btn">Open UPI App</a>
        </div>
        <script>
            let sec = 600;
            const tElem = document.getElementById('t');
            const timer = setInterval(() => {
                if (sec <= 0) {
                    clearInterval(timer);
                    document.getElementById('card').innerHTML = '<h2 style="color:#f87171">QR Expired!</h2><p>Please initiate again.</p>';
                } else {
                    let m = Math.floor(sec / 60);
                    let s = sec % 60;
                    tElem.innerText = 'Time Left: ' + m + ':' + (s < 10 ? '0' : '') + s;
                    sec--;
                }
            }, 1000);

            const check = setInterval(async () => {
                if (sec <= 0) return clearInterval(check);
                try {
                    let r = await fetch('/api/order/check?order_id=${orderId}');
                    let d = await r.json();
                    if (d.status === 'COMPLETED') {
                        clearInterval(check);
                        clearInterval(timer);
                        document.getElementById('card').innerHTML = '<h2 style="color:#4ade80">✅ Payment Received!</h2><p>UTR: ' + d.utr + '</p><p>Amount: ₹' + d.amount + '</p>';
                    }
                } catch(e) {}
            }, 4000);
        </script>
    </body>
    </html>`;

    res.send(html);
});

// -------------------------------------------------------------
// 3. AUTO-DETECT BHARATPE STATUS API
// -------------------------------------------------------------
app.get('/api/order/check', async (req, res) => {
    await connectDB();
    const { order_id } = req.query;

    const order = await Order.findOne({ orderId: order_id });
    if (!order) return res.status(404).json({ status: 'NOT_FOUND' });

    if (order.status === 'COMPLETED') {
        return res.json({ status: 'COMPLETED', utr: order.utr, amount: order.amount });
    }

    if (new Date() > new Date(order.expiresAt)) {
        order.status = 'EXPIRED';
        await order.save();
        return res.json({ status: 'EXPIRED' });
    }

    const merchant = await Merchant.findOne({ apiKey: order.apiKey });
    if (!merchant) return res.status(500).json({ status: 'ERROR' });

    try {
        const bpeUrl = `https://payments-tesseract.bharatpe.in/api/v1/merchant/transactions?merchantId=${merchant.merchantId}&limit=15`;
        const resp = await axios.get(bpeUrl, {
            headers: {
                token: merchant.token,
                Cookie: merchant.cookie,
                'User-Agent': 'Mozilla/5.0'
            },
            timeout: 5000
        });

        const txns = resp.data?.data?.transactions || [];
        for (const t of txns) {
            if (parseFloat(t.amount) === order.amount && (t.status || '').toUpperCase() === 'SUCCESS') {
                order.status = 'COMPLETED';
                order.utr = t.bankReferenceNo || 'N/A';
                await order.save();
                return res.json({ status: 'COMPLETED', utr: order.utr, amount: order.amount });
            }
        }
    } catch (e) {}

    return res.json({ status: 'PENDING' });
});

module.exports = app;
