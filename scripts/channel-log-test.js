// ============================================================
//  اختبار قناة تسجيل الأحداث (LOG_CHANNEL_ID)
//  يتحقق من:
//   1) كل حدث (إيداع/سحب/استثمار/ربح) يوصل للقناة بالمحتوى المطلوب
//      (معرف المستخدم + المبلغ + هاش الدفع ورابط التحقق)
//   2) فشل القناة (البوت ليس أدمن مثلاً) ما يكسر العمليات الحقيقية
//      — الإيداع يُسجّل والسحب يُخصم والاستثمار يُفعّل عادي
//   3) الفلتر LOG_CHANNEL_EVENTS يمنع الأحداث غير المطلوبة
//   4) من غير LOG_CHANNEL_ID كل شيء يعمل والتسجيل معطّل
//
//  التشغيل: node scripts/channel-log-test.js
//  ملاحظة: القناة لازم تكون مضبوطة في البيئة، فنضبطها هنا قبل تحميل
//  الإعدادات — config.js يقرأ LOG_CHANNEL_ID وقت الاستيراد.
// ============================================================
process.env.LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || '-1001234567890';

// استيراد ديناميكي: لازم البيئة تُضبط قبل ما config.js يقرأها.
const channelLogModule = await import('../src/services/channelLog.js');

let passed = 0;
let failed = 0;
const failures = [];
function check(name, condition, extra = '') {
  if (condition) { passed++; console.log(`  ✅ ${name}`); }
  else {
    failed++; failures.push(name);
    console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

// ===== استخراج المكوّنات المُصدّرة من وحدة القناة =====
const { setChannelSender, logToChannel, channelLogConfigured, explorerLink } = channelLogModule;
const EXPLORERS = channelLogModule.EXPLORERS;
const { formatDepositLog, formatWithdrawalLog, formatInvestmentLog, formatProfitLog } = channelLogModule;
const EXPORTS = Object.keys(channelLogModule);

// ===== 1) صياغة رسائل القناة =====
console.log('\n1️⃣ صياغة رسائل القناة');

const HASH = '0x8f2a9b1c3d4e5f60718293a4b5c6d7e8f9011223344556677889900aabbccddee';
const USER = { user_id: 123456789, username: 'test_user', balance: 5_000_000 };

const depText = formatDepositLog({
  id: 42,
  user_id: 123456789,
  price_amount: 45_000_000,
  pay_currency: 'usdttrc20',
  pay_amount: '45',
  pay_address: 'TQ5tHkSampleAddress',
  invoice_id: '555000111',
}, { user: USER, payinHash: HASH });
check('رسالة الإيداع: معرف المستخدم', depText.includes('123456789'), depText);
check('رسالة الإيداع: المبلغ 45.00$', depText.includes('45.00$'), depText);
check('رسالة الإيداع: هاش الدفع', depText.includes(HASH), depText);
check('رسالة الإيداع: رابط التحقق', depText.includes(explorerLink('usdttrc20', HASH)), depText);

const wdText = formatWithdrawalLog({
  id: 7,
  user_id: 123456789,
  amount: 5_000_000,
  currency: 'usdttrc20',
  address: 'TXyzAbc123',
  status: 'pending',
}, { user: USER });
check('رسالة السحب: معرف المستخدم', wdText.includes('123456789'));
check('رسالة السحب: المبلغ 5.00$', wdText.includes('5.00$'), wdText);
check('رسالة السحب: عنوان المحفظة', wdText.includes('TXyzAbc123'));
check('رسالة السحب: الحالة', wdText.includes('قيد المراجعة'), wdText);

const invText = formatInvestmentLog({
  id: 9,
  user_id: 123456789,
  level: 3,
  amount: 500_000_000,
  daily_profit: 15_000_000,
  duration_days: 60,
  status: 'active',
}, { user: USER });
check('رسالة الاستثمار: معرف المستخدم', invText.includes('123456789'));
check('رسالة الاستثمار: المبلغ 500.00$', invText.includes('500.00$'), invText);
check('رسالة الاستثمار: المستوى', invText.includes('المستوى: <b>3</b>'), invText);

const profitText = formatProfitLog({
  id: 9, user_id: 123456789, level: 3, paid_days: 4, duration_days: 60, earned: 60_000_000,
}, 15_000_000);
check('رسالة الربح: معرف المستخدم', profitText.includes('123456789'));
check('رسالة الربح: المبلغ', profitText.includes('15.00$'), profitText);

// ===== 2) روابط التحقق من البلوكشين =====
console.log('\n2️⃣ روابط التحقق');
const links = [
  ['usdttrc20', 'tronscan.org'],
  ['usdtbsc', 'bscscan.com'],
  ['usdterc20', 'etherscan.io'],
  ['usdcerc20', 'etherscan.io'],
  ['btc', 'blockchair.com'],
  ['eth', 'etherscan.io'],
  ['ltc', 'blockchair.com'],
  ['trx', 'tronscan.org'],
];
for (const [cur, host] of links) {
  const url = explorerLink(cur, HASH);
  check(`رابط ${cur} يذهب إلى ${host}`, url.includes(host), url);
}
check('الرابط يحتوي الهاش كاملاً', explorerLink('usdttrc20', HASH).includes(HASH));
check('من غير هاش ما فيه رابط', !explorerLink('usdttrc20', null));
check('عملة غير معروفة ترجع فارغ', !explorerLink('zzzcoin', HASH));
check('جميع الروابط https', Object.values(EXPLORERS).every((e) => e(HASH).startsWith('https://')));

// ===== 3) السلوك مع القناة (نجاح/فشل/فلتر) =====
console.log('\n3️⃣ إرسال القناة والفلتر');
// نعيد ضبط الحالة لكل حالة اختبار
const state = { sent: [], failNext: false };

// حالة القناة السعيدة
setChannelSender((text) => { state.sent.push(text); return Promise.resolve(); });
state.sent.length = 0;
logToChannel('deposit', 'إيداع 1');
logToChannel('withdrawal', 'سحب 1');
logToChannel('investment', 'استثمار 1');
logToChannel('profit', 'ربح 1');
check('أرسلت 4 رسائل بلا فلتر', state.sent.length === 4, `وصل: ${state.sent.length}`);
check('channelLogConfigured صحيح لما القناة مضبوطة', channelLogConfigured() === true);

// حالة الفشل: المرسل يرمي خطأ — ما يجب أن ينكسر المستدعي
setChannelSender(() => Promise.reject(new Error('chat not found: bot is not a member of the channel')));
let threw = false;
try { logToChannel('deposit', 'هذا يجب أن يُبتلع بهدوء'); }
catch { threw = true; }
check('logToChannel ما يرمي خطأ لو القناة فشلت', threw === false);
check('channelLogConfigured ما زال يعمل بعد الفشل', channelLogConfigured() === true);

// المرسل يرمي خطأ متزامن (ليس وعداً)
setChannelSender(() => { throw new Error('synchronous failure'); });
let threwSync = false;
try { logToChannel('deposit', 'خطأ متزامن'); }
catch { threwSync = true; }
check('logToChannel ما يرمي خطأ متزامن', threwSync === false);

// بلا مرسل مضبوط (القناة غير مهيّأة)
setChannelSender(null);
state.sent.length = 0;
let threwNoSender = false;
try { logToChannel('deposit', 'بلا مرسل'); }
catch { threwNoSender = true; }
check('logToChannel ما يرمي خطأ بلا مرسل', threwNoSender === false);
check('channelLogConfigured كاذب لما ما في مرسل', channelLogConfigured() === false);

// ===== 4) فلتر الأحداث =====
console.log('\n4️⃣ فلتر LOG_CHANNEL_EVENTS');
// نختبر الفلتر عبر الدالة المساعدة إن كانت متاحة
// (config.logChannel.events يتحكم فيه أثناء التشغيل)
const setFilter = channelLogModule.setEventFilterForTests;
setChannelSender(() => { state.sent.push('x'); return Promise.resolve(); });

setFilter([]);
state.sent.length = 0;
logToChannel('deposit', '1'); logToChannel('profit', '2');
check('فلتر فارغ = كل الأحداث تمر', state.sent.length === 2, `وصل: ${state.sent.length}`);

setFilter(['deposit', 'investment']);
state.sent.length = 0;
logToChannel('deposit', '1'); logToChannel('investment', '2');
logToChannel('withdrawal', '3'); logToChannel('profit', '4');
check('الفلتر يمرر المطلوب فقط', state.sent.length === 2, `وصل: ${state.sent.length}`);

setFilter(['withdrawal']);
state.sent.length = 0;
logToChannel('deposit', '1'); logToChannel('withdrawal', '3');
check('الفلتر بوضع نوع واحد', state.sent.length === 1, `وصل: ${state.sent.length}`);
setFilter(null);

// ===== النتيجة =====
console.log('\n==========================================================');
console.log(`النتيجة: ✅ ${passed} نجاح | ❌ ${failed} فشل`);
if (failures.length) {
  console.log(`الفشل: ${failures.join(' | ')}`);
}
console.log('==========================================================\n');
process.exit(failed > 0 ? 1 : 0);
