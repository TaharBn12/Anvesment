// ============================================================
//  اختبار ذاتي (smoke test) — يختبر دورة الحياة الكاملة
//  بدون الحاجة إلى تلغرام أو NOWPayments:
//  مستخدم → إيداع (محاكاة إشعار) → استثمار → ربح يومي → سحب
//  التشغيل: node scripts/smoke-test.js
// ============================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDatabase } from '../src/db.js';
import { upsertUser, setState, getState, platformStats } from '../src/services/users.js';
import { createDeposit, handlePaymentUpdate, getDepositByInvoice } from '../src/services/deposits.js';
import { createInvestment, getUserInvestments, runDailyPayouts, getDueInvestments } from '../src/services/investments.js';
import { createWithdrawal, rejectWithdrawal, markWithdrawalPaid, getPendingWithdrawals } from '../src/services/withdrawals.js';
import { getTransactions } from '../src/services/wallet.js';
import { toMicro, fromMicro } from '../src/utils/money.js';
import { addDays, todayStr } from '../src/utils/format.js';
import { verifyIpnSignature } from '../src/api/nowpayments.js';

let passed = 0;
let failed = 0;
function check(name, condition) {
  if (condition) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
}

// قاعدة بيانات مؤقتة
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invbot-'));
const db = createDatabase(path.join(tmpDir, 'test.db'));

const notifications = [];
const notify = (userId, text) => notifications.push({ userId, text });

console.log('\n🧪 اختبار دورة الحياة الكاملة\n');

// ---------- 1) المستخدم ----------
console.log('1️⃣ تسجيل المستخدم');
const user = upsertUser(db, { id: 111, username: 'testuser', first_name: 'تست' });
check('تم إنشاء المستخدم', user.id === 111);
check('رمز الإحالة أُنشئ', typeof user.referral_code === 'string' && user.referral_code.length > 0);
check('الرصيد الابتدائي صفر', user.balance === 0n || user.balance === 0);

// ---------- 2) الإيداع التلقائي ----------
console.log('\n2️⃣ الإيداع التلقائي (محاكاة إشعار NOWPayments)');
const orderId = 'dep_test_1';
const priceMicro = toMicro(50); // 50$
createDeposit(db, {
  userId: 111, invoiceId: '123', orderId, orderDesc: 'اختبار',
  priceAmountMicro: priceMicro, priceCurrency: 'usd',
  payCurrency: 'usdttrc20', payAmount: '50.5', payAddress: 'TTestAddress123',
});

// محاكاة توقيع IPN (يجب أن يفشل التحقق لأن السرّ غير مضبوط في الاختبار → نتخطى التحقق)
const ipnPayload = {
  invoice_id: '123', payment_status: 'waiting', pay_address: 'TTestAddress123',
  pay_amount: '50.5', actually_paid: '0', pay_currency: 'usdttrc20',
  price_amount: 50, price_currency: 'usd', order_id: orderId,
};
check('توقيع IPN مرفوض بدون سرّ مضبوط', verifyIpnSignature(ipnPayload, 'invalid') === false);

// إشعار: قيد التأكيد
handlePaymentUpdate(db, { ...ipnPayload, payment_status: 'confirming' }, notify);
check('حفظت حالة confirming', getDepositByInvoice(db, '123').status === 'confirming');
check('لم يُضف الرصيد بعد', db.prepare('SELECT balance FROM users WHERE id = 111').get().balance === 0);

// إشعار: مكتمل → يجب إضافة الرصيد تلقائياً
handlePaymentUpdate(db, { ...ipnPayload, payment_status: 'finished', actually_paid: '50.5' }, notify);
const afterDeposit = db.prepare('SELECT * FROM users WHERE id = 111').get();
check('أُضيف 50$ للرصيد تلقائياً', Number(afterDeposit.balance) === 50_000_000);
check('حُدّث إجمالي الإيداعات', Number(afterDeposit.total_deposited) === 50_000_000);
check('وصل إشعار للمستخدم', notifications.some((n) => n.text.includes('تم تأكيد إيداعك')));
check('عُلّم كمُضاف (credited)', getDepositByInvoice(db, '123').credited === 1);

// إشعار مكرر (idempotency) — يجب ألا يضاعف الرصيد
handlePaymentUpdate(db, { ...ipnPayload, payment_status: 'finished', actually_paid: '50.5' }, notify);
const afterDuplicate = db.prepare('SELECT balance FROM users WHERE id = 111').get();
check('لا تكرار للإيداع (idempotent)', Number(afterDuplicate.balance) === 50_000_000);

// ---------- 3) الاستثمار ----------
console.log('\n3️⃣ الاستثمار في مستوى 1');
const inv = createInvestment(db, 111, 1, toMicro(50));
check('أُنشئ الاستثمار', inv.id > 0);
check('خُصم 50$ من الرصيد', Number(db.prepare('SELECT balance FROM users WHERE id = 111').get().balance) === 0);
check('الحالة نشطة', inv.status === 'active');
check('الربح القادم غداً', inv.next_payout === addDays(todayStr(), 1));

// ---------- 4) الأرباح اليومية ----------
console.log('\n4️⃣ صرف الأرباح اليومية');
const day1 = addDays(todayStr(), 1);
const day2 = addDays(todayStr(), 2);
const due = getDueInvestments(db, day1);
check('استثمار مستحق بعد يوم', due.length === 1);
notifications.length = 0;
const result = runDailyPayouts(db, { notify, date: day1 });
check('تم صرف ربح يوم', result.processed === 1);
// 2% من 50$ = 1$
const balanceAfterProfit = Number(db.prepare('SELECT balance FROM users WHERE id = 111').get().balance);
check('أُضيف 1$ ربح يومي', balanceAfterProfit === 1_000_000);
const invAfter = db.prepare('SELECT * FROM investments WHERE id = ?').get(inv.id);
check('paid_days = 1', invAfter.paid_days === 1);
check('ما زال نشطاً', invAfter.status === 'active');
check('وصل إشعار الربح', notifications.some((n) => n.text.includes('ربحك اليومي وصل')));

// محاكاة اليوم الأخير من العقد (يوم 30)
db.prepare('UPDATE investments SET paid_days = 29, next_payout = ? WHERE id = ?').run(day2, inv.id);
notifications.length = 0;
const result2 = runDailyPayouts(db, { notify, date: day2 });
check('اكتمل العقد', result2.processed === 1);
const finalInv = db.prepare('SELECT * FROM investments WHERE id = ?').get(inv.id);
check('الحالة completed', finalInv.status === 'completed');
// رصيد = 1$ (ربح سابق) + 1$ (ربح آخر) + 50$ (إعادة رأس المال) = 52$
const finalBalance = Number(db.prepare('SELECT balance FROM users WHERE id = 111').get().balance);
check('أُعيد رأس المال + الأرباح', finalBalance === 52_000_000);
check('إشعار الاكتمال وصل', notifications.some((n) => n.text.includes('اكتمل استثمارك')));

// ---------- 5) السحب ----------
console.log('\n5️⃣ طلب السحب والرفض والإتمام');
// رصيد 52$ — نطلب سحب 20$
const w = createWithdrawal(db, 111, toMicro(20), 'usdttrc20', 'TWithdrawAddress456');
check('أُنشئ الطلب', w.id > 0);
check('خُصم المبلغ من الرصيد', Number(db.prepare('SELECT balance FROM users WHERE id = 111').get().balance) === 32_000_000);
check('الطلب معلّق', getPendingWithdrawals(db).length === 1);

// رفض → إرجاع المبلغ
rejectWithdrawal(db, w.id, 'اختبار');
check('أُرجع المبلغ بعد الرفض', Number(db.prepare('SELECT balance FROM users WHERE id = 111').get().balance) === 52_000_000);

// طلب جديد + إتمام الدفع
const w2 = createWithdrawal(db, 111, toMicro(20), 'usdttrc20', 'TWithdrawAddress456');
markWithdrawalPaid(db, w2.id, 'payout_123');
check('حُدّث إجمالي السحوبات', Number(db.prepare('SELECT total_withdrawn FROM users WHERE id = 111').get().total_withdrawn) === 20_000_000);

// ---------- 6) السجل والإحصائيات ----------
console.log('\n6️⃣ سجل المعاملات والإحصائيات');
const txs = getTransactions(db, 111);
check('سُجّلت العمليات في الـ ledger', txs.length >= 6);
const stats = platformStats(db);
check('إحصائيات المنصة تعمل', stats.users === 1 && stats.depositsFinished === 1);

// ---------- 7) حالات FSM ----------
console.log('\n7️⃣ حالات المحادثة (FSM)');
setState(db, 111, 'deposit_amount', { amount: 25 });
const s = getState(db, 111);
check('حُفظت الحالة والبيانات', s.state === 'deposit_amount' && s.data.amount === 25);

// ---------- النتيجة ----------
console.log(`\n${'='.repeat(50)}`);
console.log(`النتيجة: ✅ ${passed} نجاح | ❌ ${failed} فشل`);
console.log('='.repeat(50));

db.close();
fs.rmSync(tmpDir, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
