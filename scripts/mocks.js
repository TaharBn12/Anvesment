// ============================================================
//  خوادم محاكاة (mocks) — تُستخدم للاختبارات وللعرض الحي:
//  - تلغرام: يستقبل استدعاءات البوت (getUpdates, sendMessage...)
//    ويسمح بحقن تحديثات (updates) كمستخدم حقيقي
//  - NOWPayments: يستجيب لإنشاء الفواتير والاستعلام عنها
//  - واجهة ويب (اختيارية): محاكاة محادثة تلغرام للعرض الحي
// ============================================================
import express from 'express';

const TG_METHODS_OK = ['deleteMessage', 'answerCallbackQuery', 'editMessageReplyMarkup'];

export function startMocks(options = {}) {
  const telegramPort = options.telegramPort ?? 0;
  const nowpaymentsPort = options.nowpaymentsPort ?? 0;
  const host = options.host ?? '127.0.0.1';

  return new Promise((resolveStart) => {
    // ===================== Mock Telegram =====================
    const tgApp = express();
    tgApp.use(express.json({ limit: '10mb' }));

    const tg = {
      sent: [],        // كل استدعاءات API الصادرة من البوت
      polls: 0,        // عدد استدعاءات getUpdates
      updates: [],     // التحديثات المنتظرة
      waiters: [],     // طلبات getUpdates المعلّقة (long polling)
      lastUpdateId: 0,
      chatLog: [],     // سجل المحادثة الموحّد (للواجهة)
      chatCursor: 0,
      invoices: null,
    };

    const pushChat = (entry) => {
      tg.chatCursor += 1;
      tg.chatLog.push({ id: tg.chatCursor, time: new Date().toISOString(), ...entry });
      if (tg.chatLog.length > 500) tg.chatLog.splice(0, tg.chatLog.length - 500);
    };

    // استهلاك جسم الطلبات متعددة الأجزاء (multipart) واستخراج التعليق والصور
    tgApp.use((req, res, next) => {
      const ct = String(req.headers['content-type'] || '');
      if (!ct.includes('multipart/form-data')) return next();
      const chunks = [];
      req.on('data', (c) => chunks.push(Buffer.from(c)));
      req.on('end', () => {
        const buf = Buffer.concat(chunks);
        const bMatch = ct.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
        const boundary = bMatch ? (bMatch[1] || bMatch[2]) : null;
        req.body = {};
        if (!boundary) return next();
        const extractText = (name) => {
          const idx = buf.indexOf(Buffer.from(`name="${name}"`));
          if (idx === -1) return undefined;
          const he = buf.indexOf('\r\n\r\n', idx);
          if (he === -1) return undefined;
          const ps = he + 4;
          const ne = buf.indexOf(`\r\n--${boundary}`, ps);
          return ne === -1 ? undefined : buf.slice(ps, ne).toString('utf8');
        };
        const extractBinary = (name) => {
          const idx = buf.indexOf(Buffer.from(`name="${name}"`));
          if (idx === -1) return undefined;
          const he = buf.indexOf('\r\n\r\n', idx);
          if (he === -1) return undefined;
          const ps = he + 4;
          const ne = buf.indexOf(`\r\n--${boundary}`, ps);
          return ne === -1 ? undefined : buf.slice(ps, ne);
        };
        req.body.caption = extractText('caption');
        req.body.chat_id = extractText('chat_id');
        req.body.filename = extractText('filename');
        const photo = extractBinary('photo');
        if (photo) req.body.photo = photo.toString('base64');
        const document = extractBinary('document');
        if (document) req.body.document = document.toString('base64');
        next();
      });
      req.on('error', () => next());
    });

    // نمط الرابط الفعلي: /bot<token>/<method>
    tgApp.use((req, res, next) => {
      const match = req.path.match(/^\/bot[^/]+\/(\w+)$/);
      if (!match) return next();
      const method = match[1];
      const body = req.method === 'GET' ? req.query : (req.body || {});
      const now = Math.floor(Date.now() / 1000);

      if (method === 'getUpdates') {
        tg.polls++;
        const offset = Number(body.offset ?? 0);
        const available = tg.updates.filter((u) => u.update_id >= offset);
        if (available.length > 0) {
          return res.json({ ok: true, result: available.slice(0, 50) });
        }
        const timer = setTimeout(() => {
          tg.waiters = tg.waiters.filter((w) => w !== waiter);
          res.json({ ok: true, result: [] });
        }, 3000);
        const waiter = (u) => {
          clearTimeout(timer);
          res.json({ ok: true, result: [u] });
        };
        tg.waiters.push(waiter);
        return;
      }

      // تسجيل كل رسالة صادرة من البوت
      if (!TG_METHODS_OK.includes(method)) {
        tg.sent.push({ method, body, at: now });
        const keyboard = body.reply_markup?.inline_keyboard
          ? body.reply_markup.inline_keyboard.flat().map((b) => ({ text: b.text, data: b.callback_data }))
          : body.reply_markup?.keyboard
            ? body.reply_markup.keyboard.flat().map((t) => ({ text: t, data: t }))
            : undefined;
        if (method === 'sendMessage' || method === 'sendPhoto' || method === 'sendDocument') {
          pushChat({
            from: 'bot',
            text: body.caption || body.text || '',
            photo: body.photo,
            document: body.document ? { name: body.filename || 'ملف' } : undefined,
            keyboard,
          });
        }
      }

      switch (method) {
        case 'getMe':
          return res.json({
            ok: true,
            result: { id: 42, is_bot: true, first_name: 'بوت الاختبار', username: 'test_invest_bot' },
          });
        case 'sendMessage':
          return res.json({
            ok: true,
            result: { message_id: tg.sent.length, date: now, chat: { id: body.chat_id }, text: body.text },
          });
        case 'sendPhoto':
          return res.json({
            ok: true,
            result: { message_id: tg.sent.length, date: now, chat: { id: body.chat_id }, photo: [] },
          });
        case 'sendDocument':
          return res.json({
            ok: true,
            result: { message_id: tg.sent.length, date: now, chat: { id: body.chat_id }, document: {} },
          });
        case 'answerCallbackQuery':
          return res.json({ ok: true, result: true });
        case 'editMessageText':
          return res.json({
            ok: true,
            result: { message_id: body.message_id, date: now, chat: { id: body.chat_id }, text: body.text },
          });
        case 'deleteMessage':
          return res.json({ ok: true, result: true });
        default:
          return res.json({ ok: true, result: true });
      }
    });

    // ===================== Mock NOWPayments =====================
    const npApp = express();
    npApp.use(express.json());

    const np = { invoices: new Map(), payouts: [], counter: 5000 };

    npApp.get('/v1/status', (req, res) => res.json({ message: 'OK' }));
    npApp.get('/v1/currencies', (req, res) =>
      res.json({ currencies: ['usdttrc20', 'usdtbsc', 'usdterc20', 'usdcerc20', 'trx', 'btc', 'eth', 'ltc'] })
    );
    npApp.get('/v1/min-amount', (req, res) => res.json({ min_amount: 1 }));
    npApp.get('/v1/estimate', (req, res) => {
      const amount = Number(req.query.amount ?? 0);
      res.json({ estimated_amount: Number((amount * 1.01).toFixed(6)) });
    });
    npApp.post('/v1/invoice', (req, res) => {
      const id = String(++np.counter);
      const invoice = {
        id,
        order_id: req.body.order_id,
        order_description: req.body.order_description,
        price_amount: req.body.price_amount,
        price_currency: req.body.price_currency || 'usd',
        pay_currency: req.body.pay_currency,
        pay_amount: Number((Number(req.body.price_amount) * 1.01).toFixed(6)),
        pay_address: `TMockDeposit${id}TRONaddressABCDEF`,
        invoice_url: `https://nowpayments.io/invoice/${id}`,
        payment_status: 'waiting',
        actually_paid: '0',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      np.invoices.set(id, invoice);
      res.json(invoice);
    });
    npApp.get('/v1/invoice/:id', (req, res) => {
      const inv = np.invoices.get(req.params.id);
      if (!inv) return res.status(404).json({ message: 'invoice not found' });
      res.json(inv);
    });
    npApp.post('/v1/auth', (req, res) => res.json({ token: 'mock-jwt-token', expires_in: 3600 }));
    npApp.post('/v1/payout', (req, res) => {
      const payout = { id: `po_${Date.now()}`, ...req.body, status: 'pending' };
      np.payouts.push(payout);
      res.json(payout);
    });
    npApp.post('/_test/invoice/:id/status', (req, res) => {
      const inv = np.invoices.get(req.params.id);
      if (!inv) return res.status(404).json({ message: 'not found' });
      if (req.body.payment_status) inv.payment_status = req.body.payment_status;
      if (req.body.actually_paid) inv.actually_paid = req.body.actually_paid;
      inv.updated_at = new Date().toISOString();
      res.json(inv);
    });

    // ===================== واجهة المحاكاة (ويب) =====================
    // تُحاكي واجهة تلغرام: محادثة + أزرار + لوحة NOWPayments التجريبية
    const WEB_USER = options.webUserId ?? 555;

    tgApp.get('/', (req, res) => res.type('html').send(chatPageHtml()));
    tgApp.get('/health', (req, res) => res.json({ ok: true, service: 'mock-telegram' }));

    // استقبال رسالة من "المستخدم"
    tgApp.post('/api/send', (req, res) => {
      const text = String(req.body?.text ?? '').slice(0, 500);
      if (!text.trim()) return res.status(400).json({ error: 'empty' });
      const entities = text.startsWith('/')
        ? [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }]
        : undefined;
      const update = {
        update_id: ++tg.lastUpdateId,
        message: {
          message_id: ++tg.lastUpdateId, from: { id: WEB_USER, is_bot: false, first_name: 'أنت', username: 'demo' },
          chat: { id: WEB_USER, type: 'private' }, date: Math.floor(Date.now() / 1000), text,
          ...(entities ? { entities } : {}),
        },
      };
      tg.updates.push(update);
      pushChat({ from: 'user', text });
      const waiters = tg.waiters.slice();
      tg.waiters = [];
      waiters.forEach((w) => w(update));
      res.json({ ok: true });
    });

    // استقبال ضغطة زر
    tgApp.post('/api/callback', (req, res) => {
      const data = String(req.body?.data ?? '');
      const label = String(req.body?.label ?? data);
      if (!data) return res.status(400).json({ error: 'empty' });
      const update = {
        update_id: ++tg.lastUpdateId,
        callback_query: {
          id: `cb${++tg.lastUpdateId}`,
          from: { id: WEB_USER, is_bot: false, first_name: 'أنت', username: 'demo' },
          message: { message_id: ++tg.lastUpdateId, chat: { id: WEB_USER, type: 'private' }, date: Math.floor(Date.now() / 1000), text: '—' },
          data,
        },
      };
      tg.updates.push(update);
      pushChat({ from: 'user', text: `🔘 ${label}` });
      const waiters = tg.waiters.slice();
      tg.waiters = [];
      waiters.forEach((w) => w(update));
      res.json({ ok: true });
    });

    // جلب رسائل المحادثة بعد مؤشر معين
    tgApp.get('/api/poll', (req, res) => {
      const since = Number(req.query.since ?? 0);
      res.json({ messages: tg.chatLog.filter((m) => m.id > since), cursor: tg.chatCursor });
    });

    // لوحة NOWPayments التجريبية: قائمة الفواتير المعلّقة
    tgApp.get('/api/invoices', (req, res) => {
      res.json({ invoices: [...np.invoices.values()] });
    });

    // محاكاة دفع فاتورة + إرسال إشعار IPN حقيقي للبوت
    tgApp.post('/api/simulate-payment', async (req, res) => {
      const invoiceId = String(req.body?.invoiceId ?? '');
      const status = String(req.body?.status ?? 'finished');
      const inv = np.invoices.get(invoiceId);
      if (!inv) return res.status(404).json({ error: 'invoice not found' });
      inv.payment_status = status;
      inv.actually_paid = String(inv.pay_amount);

      // إرسال إشعار IPN موقّع إلى خادم البوت (كما يفعل NOWPayments الحقيقي)
      const ipnPort = options.appWebhookPort;
      if (!ipnPort) return res.json({ ok: true, note: 'no app webhook port configured' });
      const payload = {
        payment_status: status, invoice_id: invoiceId, pay_address: inv.pay_address,
        pay_amount: String(inv.pay_amount), actually_paid: inv.actually_paid,
        pay_currency: inv.pay_currency, price_amount: inv.price_amount,
        price_currency: inv.price_currency, order_id: inv.order_id,
        order_description: inv.order_description, purchase_id: `p_${invoiceId}`,
      };
      const crypto = await import('node:crypto');
      const sorted = (o) => {
        if (o === null || typeof o !== 'object') return JSON.stringify(o);
        return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${sorted(o[k])}`).join(',')}}`;
      };
      const sig = crypto.createHmac('sha512', options.ipnSecret || 'demo_secret').update(sorted(payload)).digest('hex');
      try {
        const r = await fetch(`http://127.0.0.1:${ipnPort}${options.appWebhookPath || '/webhooks/nowpayments'}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-nowpayments-sig': sig },
          body: JSON.stringify(payload),
        });
        res.json({ ok: true, ipnStatus: r.status });
      } catch (err) {
        res.json({ ok: false, error: err.message });
      }
    });

    // ===================== التشغيل =====================
    const tgServer = tgApp.listen(telegramPort, host);
    const npServer = npApp.listen(nowpaymentsPort, '127.0.0.1');
    Promise.all([
      new Promise((r) => tgServer.once('listening', r)),
      new Promise((r) => npServer.once('listening', r)),
    ]).then(() => {
      tg.invoices = np.invoices;
      resolveStart({
        telegram: tg,
        nowpayments: np,
        telegramPort: tgServer.address().port,
        nowpaymentsPort: npServer.address().port,
        close: () => { tgServer.close(); npServer.close(); },
      });
    });
  });
}

/** صفحة واجهة المحاكاة (محادثة على طراز تلغرام) */
function chatPageHtml() {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>بوت الاستثمار — عرض حي</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  body { font-family: -apple-system, "Segoe UI", Tahoma, sans-serif; background: #e7ebf0; height: 100vh; display: flex; flex-direction: column; }
  header { background: #2ea6da; color: #fff; padding: 12px 16px; display: flex; align-items: center; gap: 10px; box-shadow: 0 1px 4px rgba(0,0,0,.2); }
  header .avatar { width: 38px; height: 38px; border-radius: 50%; background: #fff3; display: flex; align-items: center; justify-content: center; font-size: 20px; }
  header .info h1 { font-size: 16px; font-weight: 600; }
  header .info p { font-size: 11px; opacity: .85; }
  #chat { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
  .msg { max-width: 85%; padding: 8px 12px; border-radius: 12px; font-size: 14px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; box-shadow: 0 1px 2px rgba(0,0,0,.12); }
  .msg.user { align-self: flex-start; background: #fff; border-bottom-right-radius: 4px; }
  .msg.bot { align-self: flex-end; background: #dcf8c6; border-bottom-left-radius: 4px; }
  .msg img { max-width: 220px; border-radius: 8px; display: block; margin: 4px 0; }
  .msg .doc { background: #fff; border-radius: 8px; padding: 8px 10px; font-size: 13px; display: inline-flex; gap: 6px; align-items: center; }
  .kb { align-self: flex-end; display: flex; flex-wrap: wrap; gap: 6px; max-width: 90%; margin-top: -4px; }
  .kb button { background: #fff; border: none; border-radius: 8px; padding: 7px 12px; font-size: 13px; color: #2ea6da; font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.12); cursor: pointer; }
  .kb button:active { background: #d4f0ff; }
  #np { background: #fff7e6; border-top: 1px solid #ffe0a3; padding: 8px 12px; font-size: 12px; display: none; }
  #np h3 { font-size: 12px; color: #b25e00; margin-bottom: 6px; }
  #np .inv { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 5px 0; border-bottom: 1px dashed #ffe0a3; }
  #np .inv:last-child { border: none; }
  #np button { background: #ffa726; border: none; color: #fff; border-radius: 6px; padding: 5px 10px; font-size: 12px; font-weight: 700; cursor: pointer; white-space: nowrap; }
  footer { background: #fff; padding: 8px; display: flex; gap: 8px; }
  footer input { flex: 1; border: 1px solid #ddd; border-radius: 20px; padding: 10px 14px; font-size: 15px; outline: none; }
  footer input:focus { border-color: #2ea6da; }
  footer button { background: #2ea6da; border: none; color: #fff; width: 44px; height: 44px; border-radius: 50%; font-size: 18px; cursor: pointer; }
  .sys { align-self: center; background: #0000001a; color: #555; font-size: 11px; padding: 4px 12px; border-radius: 10px; }
</style>
</head>
<body>
<header>
  <div class="avatar">💎</div>
  <div class="info"><h1>بوت الاستثمار</h1><p>🟢 متصل — عرض حي من سيرفر الوكيل</p></div>
</header>
<div id="np"><h3>🧪 لوحة NOWPayments التجريبية (محاكاة الدفع)</h3><div id="npList"></div></div>
<div id="chat"><div class="sys">هذه محاكاة لواجهة تلغرام — البوت الحقيقي يعمل خلفها</div></div>
<footer>
  <input id="inp" placeholder="اكتب رسالة…" autocomplete="off">
  <button id="sendBtn">➤</button>
</footer>
<script>
let cursor = 0;
const chat = document.getElementById('chat');
const npPanel = document.getElementById('np');
const npList = document.getElementById('npList');
const esc = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function addMsg(m) {
  const div = document.createElement('div');
  div.className = 'msg ' + (m.from === 'bot' ? 'bot' : 'user');
  let html = esc(m.text || '');
  if (m.photo) html = '<img src="data:image/png;base64,' + m.photo + '" alt="QR">' + html;
  if (m.document) html = '<div class="doc">📎 ' + esc(m.document.name) + '</div>' + html;
  div.innerHTML = html;
  chat.appendChild(div);
  if (m.keyboard && m.keyboard.length) {
    const kb = document.createElement('div');
    kb.className = 'kb';
    for (const b of m.keyboard) {
      const btn = document.createElement('button');
      btn.textContent = b.text;
      btn.onclick = () => fetch('/api/callback', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ data: b.data, label: b.text }) });
      kb.appendChild(btn);
    }
    chat.appendChild(kb);
  }
  chat.scrollTop = chat.scrollHeight;
}
async function poll() {
  try {
    const r = await fetch('/api/poll?since=' + cursor);
    const data = await r.json();
    for (const m of data.messages) addMsg(m);
    cursor = data.cursor;
    await refreshInvoices();
  } catch (e) {}
  setTimeout(poll, 600);
}
async function refreshInvoices() {
  try {
    const r = await fetch('/api/invoices');
    const data = await r.json();
    const pending = data.invoices.filter(i => i.payment_status === 'waiting' || i.payment_status === 'confirming');
    if (!pending.length) { npPanel.style.display = 'none'; return; }
    npPanel.style.display = 'block';
    npList.innerHTML = '';
    for (const inv of pending) {
      const row = document.createElement('div');
      row.className = 'inv';
      row.innerHTML = '<span>🧾 فاتورة ' + inv.id + ' — ' + inv.pay_amount + ' ' + inv.pay_currency.toUpperCase() + ' (في انتظار الدفع)</span>';
      const btn = document.createElement('button');
      btn.textContent = '💳 محاكاة الدفع';
      btn.onclick = async () => {
        btn.textContent = '⏳…';
        await fetch('/api/simulate-payment', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ invoiceId: inv.id, status: 'finished' }) });
        refreshInvoices();
      };
      row.appendChild(btn);
      npList.appendChild(row);
    }
  } catch (e) {}
}
function send() {
  const inp = document.getElementById('inp');
  const text = inp.value.trim();
  if (!text) return;
  fetch('/api/send', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ text }) });
  inp.value = '';
}
document.getElementById('sendBtn').onclick = send;
document.getElementById('inp').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
poll();
</script>
</body>
</html>`;
}

export default startMocks;
