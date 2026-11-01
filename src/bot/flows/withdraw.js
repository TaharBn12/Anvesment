import { config } from '../../config.js';
import { setState, clearState, getState } from '../../services/users.js';
import { createWithdrawal, getUserWithdrawals } from '../../services/withdrawals.js';
import { DEFAULT_DEPOSIT_CURRENCIES, STATES } from '../../constants.js';
import { parsePositiveAmount, toMicro, fromMicro } from '../../utils/money.js';
import { usd } from '../../utils/format.js';
import { withdrawCurrencyKeyboard, confirmWithdrawKeyboard, mainMenu, backKeyboard } from '../keyboards.js';

export function registerWithdrawHandlers(bot) {
  bot.hears('💸 سحب', async (ctx) => {
    const user = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.from.id);
    if (user.balance <= 0n) {
      await ctx.replyWithHTML(`💼 رصيدك <b>${usd(user.balance)}</b> — لا يوجد ما يمكن سحبه.`, mainMenu());
      return;
    }
    setState(ctx.db, ctx.from.id, STATES.WITHDRAW_AMOUNT);
    await ctx.replyWithHTML(
      `💸 <b>طلب سحب</b>\n\n` +
      `💼 رصيدك المتاح: <b>${usd(user.balance)}</b>\n` +
      `▫️ الحد الأدنى للسحب: <b>${config.minWithdraw}$</b>\n\n` +
      `أدخل المبلغ الذي تريد سحبه (بالدولار):`,
      backKeyboard()
    );
  });

  // اختيار عملة السحب
  bot.action(/^wd_cur:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const { data: stateData } = getState(ctx.db, ctx.from.id);
    if (!stateData?.amount) {
      clearState(ctx.db, ctx.from.id);
      await ctx.reply('انتهت الجلسة، ابدأ من زر 💸 سحب', mainMenu());
      return;
    }
    setState(ctx.db, ctx.from.id, STATES.WITHDRAW_ADDRESS, {
      amount: stateData.amount,
      currency: ctx.match[1],
    });
    await ctx.replyWithHTML(
      `📤 أرسل الآن <b>عنوان محفظتك</b> الخاص بعملة ${ctx.match[1].toUpperCase()}:\n\n` +
      `⚠️ تأكد من العنوان والشبكة — التحويلات لا يمكن التراجع عنها.`,
      backKeyboard()
    );
  });

  // تأكيد الطلب
  bot.action('wd_confirm', async (ctx) => {
    await ctx.answerCbQuery();
    const { data: stateData } = getState(ctx.db, ctx.from.id);
    if (!stateData?.amount || !stateData?.currency || !stateData?.address) {
      clearState(ctx.db, ctx.from.id);
      await ctx.reply('انتهت الجلسة، ابدأ من زر 💸 سحب', mainMenu());
      return;
    }
    try {
      const w = createWithdrawal(ctx.db, ctx.from.id, toMicro(stateData.amount), stateData.currency, stateData.address);
      clearState(ctx.db, ctx.from.id);
      await ctx.replyWithHTML(
        `✅ <b>تم استلام طلب السحب</b>\n\n` +
        `🧾 رقم الطلب: <b>#${w.id}</b>\n` +
        `💵 المبلغ: <b>${stateData.amount}$</b>\n` +
        `🪙 العملة: <b>${stateData.currency.toUpperCase()}</b>\n` +
        `🏦 العنوان: <code>${stateData.address}</code>\n\n` +
        `⏳ قيد المراجعة من الإدارة، وسيصلك إشعار عند التنفيذ.`,
        mainMenu()
      );
      // إشعار الأدمن
      for (const adminId of config.adminIds) {
        await ctx.telegram.sendMessage(adminId,
          `🔔 <b>طلب سحب جديد #${w.id}</b>\n` +
          `👤 المستخدم: ${ctx.from.id} (@${ctx.from.username || '—'})\n` +
          `💵 المبلغ: ${stateData.amount}$\n` +
          `🪙 العملة: ${stateData.currency.toUpperCase()}\n` +
          `🏦 العنوان: <code>${stateData.address}</code>\n\n` +
          `افتح /admin للمراجعة.`,
          { parse_mode: 'HTML' }
        ).catch(() => {});
      }
    } catch (err) {
      await ctx.replyWithHTML(`❌ فشل إنشاء الطلب: ${err.message}`, mainMenu());
      clearState(ctx.db, ctx.from.id);
    }
  });

  // سحوباتي
  bot.action('wallet_withdrawals', async (ctx) => {
    await ctx.answerCbQuery();
    const list = getUserWithdrawals(ctx.db, ctx.from.id, 10);
    if (list.length === 0) {
      await ctx.reply('لا توجد سحوبات بعد.');
      return;
    }
    const labels = { pending: '⏳ قيد المراجعة', approved: '🔄 موافق عليه', paid: '✅ مدفوع', rejected: '❌ مرفوض' };
    const text = list.map((w) =>
      `🧾 #${w.id} — 💵 ${fromMicro(w.amount).toFixed(2)}$ | 🪙 ${w.currency.toUpperCase()} | ${labels[w.status] || w.status} | ${w.created_at?.slice(0, 10)}`
    ).join('\n');
    await ctx.replyWithHTML(`📤 <b>سحوباتي</b>\n\n${text}`, mainMenu());
  });
}

/** معالجة إدخال المبلغ والعنوان (تُستدعى من الموجّه المركزي) */
export async function handleWithdrawInput(ctx, text) {
  const { state, data: stateData } = getState(ctx.db, ctx.from.id);

  if (state === STATES.WITHDRAW_AMOUNT) {
    const amount = parsePositiveAmount(text);
    if (amount === null) {
      await ctx.reply('⚠️ أدخل مبلغاً صحيحاً (مثال: 25)');
      return;
    }
    if (amount < config.minWithdraw) {
      await ctx.reply(`⚠️ الحد الأدنى للسحب هو ${config.minWithdraw}$`);
      return;
    }
    const user = ctx.db.prepare('SELECT balance FROM users WHERE id = ?').get(ctx.from.id);
    if (BigInt(user.balance) < toMicro(amount)) {
      await ctx.reply(`⚠️ رصيدك غير كافٍ. رصيدك: ${usd(user.balance)}`);
      return;
    }
    setState(ctx.db, ctx.from.id, STATES.WITHDRAW_CURRENCY, { amount });
    await ctx.replyWithHTML('اختر عملة السحب:', withdrawCurrencyKeyboard());
    return;
  }

  if (state === STATES.WITHDRAW_CURRENCY) {
    await ctx.reply('⚠️ اختر العملة من الأزرار أعلاه.');
    return;
  }

  if (state === STATES.WITHDRAW_ADDRESS) {
    const address = String(text).trim();
    if (address.length < 10) {
      await ctx.reply('⚠️ العنوان قصير جداً، تأكد منه وأعد الإرسال.');
      return;
    }
    setState(ctx.db, ctx.from.id, STATES.WITHDRAW_ADDRESS, {
      amount: stateData?.amount,
      currency: stateData?.currency,
      address,
    });
    await ctx.replyWithHTML(
      `📝 <b>تأكيد طلب السحب</b>\n\n` +
      `💵 المبلغ: <b>${stateData?.amount}$</b>\n` +
      `🪙 العملة: <b>${stateData?.currency?.toUpperCase()}</b>\n` +
      `🏦 العنوان: <code>${address}</code>\n\n` +
      `⚠️ تأكد من صحة العنوان والشبكة.`,
      confirmWithdrawKeyboard()
    );
  }
}

export { DEFAULT_DEPOSIT_CURRENCIES };
