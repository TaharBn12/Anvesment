import { Telegraf } from 'telegraf';
import { config, isAdmin as isAdminUser } from '../config.js';
import { clearState, getState, upsertUser } from '../services/users.js';
import { STATES } from '../constants.js';
import { mainMenu } from './keyboards.js';
import { registerStartHandlers } from './flows/start.js';
import { registerDepositHandlers, handleDepositAmountInput } from './flows/deposit.js';
import { registerInvestHandlers, handleInvestAmountInput, confirmInvestment } from './flows/invest.js';
import { registerWalletHandlers } from './flows/wallet.js';
import { registerWithdrawHandlers, handleWithdrawInput } from './flows/withdraw.js';
import { registerAdminHandlers, handleBroadcastInput } from './flows/admin.js';
import logger from '../utils/logger.js';

export function createBot(db) {
  // يُسمح بتوجيه البوت إلى API تلغرام بديل (للاختبار أو Bot API Server محلي)
  const telegramOptions = config.telegramApiRoot
    ? { telegram: { apiRoot: config.telegramApiRoot } }
    : {};
  const bot = new Telegraf(config.botToken, telegramOptions);

  // تمرير قاعدة البيانات لكل سياق
  bot.use(async (ctx, next) => {
    ctx.db = db;
    if (ctx.from) {
      upsertUser(db, ctx.from, { isAdmin: isAdminUser(ctx.from.id) });
    }
    await next();
  });

  // ============================================================
  //  الأزرار التفاعلية (inline)
  // ============================================================
  bot.action('cancel', async (ctx) => {
    await ctx.answerCbQuery();
    clearState(db, ctx.from.id);
    try { await ctx.deleteMessage(); } catch { /* الرسالة قد تكون محذوفة */ }
    await ctx.reply('🏠 القائمة الرئيسية:', mainMenu({ isAdmin: isAdminUser(ctx.from.id) }));
  });

  bot.action(/^inv_confirm:(\d)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await confirmInvestment(ctx, Number(ctx.match[1]));
  });

  // ============================================================
  //  تسجيل معالجات الأقسام
  // ============================================================
  registerStartHandlers(bot);
  registerDepositHandlers(bot);
  registerInvestHandlers(bot);
  registerWalletHandlers(bot);
  registerWithdrawHandlers(bot);
  registerAdminHandlers(bot);

  // ============================================================
  //  الموجّه المركزي للنصوص: يوجّه الإدخال حسب حالة المستخدم
  // ============================================================
  bot.on('text', async (ctx, next) => {
    if (ctx.message.text.startsWith('/')) return next(); // الأوامر تُمرّر

    const { state } = getState(db, ctx.from.id);
    switch (state) {
      case STATES.DEPOSIT_AMOUNT:
        return handleDepositAmountInput(ctx, ctx.message.text);
      case STATES.INVEST_AMOUNT:
        return handleInvestAmountInput(ctx, ctx.message.text);
      case STATES.WITHDRAW_AMOUNT:
      case STATES.WITHDRAW_CURRENCY:
      case STATES.WITHDRAW_ADDRESS:
        return handleWithdrawInput(ctx, ctx.message.text);
      case STATES.BROADCAST:
        return handleBroadcastInput(ctx, ctx.message.text);
      default:
        return next();
    }
  });

  bot.catch((err, ctx) => {
    logger.error(`خطأ في البوت (${ctx?.updateType}):`, err.message);
  });

  return bot;
}

export default createBot;
