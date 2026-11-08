import { INVESTMENT_LEVELS } from '../constants.js';
import { formatMoney, fromMicro } from '../utils/money.js';
import { usd } from '../utils/format.js';

const WELCOME = (name) => `👋 مرحباً <b>${name}</b> في بوت الاستثمار!

💎 <b>كيف يعمل البوت؟</b>
1️⃣ تُودع عملتك الرقمية المفضلة (USDT على شبكة TRC20، BTC، TRX...) عبر عنوان دفع فريد يُنشأ خصيصاً لك.
2️⃣ تختار واحداً من <b>5 مستويات استثمارية</b> بربح يومي.
3️⃣ يصلك ربحك تلقائياً كل يوم في محفظتك، وعند انتهاء المدة يُعاد رأس المال.

⚠️ <b>تنبيه:</b> الأرباح في هذا البوت افتراضية وتُدار من قِبل المشغّل. لا تستثمر أكثر مما تستطيع تحمّل خسائره.

اختر من القائمة بالأسفل 👇`;

const HELP = `ℹ️ <b>المساعدة</b>

💰 <b>إيداع</b> — اختر المبلغ بالدولار ثم العملة (مثل USDT-TRC20)، وسيصلك عنوان دفع فريد مع رمز QR. يتم إضافة الرصيد <b>تلقائياً</b> بعد تأكيد الشبكة.
📈 <b>استثمار</b> — اختر أحد المستويات الخمس وأدخل المبلغ.
📊 <b>استثماراتي</b> — تابع عقودك النشطة وأرباحها اليومية.
💼 <b>محفظتي</b> — رصيدك وإجمالياتك وسجل عملياتك.
💸 <b>سحب</b> — اسحب رصيدك إلى عنوان محفظتك.

🆘 للدعم: راسل المشغّل.`;

function levelsText() {
  let text = `📈 <b>المستويات الاستثمارية</b>\n\n`;
  for (const l of INVESTMENT_LEVELS) {
    const range = l.max === Infinity ? `${l.min}$ وأكثر` : `${l.min}$ — ${l.max}$`;
    const total = (l.dailyRate * l.durationDays).toFixed(1);
    text += `${l.name}\n`;
    text += `   💵 المبلغ: <b>${range}</b>\n`;
    text += `   📊 الربح اليومي: <b>${l.dailyRate}%</b>\n`;
    text += `   📅 المدة: <b>${l.durationDays} يوم</b>\n`;
    text += `   🏆 إجمالي الأرباح: <b>${total}%</b>\n\n`;
  }
  text += `اختر المستوى المناسب لمبلغك 👇`;
  return text;
}

function walletText(user, activeCount) {
  return `💼 <b>محفظتي</b>

💰 الرصيد الحالي: <b>${usd(user.balance)}</b>
📥 إجمالي الإيداعات: <b>${usd(user.total_deposited)}</b>
📤 إجمالي السحوبات: <b>${usd(user.total_withdrawn)}</b>
💸 إجمالي الأرباح: <b>${usd(user.total_profit)}</b>
📈 عقود استثمار نشطة: <b>${activeCount}</b>

🔗 رمز الإحالة الخاص بك: <code>${user.referral_code || '—'}</code>`;
}

function investmentItemText(inv, summary) {
  const statusEmoji = inv.status === 'active' ? '🟢' : '⚪️';
  const bar = '█'.repeat(Math.round((summary.progressPct / 100) * 10)) +
              '░'.repeat(10 - Math.round((summary.progressPct / 100) * 10));
  return `${statusEmoji} <b>عقد #${inv.id}</b> — مستوى ${inv.level}
   💵 رأس المال: <b>${usd(inv.amount)}</b>
   📊 الربح اليومي: <b>${usd(summary.dailyProfit)}</b> (${inv.daily_rate / 1_000_000 * 100}%)
   📅 التقدم: ${bar} ${summary.progressPct}%  (${inv.paid_days}/${inv.duration_days} يوم)
   🏆 الأرباح المدفوعة: <b>${usd(inv.earned)}</b>
   ⏭️ القادم: ${inv.status === 'active' ? summary.nextPayout : 'اكتمل'}${inv.status === 'active' ? ` | ينتهي ${inv.end_date}` : ''}`;
}

function transactionsText(txs) {
  if (txs.length === 0) return 'لا توجد عمليات بعد.';
  const labels = {
    deposit: '📥 إيداع', invest: '📈 استثمار', profit: '💸 ربح يومي',
    capital: '🔄 إعادة رأس مال', withdraw: '📤 سحب', refund: '↩️ إرجاع',
  };
  return txs.map((t) => {
    const sign = t.amount >= 0 ? '+' : '';
    const date = t.created_at?.slice(0, 10) || '';
    return `${labels[t.type] || t.type} ${sign}${formatMoney(Math.abs(t.amount), { decimals: 2, symbol: '$' })} — ${date}`;
  }).join('\n');
}

export const messages = {
  WELCOME, HELP, levelsText, walletText, investmentItemText, transactionsText,
};
