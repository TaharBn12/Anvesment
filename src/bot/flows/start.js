import { config, isAdmin } from '../../config.js';
import { upsertUser } from '../../services/users.js';
import { messages } from '../messages.js';
import { mainMenu } from '../keyboards.js';

/** تسجيل المستخدم وإظهار القائمة الرئيسية */
export function registerStartHandlers(bot) {
  bot.start(async (ctx) => {
    const user = upsertUser(ctx.db, ctx.from, { isAdmin: isAdmin(ctx.from.id) });
    await ctx.replyWithHTML(messages.WELCOME(user.first_name || 'بك'), mainMenu({ isAdmin: isAdmin(ctx.from.id) }));
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
