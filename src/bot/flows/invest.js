import { config } from '../../config.js';
import { setState, clearState, getState } from '../../services/users.js';
import { createInvestment, getUserInvestments, investmentSummary } from '../../services/investments.js';
import { getLevel, INVESTMENT_LEVELS, STATES } from '../../constants.js';
import { parsePositiveAmount, toMicro, fromMicro } from '../../utils/money.js';
import { usd } from '../../utils/format.js';
import { messages } from '../messages.js';
import { levelsKeyboard, confirmInvestKeyboard, mainMenu, backKeyboard } from '../keyboards.js';

export function registerInvestHandlers(bot) {
  // ---- عرض المستويات ----
  bot.hears('📈 استثمار', async (ctx) => {
    const user = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.from.id);
    await ctx.replyWithHTML(
      messages.levelsText() + `\n\n💼 رصيدك الحالي: <b>${usd(user.balance)}</b>`,
      levelsKeyboard()
    );
  });

  // ---- اختيار مستوى → طلب المبلغ ----
  bot.action(/^inv_level:(\d)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const level = getLevel(ctx.match[1]);
    if (!level) return;

    const user = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.from.id);
    if (user.balance <= 0n) {
      await ctx.replyWithHTML(
        `💼 رصيدك الحالي <b>${usd(user.balance)}</b>\n` +
        `قم بالإيداع أولاً من زر 💰 إيداع.`,
        mainMenu()
      );
      return;
    }

    const range = level.max === Infinity ? `${level.min}$ وأكثر` : `${level.min}$ — ${level.max}$`;
    setState(ctx.db, ctx.from.id, STATES.INVEST_AMOUNT, { level: level.level });
    await ctx.replyWithHTML(
      `${level.name}\n` +
      `💵 المبلغ المسموح: <b>${range}</b>\n` +
      `📊 الربح اليومي: <b>${level.dailyRate}%</b> لمدة <b>${level.durationDays} يوم</b>\n` +
      `🏆 إجمالي الأرباح المتوقعة: <b>${(level.dailyRate * level.durationDays).toFixed(1)}%</b>\n\n` +
      `💼 رصيدك: <b>${usd(user.balance)}</b>\n` +
      `أدخل المبلغ الذي تريد استثماره (بالدولار):`,
      backKeyboard()
    );
  });

  // ---- عرض استثماراتي ----
  bot.hears('📊 استثماراتي', async (ctx) => {
    const investments = getUserInvestments(ctx.db, ctx.from.id);
    if (investments.length === 0) {
      await ctx.replyWithHTML(
        `📊 لا توجد استثمارات بعد.\nاختر مستوى من 📈 الاستثمار للبدء.`,
        mainMenu()
      );
      return;
    }
    let text = `📊 <b>استثماراتي</b>\n\n`;
    for (const inv of investments) {
      text += messages.investmentItemText(inv, investmentSummary(inv)) + '\n\n';
    }
    await ctx.replyWithHTML(text, mainMenu());
  });
}

/** معالجة إدخال مبلغ الاستثمار (تُستدعى من الموجّه المركزي) */
export async function handleInvestAmountInput(ctx, text) {
  const { data: stateData } = getState(ctx.db, ctx.from.id);
  const level = getLevel(stateData?.level);
  if (!level) {
    clearState(ctx.db, ctx.from.id);
    await ctx.reply('انتهت الجلسة، ابدأ من 📈 الاستثمار', mainMenu());
    return;
  }

  const amount = parsePositiveAmount(text);
  if (amount === null) {
    await ctx.reply('⚠️ أدخل مبلغاً صحيحاً (مثال: 100)');
    return;
  }
  if (amount < level.min || (level.max !== Infinity && amount > level.max)) {
    const range = level.max === Infinity ? `${level.min}$ وأكثر` : `${level.min}$ — ${level.max}$`;
    await ctx.reply(`⚠️ المبلغ يجب أن يكون في نطاق هذا المستوى: ${range}`);
    return;
  }

  const user = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.from.id);
  const amountMicro = toMicro(amount);
  if (BigInt(user.balance) < amountMicro) {
    await ctx.replyWithHTML(
      `⚠️ رصيدك غير كافٍ.\nالمطلوب: <b>${amount}$</b>\nرصيدك: <b>${usd(user.balance)}</b>`,
      mainMenu()
    );
    return;
  }

  const dailyProfit = (amountMicro * (toMicro(level.dailyRate / 100))) / 1_000_000n;
  setState(ctx.db, ctx.from.id, STATES.INVEST_AMOUNT, { level: level.level, amount });
  await ctx.replyWithHTML(
    `📝 <b>تأكيد الاستثمار</b>\n\n` +
    `${level.name}\n` +
    `💵 رأس المال: <b>${amount}$</b>\n` +
    `📊 الربح اليومي: <b>${fromMicro(dailyProfit).toFixed(2)}$</b>\n` +
    `📅 المدة: <b>${level.durationDays} يوم</b>\n` +
    `🏆 إجمالي الأرباح: <b>${fromMicro(dailyProfit * BigInt(level.durationDays)).toFixed(2)}$</b>\n` +
    `🔄 يُعاد رأس المال كاملاً بعد ${level.durationDays} يوم.\n\n` +
    `سيتم خصم <b>${amount}$</b> من رصيد محفظتك الآن.`,
    confirmInvestKeyboard(level.level)
  );
}

/** تأكيد الاستثمار النهائي */
export async function confirmInvestment(ctx, levelNumber) {
  const { data: stateData } = getState(ctx.db, ctx.from.id);
  const amount = stateData?.pendingAmount ?? stateData?.amount;
  const level = getLevel(levelNumber);
  if (!amount || !level) {
    clearState(ctx.db, ctx.from.id);
    await ctx.reply('انتهت الجلسة، ابدأ من 📈 الاستثمار', mainMenu());
    return;
  }
  try {
    const inv = createInvestment(ctx.db, ctx.from.id, level.level, toMicro(amount));
    clearState(ctx.db, ctx.from.id);
    await ctx.replyWithHTML(
      `🎉 <b>تم تفعيل استثمارك بنجاح!</b>\n\n` +
      `🧾 رقم العقد: <b>#${inv.id}</b>\n` +
      `${level.name}\n` +
      `💵 رأس المال: <b>${amount}$</b>\n` +
      `📅 يبدأ من ${inv.start_date} وينتهي ${inv.end_date}\n` +
      `⏭️ أول ربح يومي: ${inv.next_payout}\n\n` +
      `تابع أرباحك من 📊 استثماراتي.`,
      mainMenu()
    );
  } catch (err) {
    await ctx.replyWithHTML(`❌ فشل تفعيل الاستثمار: ${err.message}`, mainMenu());
    clearState(ctx.db, ctx.from.id);
  }
}

export { INVESTMENT_LEVELS };
