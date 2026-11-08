import { Markup } from 'telegraf';
import { INVESTMENT_LEVELS, DEFAULT_DEPOSIT_CURRENCIES } from '../constants.js';

/** القائمة الرئيسية (أزرار ثابتة أسفل الشاشة) */
export function mainMenu({ isAdmin = false } = {}) {
  const rows = [
    ['💰 إيداع', '📈 استثمار'],
    ['📊 استثماراتي', '💼 محفظتي'],
    ['💸 سحب', 'ℹ️ المساعدة'],
  ];
  if (isAdmin) rows.push(['🛠 لوحة الأدمن']);
  return Markup.keyboard(rows).resize();
}

/** أزرار تفاصيل المحفظة */
export function walletActionsKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🧾 سجل العمليات', 'wallet_tx'),
      Markup.button.callback('📥 إيداعاتي', 'wallet_deposits'),
    ],
    [Markup.button.callback('📤 سحوباتي', 'wallet_withdrawals')],
  ]);
}

/** اختيار عملة الإيداع */
export function depositCurrencyKeyboard(currencies = DEFAULT_DEPOSIT_CURRENCIES) {
  const rows = [];
  for (let i = 0; i < currencies.length; i += 2) {
    rows.push(currencies.slice(i, i + 2).map((c) => Markup.button.callback(c.name, `dep_cur:${c.code}`)));
  }
  rows.push([Markup.button.callback('🔄 تحديث القائمة من NOWPayments', 'dep_refresh')]);
  rows.push([Markup.button.callback('❌ إلغاء', 'cancel')]);
  return Markup.inlineKeyboard(rows);
}

/** اختيار المستوى الاستثماري */
export function levelsKeyboard() {
  const rows = INVESTMENT_LEVELS.map((l) => [
    Markup.button.callback(
      `${l.name} — ${l.dailyRate}% يومياً / ${l.durationDays} يوم`,
      `inv_level:${l.level}`
    ),
  ]);
  rows.push([Markup.button.callback('❌ إلغاء', 'cancel')]);
  return Markup.inlineKeyboard(rows);
}

/** تأكيد الاستثمار */
export function confirmInvestKeyboard(level) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ تأكيد الاستثمار', `inv_confirm:${level}`)],
    [Markup.button.callback('❌ إلغاء', 'cancel')],
  ]);
}

/** اختيار عملة السحب */
export function withdrawCurrencyKeyboard(currencies = DEFAULT_DEPOSIT_CURRENCIES) {
  const rows = [];
  for (let i = 0; i < currencies.length; i += 2) {
    rows.push(currencies.slice(i, i + 2).map((c) => Markup.button.callback(c.name, `wd_cur:${c.code}`)));
  }
  rows.push([Markup.button.callback('❌ إلغاء', 'cancel')]);
  return Markup.inlineKeyboard(rows);
}

/** تأكيد طلب السحب */
export function confirmWithdrawKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ تأكيد السحب', 'wd_confirm')],
    [Markup.button.callback('❌ إلغاء', 'cancel')],
  ]);
}

/** لوحة الأدمن */
export function adminKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('💸 طلبات السحب المعلّقة', 'admin_withdrawals')],
    [Markup.button.callback('▶️ تشغيل صرف الأرباح يدوياً', 'admin_run_payouts')],
    [Markup.button.callback('📣 رسالة جماعية', 'admin_broadcast')],
    [Markup.button.callback('📊 إحصائيات', 'admin_stats')],
  ]);
}

/** أزرار الموافقة/الرفض على طلب سحب */
export function withdrawalActionsKeyboard(withdrawalId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ دفع وإتمام', `wd_approve:${withdrawalId}`),
      Markup.button.callback('❌ رفض وإرجاع', `wd_reject:${withdrawalId}`),
    ],
    [Markup.button.callback('🔙 رجوع', 'admin_withdrawals')],
  ]);
}

/** زر العودة للقائمة */
export function backKeyboard() {
  return Markup.inlineKeyboard([[Markup.button.callback('🔙 القائمة الرئيسية', 'cancel')]]);
}
