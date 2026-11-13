// ============================================================
//  تسجيل الأحداث في قناة تلغرام
//
//  كل عملية يبلغ بها النظام (إيداع، سحب، استثمار) تُنسخ تلقائياً
//  لقناة يختارها المشغّل — فيها معرف المستخدم والمبلغ وهاش الدفع.
//
//  التصميم: singleton بسيط (setChannelSender) بدل ما نمرّر الدالة
//  عبر كل الطبقات. السبب: الخدمات المالية (deposits/withdrawals/
//  investments) متزامنة (sync) وما تستقبل bot — وتمرير الوسيط عبر
//  كل نداء يزيد التعقيد بلا فايدة.
//
//  قاعدة ذهبية: فشل التسجيل في القناة **ما يفشل** العملية أبداً.
// ============================================================
import { config } from '../config.js';
import { fromMicro } from '../utils/money.js';
import logger from '../utils/logger.js';

/** دالة الإرسال للقناة — تُضبط من index.js */
let channelSender = null;

/** فلتر الأحداث — يُستخدم للاختبارات فقط */
let eventFilterOverride = null;

/**
 * تجاوز فلتر الأحداث (للاختبارات فقط).
 * @param {string[]|null} list — قائمة الأحداث المسموحة أو null لإلغاء التجاوز
 */
export function setEventFilterForTests(list) {
  eventFilterOverride = list;
}

export function setChannelSender(fn) {
  channelSender = fn;
}

export function channelLogConfigured() {
  return Boolean(config.logChannel.id && channelSender);
}

function isEventEnabled(type) {
  if (!channelLogConfigured()) return false;
  const list = eventFilterOverride ?? config.logChannel.events;
  return list.length === 0 || list.includes(type);
}

/**
 * إرسال حدث للقناة. آمن: أي خطأ يُسجَّل في اللوق فقط.
 * @param {string} type — deposit | withdrawal | investment | profit
 * @param {string} text — نص الرسالة (HTML)
 */
export function logToChannel(type, text) {
  if (!isEventEnabled(type)) return;
  try {
    channelSender(text);
  } catch (err) {
    logger.warn(`فشل التسجيل في القناة (${type}):`, err.message);
  }
}

// ============================================================
//  روابط مستكشفات البلوكشين — تخلّي هاش الدفع قابلاً للتحقق
// ============================================================
export const EXPLORERS = {
  btc: (h) => `https://blockchair.com/bitcoin/transaction/${h}`,
  eth: (h) => `https://etherscan.io/tx/${h}`,
  ltc: (h) => `https://blockchair.com/litecoin/transaction/${h}`,
  usdttrc20: (h) => `https://tronscan.org/#/transaction/${h}`,
  trx: (h) => `https://tronscan.org/#/transaction/${h}`,
  usdtbsc: (h) => `https://bscscan.com/tx/${h}`,
  usdterc20: (h) => `https://etherscan.io/tx/${h}`,
  usdcerc20: (h) => `https://etherscan.io/tx/${h}`,
};

/** رابط تحقق من هاش الدفع — يعيد null لو العملة ما عندها مستكشف معروف */
export function explorerLink(currency, hash) {
  if (!hash) return null;
  const build = EXPLORERS[String(currency || '').toLowerCase()];
  return build ? build(String(hash)) : null;
}

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ============================================================
//  منسّقات الرسائل
// ============================================================

/** إيداع: معرف المستخدم + المبلغ + هاش الدفع + رابط التحقق */
export function formatDepositLog(deposit, { user = null, payinHash = null } = {}) {
  const usd = fromMicro(deposit.price_amount).toFixed(2);
  const cur = String(deposit.pay_currency || '').toUpperCase();
  const link = explorerLink(deposit.pay_currency, payinHash);

  let text = `💰 <b>إيداع جديد</b>\n\n`;
  text += `👤 معرف المستخدم: <code>${deposit.user_id}</code>`;
  if (user?.username) text += ` (@${esc(user.username)})`;
  text += `\n💵 المبلغ: <b>${usd}$</b>\n`;
  text += `🪙 العملة: <b>${cur}</b>\n`;
  if (deposit.pay_amount) text += `📦 الكمية: <b>${esc(deposit.pay_amount)} ${cur}</b>\n`;
  text += `🧾 رقم العملية: <code>${esc(deposit.invoice_id)}</code>\n`;
  text += `🏦 العنوان: <code>${esc(deposit.pay_address || '—')}</code>\n`;
  if (payinHash) {
    text += `🔗 هاش الدفع: <code>${esc(payinHash)}</code>\n`;
    text += link ? `🔍 <a href="${esc(link)}">تحقق من العملية على البلوكشين</a>\n` : '';
  } else {
    text += `🔗 هاش الدفع: <i>غير متوفر بعد</i>\n`;
  }
  text += `\n📅 ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  return text;
}

/** سحب: معرف المستخدم + المبلغ + العملة + العنوان + الحالة */
export function formatWithdrawalLog(withdrawal, { user = null, event = 'طلب' } = {}) {
  const usd = fromMicro(withdrawal.amount).toFixed(2);
  const cur = String(withdrawal.currency || '').toUpperCase();
  const statusLabels = {
    pending: '⏳ قيد المراجعة', approved: '✅ موافق عليه',
    paid: '💰 مدفوع', rejected: '❌ مرفوض',
  };

  let text = `📤 <b>${event} سحب</b>\n\n`;
  text += `👤 معرف المستخدم: <code>${withdrawal.user_id}</code>`;
  if (user?.username) text += ` (@${esc(user.username)})`;
  text += `\n💵 المبلغ: <b>${usd}$</b>\n`;
  text += `🪙 العملة: <b>${cur}</b>\n`;
  text += `🏦 العنوان: <code>${esc(withdrawal.address)}</code>\n`;
  text += `📊 الحالة: <b>${statusLabels[withdrawal.status] || esc(withdrawal.status)}</b>\n`;
  if (withdrawal.payout_id) text += `🧾 معرّف الدفع: <code>${esc(withdrawal.payout_id)}</code>\n`;
  if (withdrawal.admin_note) text += `📝 ملاحظة: ${esc(withdrawal.admin_note)}\n`;
  text += `#️⃣ رقم الطلب: <code>${withdrawal.id}</code>\n`;
  text += `\n📅 ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  return text;
}

/** استثمار: معرف المستخدم + المستوى + المبلغ + الربح اليومي */
export function formatInvestmentLog(investment, { user = null } = {}) {
  const usd = fromMicro(investment.amount).toFixed(2);
  const daily = (investment.daily_rate / 1_000_000 * 100).toFixed(2);
  const dailyProfit = fromMicro(investment.amount * investment.daily_rate / 1_000_000).toFixed(2);

  let text = `📈 <b>استثمار جديد</b>\n\n`;
  text += `👤 معرف المستخدم: <code>${investment.user_id}</code>`;
  if (user?.username) text += ` (@${esc(user.username)})`;
  text += `\n🏆 المستوى: <b>${investment.level}</b>\n`;
  text += `💵 رأس المال: <b>${usd}$</b>\n`;
  text += `📊 الربح اليومي: <b>${daily}%</b> (${dailyProfit}$)\n`;
  text += `📅 المدة: <b>${investment.duration_days} يوم</b>\n`;
  text += `🗓 البداية: <code>${esc(investment.start_date)}</code> · النهاية: <code>${esc(investment.end_date)}</code>\n`;
  text += `#️⃣ رقم العقد: <code>${investment.id}</code>\n`;
  text += `\n📅 ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  return text;
}

/** ربح يومي مصروف */
export function formatProfitLog(investment, amountMicro) {
  const usd = fromMicro(amountMicro).toFixed(2);
  return `💸 <b>ربح يومي مصروف</b>\n\n` +
    `👤 معرف المستخدم: <code>${investment.user_id}</code>\n` +
    `📈 عقد #${investment.id} (مستوى ${investment.level})\n` +
    `💵 المبلغ: <b>${usd}$</b>\n` +
    `📅 اليوم: <code>${investment.next_payout || '—'}</code>\n\n` +
    `📅 ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}
