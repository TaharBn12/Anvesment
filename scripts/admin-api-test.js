// ============================================================
//  اختبار واجهة إدارة الموقع (Admin API)
//  يشغّل خادماً حقيقياً على منفذ محلي ويتأكد أن كل نقطة تشتغل
//  وتحترم رمز الدخول.
// ============================================================
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// نختار منفذاً حراً تلقائياً حتى ما يتعارض مع تشغيل سابق
async function freePort() {
  const net = await import('node:net');
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}
const PORT = await freePort();
const TOKEN = 'test_admin_token_123';
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(timeout = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const r = await fetch(`${BASE}/admin/api/ping`);
      if (r.ok) return true;
    } catch { /* ما زال يبدأ */ }
    await sleep(250);
  }
  return false;
}

async function main() {
  console.log('\n🧪 اختبار واجهة إدارة الموقع (Admin API)\n');
  console.log('⏳ تشغيل الخادم...');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adminapi-'));
  const dbPath = path.join(tmpDir, 'test.db');

  const child = spawn('node', ['src/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      BOT_TOKEN: 'test:token',
      ADMIN_IDS: '111',
      NOWPAYMENTS_API_KEY: 'test_key',
      WEBHOOK_PORT: String(PORT),
      WEBHOOK_PATH: '/webhooks/nowpayments',
      ADMIN_API_TOKEN: TOKEN,
      ADMIN_API_CORS_ORIGINS: '*',
      DB_PATH: dbPath,
      DEPOSIT_POLL_SECONDS: '999999',
      // ما نضبطش TELEGRAM_API_ROOT — البوت راح يفشل يتصل بتلغرام
      // (ما هو متاح من الساندبوكس)، وهذا المطلوب: الخادم يشتغل
      // وواجهة الإدارة تبقى متاحة.
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  child.stdout.on('data', (d) => logs.push(d.toString()));
  child.stderr.on('data', (d) => logs.push(d.toString()));

  try {
    const up = await waitForServer();
    check('الخادم بدأ ويستجيب على /admin/api/ping', up);
    if (!up) throw new Error('الخادم ما بدأش');

    const headers = { 'Content-Type': 'application/json', 'x-admin-token': TOKEN };
    const post = (p, body) => fetch(`${BASE}${p}`, { method: 'POST', headers, body: JSON.stringify(body ?? {}) });
    const get = (p, h = headers) => fetch(`${BASE}${p}`, { headers: h });

    // ---- 1) المصادقة ----
    console.log('\n1️⃣ المصادقة');
    const noToken = await get('/admin/api/stats', {});
    check('بدون رمز → 401', noToken.status === 401, `status=${noToken.status}`);
    const badToken = await get('/admin/api/stats', { 'x-admin-token': 'wrong' });
    check('برمز خاطئ → 401', badToken.status === 401);
    const pingNoToken = await fetch(`${BASE}/admin/api/ping`);
    check('/ping يقبل بدون رمز (لاختبار الرابط)', pingNoToken.status === 200);
    const statsOk = await get('/admin/api/stats');
    check('برمز صحيح → 200', statsOk.status === 200);

    // ---- 2) إنشاء مستخدمين ----
    console.log('\n2️⃣ المستخدمون');
    // ننشئ مستخدمين عبر واجهة الإشعارات؟ لأ — نستخدم API الإدارة نفسها
    // لكن ما فيش نقطة إنشاء. نستخدم قاعدة البيانات مباشرة.
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    const mk = (id, name, balance) => {
      db.prepare(
        `INSERT OR REPLACE INTO users (id, username, first_name, balance, referral_code, is_admin)
         VALUES (?, ?, ?, ?, ?, 0)`
      ).run(id, `user_${id}`, name, balance, `CODE${id}`);
      return id;
    };
    mk(1001, 'أحمد', 50_000_000);
    mk(1002, 'خالد', 0);
    mk(1003, 'سعيد', 120_000_000);
    mk(1004, 'محظور-تجربة', 10_000_000);
    db.close();

    const list = await (await get('/admin/api/users')).json();
    check('قائمة المستخدمين تُرجَع', Array.isArray(list.users) && list.users.length >= 4,
      `count=${list.users?.length}`);
    const found = list.users.find((u) => u.id === 1001);
    check('رصيد أحمد 50$', found && found.balance === 50, `balance=${found?.balance}`);

    const search = await (await get('/admin/api/users?q=خالد')).json();
    check('البحث بالاسم العربي يشتغل', search.users.length === 1 && search.users[0].id === 1002,
      `count=${search.users.length}`);

    const byId = await (await get('/admin/api/users?q=1003')).json();
    check('البحث بالمعرّف يشتغل', byId.users.some((u) => u.id === 1003));

    const detail = await (await get('/admin/api/users/1001')).json();
    check('تفاصيل المستخدم تُرجَع', detail.user?.id === 1001 && Array.isArray(detail.transactions));
    const missing = await get('/admin/api/users/999999');
    check('مستخدم غير موجود → 404', missing.status === 404);

    // ---- 3) إضافة رصيد ----
    console.log('\n3️⃣ تعديل الرصيد');
    const add = await (await post('/admin/api/users/1002/balance', { amount: 25, note: 'مكافأة' })).json();
    check('إضافة 25$ لخالد', add.ok && add.newBalance === 25, JSON.stringify(add));
    const sub = await (await post('/admin/api/users/1002/balance', { amount: -5 })).json();
    check('خصم 5$ من خالد', sub.ok && sub.newBalance === 20, JSON.stringify(sub));
    const zero = await post('/admin/api/users/1002/balance', { amount: 0 });
    check('مبلغ صفر مرفوض (400)', zero.status === 400);
    const tooMuch = await post('/admin/api/users/1002/balance', { amount: -9999 });
    check('خصم أكثر من الرصيد مرفوض', tooMuch.status === 400);

    // التحقق من الـ ledger
    const ledger = await (await get('/admin/api/users/1002')).json();
    const credits = ledger.transactions.filter((t) => t.type === 'admin_credit' || t.type === 'admin_debit');
    check('سُجّلت العمليات في الـ ledger', credits.length === 2, `count=${credits.length}`);

    // ---- 4) الحظر ----
    console.log('\n4️⃣ الحظر');
    const ban = await (await post('/admin/api/users/1004/ban', { banned: true, reason: 'سبام' })).json();
    check('حظر المستخدم 1004', ban.ok && ban.banned === true);
    const bannedList = await (await get('/admin/api/users?banned=1')).json();
    check('فلتر «المحظورون فقط» يشتغل',
      bannedList.users.length === 1 && bannedList.users[0].id === 1004,
      `count=${bannedList.users.length}`);
    const afterBan = await (await get('/admin/api/users/1004')).json();
    check('سبب الحظر مخزّن', afterBan.user.banReason === 'سبام', afterBan.user.banReason);
    const unban = await (await post('/admin/api/users/1004/ban', { banned: false })).json();
    check('رفع الحظر', unban.ok && unban.banned === false);
    const afterUnban = await (await get('/admin/api/users?banned=1')).json();
    check('ما بقي محظورون', afterUnban.users.length === 0);

    // ---- 5) السحوبات ----
    console.log('\n5️⃣ السحوبات');
    const { DatabaseSync: DB2 } = await import('node:sqlite');
    const db2 = new DB2(dbPath);
    const ins = db2.prepare(
      `INSERT INTO withdrawals (user_id, amount, currency, address, status) VALUES (?, ?, ?, ?, 'pending')`
    );
    ins.run(1001, 30_000_000, 'usdttrc20', 'TAddrAAA111');
    ins.run(1003, 10_000_000, 'btc', 'bc1qBBB222');
    db2.close();

    const wds = await (await get('/admin/api/withdrawals?status=pending')).json();
    check('السحوبات المعلّقة تُرجَع', wds.withdrawals.length === 2, `count=${wds.withdrawals.length}`);
    // القائمة مرتبة تنازلياً بالمعرّف — نختار حسب المستخدم مو حسب الموضع
    const wdA = wds.withdrawals.find((w) => w.userId === 1001);
    const wdB = wds.withdrawals.find((w) => w.userId === 1003);
    const wdId = wdA.id;
    check('بيانات الطلب كاملة',
      wdA.amount === 30 && wdA.address === 'TAddrAAA111',
      JSON.stringify(wdA));

    const rej = await (await post(`/admin/api/withdrawals/${wdId}/reject`, { note: 'عنوان خاطئ' })).json();
    check('رفض طلب', rej.ok && rej.status === 'rejected');
    // التحقق أن المبلغ رجع للمحفظة
    const afterReject = await (await get('/admin/api/users/1001')).json();
    check('المبلغ رجع للمحفظة بعد الرفض', afterReject.user.balance === 80, `balance=${afterReject.user.balance}`);

    const wd2 = wdB.id;
    const approved = await (await post(`/admin/api/withdrawals/${wd2}/approve`, {})).json();
    check('موافقة على الطلب الثاني', approved.ok && approved.status === 'approved', JSON.stringify(approved));
    const paid = await (await post(`/admin/api/withdrawals/${wd2}/mark-paid`, {})).json();
    check('تعليم كمدفوع', paid.ok && paid.status === 'paid');

    const again = await post(`/admin/api/withdrawals/${wd2}/approve`, {});
    check('ما تُعالَج الطلب مرتين', again.status === 400);

    // ---- 6) الإيداعات ----
    console.log('\n6️⃣ الإيداعات');
    const { DatabaseSync: DB3 } = await import('node:sqlite');
    const db3 = new DB3(dbPath);
    db3.prepare(
      `INSERT INTO deposits (user_id, invoice_id, order_id, price_amount, price_currency, pay_currency, pay_address, status, credited)
       VALUES (?, ?, ?, ?, 'usd', 'usdttrc20', 'TAddrX', 'finished', 1)`
    ).run(1001, 'inv_test_1', 'ord_1', 100_000_000);
    db3.prepare(
      `INSERT INTO deposits (user_id, invoice_id, order_id, price_amount, price_currency, pay_currency, pay_address, status, credited)
       VALUES (?, ?, ?, ?, 'usd', 'btc', 'bc1qX', 'waiting', 0)`
    ).run(1003, 'inv_test_2', 'ord_2', 20_000_000);
    db3.close();

    const deps = await (await get('/admin/api/deposits')).json();
    check('الإيداعات تُرجَع', deps.deposits.length === 2, `count=${deps.deposits.length}`);
    const depFinished = await (await get('/admin/api/deposits?status=finished')).json();
    check('فلترة الإيداعات بالحالة', depFinished.deposits.length === 1);

    // ---- 7) الإحصائيات ----
    console.log('\n7️⃣ الإحصائيات');
    const s = await (await get('/admin/api/stats')).json();
    check('الإحصائيات كاملة',
      s.users >= 4 && typeof s.balances === 'number' && s.pendingWithdrawals.count === 0,
      JSON.stringify({ users: s.users, pending: s.pendingWithdrawals.count }));

    // ---- 8) CORS ----
    console.log('\n8️⃣ CORS');
    const cors = await fetch(`${BASE}/admin/api/stats`, {
      headers: { ...headers, Origin: 'https://example.github.io' },
    });
    check('ترويسة CORS موجودة', cors.headers.get('access-control-allow-origin') !== null,
      cors.headers.get('access-control-allow-origin') || '—');

    // ---- 9) لو ADMIN_API_TOKEN فاضي ----
    console.log('\n9️⃣ تعطيل الواجهة بدون رمز');
    console.log('  (يُختبر في الاختبار المنفصل أدناه)');
  } catch (err) {
    failed++;
    failures.push(`استثناء: ${err.message}`);
    console.error('\n💥 خطأ غير متوقع:', err.message);
  } finally {
    child.kill('SIGTERM');
    await sleep(300);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* مؤقت */ }
  }

  console.log(`\n${'='.repeat(56)}`);
  console.log(`النتيجة: ✅ ${passed} نجاح | ❌ ${failed} فشل`);
  if (failures.length) console.log(`الفشل: ${failures.join(' | ')}`);
  console.log('='.repeat(56));

  if (failed > 0) {
    console.log('\n--- آخر سجلات الخادم ---');
    console.log(logs.slice(-20).join(''));
  }
  process.exit(failed > 0 ? 1 : 0);
}

main();
