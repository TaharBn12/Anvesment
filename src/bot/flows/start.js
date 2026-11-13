import { config, isAdmin } from '../../config.js';
import { upsertUser } from '../../services/users.js';
import { parseReferralPayload, findUserByReferralCode, attachReferrer } from '../../services/referrals.js';
import { messages } from '../messages.js';
import { mainMenu } from '../keyboards.js';
import logger from '../../utils/logger.js';

/** تسجيل المستخدم وإظهار القائمة الرئيسية */
export function registerStartHandlers(bot) {
  bot.start(async (ctx) => {
    const user = upsertUser(ctx.db, ctx.from, { isAdmin: isAdmin(ctx.from.id) });

    // ---- التقاط الإحالة من رابط ?start=ref_CODE ----
    // لازم يصير قبل أي رسالة، ومرة واحدة فقط لكل مستخدم.
    let referrerName = null;
    const code = parseReferralPayload(ctx.startPayload);
    if (code) {
      const referrer = findUserByReferralCode(ctx.db, code);
      if (referrer && referrer.id !== user.id) {
        if (attachReferrer(ctx.db, user.id, referrer.id)) {
          referrerName = referrer.first_name || referrer.username || 'مستخدم';
        }
      } else if (referrer && referrer.id === user.id) {
        logger.warn(`محاولة إحالة ذاتية من ${user.id} — مرفوضة`);
      }
    }

    const welcome = referrerName
      ? `🎉 انضممت عبر رابط <b>${referrerName}</b>!\n\n${messages.WELCOME(user.first_name || 'بك')}`
      : messages.WELCOME(user.first_name || 'بك');
    await ctx.replyWithHTML(welcome, mainMenu({ isAdmin: isAdmin(ctx.from.id) }));
  });

  bot.command('help', async (ctx) => {
    await ctx.replyWithHTML(messages.HELP, mainMenu({ isAdmin: isAdmin(ctx.from.id) }));
  });

  // أمر مساعد: يعرض معرّف تلغرام (لضبطه في ADMIN_IDS)
  bot.command('id', async (ctx) => {
    await ctx.replyWithHTML(
      `🆔 معرّفك في تلغرام: <code>${ctx.from.id}</code>\n` +
      `👤 اسم المستخدم: @${ctx.from.username || '—'}\n\n` +
      `انسخ المعرّف وضعه في <code>ADMIN_IDS</code> داخل ملف .env ثم أعد التشغيل.`
    );
  });

  bot.hears('ℹ️ المساعدة', async (ctx) => {
    await ctx.replyWithHTML(messages.HELP, mainMenu({ isAdmin: isAdmin(ctx.from.id) }));
  });

  bot.hears('❌ إلغاء', async (ctx) => {
    await ctx.reply('تم الإلغاء. اختر من القائمة:', mainMenu());
  });
}

export default registerStartHandlers;
