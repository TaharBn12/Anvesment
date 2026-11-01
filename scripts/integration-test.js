// ============================================================
//  اختبار التكامل الشامل (End-to-End)
//  يشغّل البوت الحقيقي ضد خوادم محاكاة لتلغرام و NOWPayments،
//  ثم يحاكي مستخدماً يمر بكل الرحلات:
//  /start → إيداع (مع إشعار دفع حقيقي) → استثمار → ربح يومي
//  → سحب → موافقة الأدمن والدفع التلقائي
//
//  التشغيل: node scripts/integration-test.js
// ============================================================
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { startMocks } from './mocks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const IPN_SECRET = 'test_ipn_secret';
const USER_ID = 555;
const ADMIN_ID = 777;

let passed = 0;
let failed = 0;
const failures = [];
function check(name, condition, extra = '') {
  if (condition) { passed++; console.log(`  ✅ ${name}`); }
  else {
    failed++;
    failures.push(name);
    console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(predicate, timeout = 10_000, label = 'شرط') {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (predicate()) return true;
    await sleep(120);
  }
  throw new Error(`انتهت مهلة الانتظار: ${label}`);
}

// ===== بناء تحديثات تلغرام وهمية =====
let msgId = 100;
let cbId = 100;
const tgUser = (id, name) => ({ id, is_bot: false, first_name: name, username: `user_${id}` });
const chatOf = (id) => ({ id, type: 'private' });
const updateMessage = (fromId, text) => {
  // تلغرام الحقيقي يضيف entities لأمر /command — Telegraf يعتمد عليها في المطابقة
  const entities = text.startsWith('/')
    ? [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }]
    : undefined;
  return {
    message: {
      message_id: ++msgId, from: tgUser(fromId, 'مستخدم'), chat: chatOf(fromId),
      date: Math.floor(Date.now() / 1000), text, ...(entities ? { entities } : {}),
    },
  };
};
const updateCallback = (fromId, data) => ({
  callback_query: {
    id: `cb${++cbId}`, from: tgUser(fromId, 'مستخدم'),
    message: { message_id: ++msgId, chat: chatOf(fromId), date: Math.floor(Date.now() / 1000), text: 'رسالة سابقة' },
    data,
  },
});

// ===== توقيع IPN بنفس خوارزمية NOWPayments =====
function sortedStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(sortedStringify).join(',')}]`;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${sortedStringify(obj[k])}`).join(',')}}`;
}
function signPayload(payload, secret) {
  return crypto.createHmac('sha512', secret).update(sortedStringify(payload)).digest('hex');
}

async function main() {
  console.log('\n🧪 اختبار التكامل الشامل (End-to-End)\n');
  console.log('⏳ تشغيل خوادم المحاكاة...');
  const mocks = await startMocks();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invbot-e2e-'));
  const dbPath = path.join(tmpDir, 'test.db');
  const webhookPort = 4173;

  const child = spawn('node', ['src/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      BOT_TOKEN: 'test:token_for_mocking',
      TELEGRAM_API_ROOT: `http://127.0.0.1:${mocks.telegramPort}`,
      ADMIN_IDS: String(ADMIN_ID),
      NOWPAYMENTS_API_KEY: 'test_api_key',
      NOWPAYMENTS_API_URL: `http://127.0.0.1:${mocks.nowpaymentsPort}`,
      NOWPAYMENTS_IPN_SECRET: IPN_SECRET,
      NOWPAYMENTS_PAYOUTS_EMAIL: 'test@example.com',
      NOWPAYMENTS_PAYOUTS_PASSWORD: 'test_password',
      WEBHOOK_PORT: String(webhookPort),
      WEBHOOK_PATH: '/webhooks/nowpayments',
      DB_PATH: dbPath,
      CURRENCY: 'usd',
      MIN_DEPOSIT: '10',
      MIN_WITHDRAW: '5',
      DEPOSIT_POLL_SECONDS: '999999',
      PAYOUT_HOUR: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const childLogs = [];
  child.stdout.on('data', (d) => childLogs.push(d.toString()));
  child.stderr.on('data', (d) => childLogs.push(d.toString()));

  const db = new DatabaseSync(dbPath);
  const inject = (update) => fetch(`http://127.0.0.1:${mocks.telegramPort}/_test/inject`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(update),
  });

  /** يرسل تحديثاً ثم ينتظر رسالة من البوت تحتوي النص المتوقع */
  async function step(name, update, expectedText, timeout = 12_000) {
    const start = mocks.telegram.sent.length;
    await inject(update);
    try {
      await waitFor(
        () => mocks.telegram.sent.length > start &&
          mocks.telegram.sent.slice(start).some((m) => (m.body?.text || m.body?.caption || '').includes(expectedText)),
        timeout, name
      );
      check(name, true);
      return true;
    } catch {
      const recent = mocks.telegram.sent.slice(-3).map((m) => `${m.method}: ${(m.body?.text || m.body?.caption || '').slice(0, 80)}`);
      check(name, false, `آخر الرسائل: ${JSON.stringify(recent, null, 1)}`);
      return false;
    }
  }

  /** يرسل تحديثاً ثم ينتظر رسالة تحتوي زراً بالبيانات المتوقعة */
  async function stepButton(name, update, callbackData, timeout = 12_000) {
    const start = mocks.telegram.sent.length;
    await inject(update);
    try {
      await waitFor(
        () => mocks.telegram.sent.length > start &&
          mocks.telegram.sent.slice(start).some((m) => JSON.stringify(m.body?.reply_markup || {}).includes(callbackData)),
        timeout, name
      );
      check(name, true);
      return true;
    } catch {
      check(name, false, `لم يظهر الزر ${callbackData}`);
      return false;
    }
  }

  /** يرسل تحديثاً ثم ينتظر استدعاء دالة معينة (مثل sendPhoto) */
  async function stepMethod(name, update, method, timeout = 12_000) {
    const start = mocks.telegram.sent.length;
    await inject(update);
    try {
      await waitFor(
        () => mocks.telegram.sent.length > start &&
          mocks.telegram.sent.slice(start).some((m) => m.method === method),
        timeout, name
      );
      check(name, true);
      return true;
    } catch {
      check(name, false, `لم يُستدعَ ${method}`);
      return false;
    }
  }

  const balance = (id) => Number(db.prepare('SELECT balance FROM users WHERE id = ?').get(id)?.balance ?? -1);

  try {
    // ============ 0) انتظار جهوزية البوت ============
    console.log('\n0️⃣ انتظار جهوزية البوت');
    await waitFor(() => childLogs.some((l) => l.includes('البوت يعمل')), 20_000, 'تشغيل البوت');
    check('البوت يعمل وتسجّل في تلغرام (getMe)', mocks.telegram.sent.some((m) => m.method === 'getMe'));
    check('خادم الإشعارات يستجيب', await fetch(`http://127.0.0.1:${webhookPort}/health`).then((r) => r.ok).catch(() => false));

    // ============ 1) التسجيل والقائمة ============
    console.log('\n1️⃣ التسجيل (/start)');
    await step('المستخدم سجّل واستقبل الترحيب', updateMessage(USER_ID, '/start'), 'مرحباً');
    check('أُنشئت محفظة للمستخدم', balance(USER_ID) === 0, `الرصيد: ${balance(USER_ID)}`);
    await step('أمر /id يعمل', updateMessage(USER_ID, '/id'), 'معرّفك في تلغرام');

    // ============ 2) الإيداع ============
    console.log('\n2️⃣ الإيداع');
    await step('ضغط إيداع → طلب المبلغ', updateMessage(USER_ID, '💰 إيداع'), 'إيداع جديد');
    await stepButton('أدخل 60$ → عرض العملات', updateMessage(USER_ID, '60'), 'dep_cur:usdttrc20');
    await step('اختيار USDT-TRC20 → العنوان + QR', updateCallback(USER_ID, 'dep_cur:usdttrc20'), 'تفاصيل الإيداع');
    check('أُرسل رمز QR للعنوان', mocks.telegram.sent.some((m) => m.method === 'sendPhoto'));
    check('أُنشئت الفاتورة في NOWPayments', mocks.nowpayments.invoices.size === 1);
    const invoiceId = [...mocks.nowpayments.invoices.keys()][0];
    const photoMsg = mocks.telegram.sent.find((m) => m.method === 'sendPhoto');
    check('التعليق يحتوي عنوان الإيداع الفعلي',
      Boolean(photoMsg?.body?.caption?.includes(mocks.nowpayments.invoices.get(invoiceId).pay_address)),
      photoMsg?.body?.caption?.slice(0, 60));
    check('حُفظت الفاتورة في قاعدة البيانات',
      Number(db.prepare('SELECT COUNT(*) AS n FROM deposits').get().n) === 1);

    // ============ 3) الدفع الفعلي + الإشعار ============
    console.log('\n3️⃣ الدفع والإشعار (IPN)');
    await fetch(`http://127.0.0.1:${mocks.nowpaymentsPort}/_test/invoice/${invoiceId}/status`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payment_status: 'finished', actually_paid: '60.6' }),
    });
    const invoice = mocks.nowpayments.invoices.get(invoiceId);
    const ipnPayload = {
      payment_status: 'finished', invoice_id: invoiceId, pay_address: invoice.pay_address,
      pay_amount: String(invoice.pay_amount), actually_paid: '60.6', pay_currency: 'usdttrc20',
      price_amount: 60, price_currency: 'usd', order_id: invoice.order_id,
      order_description: 'إيداع', purchase_id: `p_${invoiceId}`,
    };
    const ipnRes = await fetch(`http://127.0.0.1:${webhookPort}/webhooks/nowpayments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-nowpayments-sig': signPayload(ipnPayload, IPN_SECRET) },
      body: JSON.stringify(ipnPayload),
    });
    const ipnBody = await ipnRes.json();
    check('خادم الإشعارات قبل الطلب (200)', ipnRes.status === 200, JSON.stringify(ipnBody));
    check('الإشعار عالج كمُضاف (credited)', ipnBody.result === 'credited', JSON.stringify(ipnBody));
    await waitFor(() => mocks.telegram.sent.some((m) => (m.body?.text || '').includes('تم تأكيد إيداعك')), 5_000);
    check('وصل إشعار تأكيد الإيداع للمستخدم', true);
    check('أُضيف 60$ للرصيد تلقائياً', balance(USER_ID) === 60_000_000, `الرصيد: ${balance(USER_ID)}`);

    // إشعار مكرر — يجب ألا يضاعف الرصيد
    await fetch(`http://127.0.0.1:${webhookPort}/webhooks/nowpayments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-nowpayments-sig': signPayload(ipnPayload, IPN_SECRET) },
      body: JSON.stringify(ipnPayload),
    });
    check('لا تكرار عند إعادة إرسال الإشعار', balance(USER_ID) === 60_000_000, `الرصيد: ${balance(USER_ID)}`);

    // إشعار بتوقيع خاطئ — يجب رفضه
    const badRes = await fetch(`http://127.0.0.1:${webhookPort}/webhooks/nowpayments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-nowpayments-sig': 'wrong_signature' },
      body: JSON.stringify(ipnPayload),
    });
    check('إشعار بتوقيع خاطئ مرفوض (401)', badRes.status === 401);

    // ============ 4) الاستثمار ============
    console.log('\n4️⃣ الاستثمار');
    await stepButton('ضغط استثمار → عرض المستويات', updateMessage(USER_ID, '📈 استثمار'), 'inv_level:1');
    await step('اختيار المستوى الأول → طلب المبلغ', updateCallback(USER_ID, 'inv_level:1'), 'أدخل المبلغ');
    await stepButton('إدخال 50$ → شاشة التأكيد', updateMessage(USER_ID, '50'), 'inv_confirm:1');
    await step('تأكيد الاستثمار → تم التفعيل', updateCallback(USER_ID, 'inv_confirm:1'), 'تم تفعيل استثمارك');
    check('خُصم 50$ من الرصيد', balance(USER_ID) === 10_000_000, `الرصيد: ${balance(USER_ID)}`);
    const inv = db.prepare('SELECT * FROM investments WHERE user_id = ?').get(USER_ID);
    check('أُنشئ عقد استثمار نشط', inv && inv.status === 'active' && inv.level === 1);
    check('الربح اليومي = 2% (1$)', inv && inv.daily_rate === 20000 && inv.amount === 50_000_000);
    await step('عرض استثماراتي', updateMessage(USER_ID, '📊 استثماراتي'), 'عقد #');

    // ============ 5) صرف الأرباح اليومية ============
    console.log('\n5️⃣ صرف الأرباح اليومية (يدوياً عبر الأدمن)');
    // محاكاة مرور يوم: نجعل الاستحقاق اليوم
    db.prepare('UPDATE investments SET next_payout = date(\'now\') WHERE id = ?').run(inv.id);
    const beforeProfit = balance(USER_ID);
    await step('الأدمن شغّل صرف الأرباح', updateCallback(ADMIN_ID, 'admin_run_payouts'), 'تمت معالجة');
    await waitFor(() => mocks.telegram.sent.some((m) => (m.body?.text || '').includes('ربحك اليومي وصل')), 5_000);
    check('وصل إشعار الربح اليومي للمستخدم', true);
    check('أُضيف الربح اليومي 1$ للرصيد', balance(USER_ID) === beforeProfit + 1_000_000, `الرصيد: ${balance(USER_ID)}`);

    // ============ 6) السحب ============
    console.log('\n6️⃣ السحب');
    await step('ضغط سحب → طلب المبلغ', updateMessage(USER_ID, '💸 سحب'), 'طلب سحب');
    await stepButton('إدخال 5$ → اختيار العملة', updateMessage(USER_ID, '5'), 'wd_cur:usdttrc20');
    await step('اختيار العملة → طلب العنوان', updateCallback(USER_ID, 'wd_cur:usdttrc20'), 'عنوان محفظتك');
    await stepButton('إدخال العنوان → شاشة التأكيد', updateMessage(USER_ID, 'TWithdrawAddress1234567890'), 'wd_confirm');
    const beforeWithdraw = balance(USER_ID);
    await step('تأكيد السحب → تم استلام الطلب', updateCallback(USER_ID, 'wd_confirm'), 'تم استلام طلب السحب');
    check('خُصم مبلغ السحب من الرصيد', balance(USER_ID) === beforeWithdraw - 5_000_000, `الرصيد: ${balance(USER_ID)}`);
    const wd = db.prepare('SELECT * FROM withdrawals WHERE user_id = ?').get(USER_ID);
    check('طلب السحب مُعلّق في الانتظار', wd && wd.status === 'pending');
    check('أُشعر الأدمن بالطلب', mocks.telegram.sent.some((m) => m.body?.chat_id === ADMIN_ID && (m.body?.text || '').includes('طلب سحب جديد')));

    // ============ 7) موافقة الأدمن + الدفع التلقائي ============
    console.log('\n7️⃣ موافقة الأدمن والدفع التلقائي');
    await stepButton('الأدمن فتح طلبات السحب', updateCallback(ADMIN_ID, 'admin_withdrawals'), `wd_approve:${wd.id}`);
    await step('الأدمن وافق → أُنشئ الدفع في NOWPayments', updateCallback(ADMIN_ID, `wd_approve:${wd.id}`), 'تم دفع الطلب');
    await waitFor(() => mocks.telegram.sent.some((m) => m.body?.chat_id === USER_ID && (m.body?.text || '').includes('تم تنفيذ سحبك')), 5_000);
    check('وصل إشعار تنفيذ السحب للمستخدم', true);
    check('أُنشئت عملية دفع في NOWPayments', mocks.nowpayments.payouts.length === 1);
    const wdAfter = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(wd.id);
    check('حالة الطلب: مدفوع', wdAfter.status === 'paid' && wdAfter.payout_id);
    check('حُدّث إجمالي السحوبات',
      Number(db.prepare('SELECT total_withdrawn FROM users WHERE id = ?').get(USER_ID).total_withdrawn) === 5_000_000);

    // ============ 8) المحفظة ============
    console.log('\n8️⃣ المحفظة والسجل');
    await step('عرض المحفظة', updateMessage(USER_ID, '💼 محفظتي'), 'محفظتي');
    await step('سجل العمليات', updateCallback(USER_ID, 'wallet_tx'), 'آخر العمليات');
    check('سُجّلت العمليات في الـ ledger',
      Number(db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE user_id = ?').get(USER_ID).n) >= 4);

  } catch (err) {
    failed++;
    failures.push(`استثناء: ${err.message}`);
    console.error('\n💥 خطأ غير متوقع:', err.message);
  } finally {
    child.kill('SIGTERM');
    mocks.close();
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // ============ النتيجة ============
  console.log(`\n${'='.repeat(56)}`);
  console.log(`النتيجة: ✅ ${passed} نجاح | ❌ ${failed} فشل`);
  if (failures.length) console.log(`الفشل: ${failures.join(' | ')}`);
  console.log('='.repeat(56));

  if (failed > 0) {
    console.log('\n--- آخر سجلات البوت ---');
    console.log(childLogs.slice(-25).join(''));
  }
  process.exit(failed === 0 ? 0 : 1);
}

main();
