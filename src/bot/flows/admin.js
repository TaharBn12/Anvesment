import { config, isAdmin } from '../../config.js';
import { platformStats, countUsers, setState, clearState, getAllUsers } from '../../services/users.js';
import { runDailyPayouts } from '../../services/investments.js';
import { createBackup } from '../../services/backup.js';
import path from 'node:path';
import { getPendingWithdrawals, getWithdrawal, rejectWithdrawal, markWithdrawalPaid, markWithdrawalApproved } from '../../services/withdrawals.js';
import { createPayout, payoutsConfigured } from '../../api/nowpayments.js';
import { STATES } from '../../constants.js';
import { fromMicro } from '../../utils/money.js';
import { usd } from '../../utils/format.js';
import { adminKeyboard, withdrawalActionsKeyboard, mainMenu } from '../keyboards.js';
import logger from '../../utils/logger.js';

function adminOnly(ctx) {
  if (!isAdmin(ctx.from.id)) {
    ctx.reply('⛔️ هذه اللوحة للأدمن فقط.');
    return false;
  }
  return true;
}

export function registerAdminHandlers(bot) {
  bot.command('admin', async (ctx) => {
    if (!adminOnly(ctx)) return;
    await ctx.replyWithHTML('🛠 <b>لوحة الأدمن</b>', adminKeyboard());
  });

  // ---- نسخة احتياطية من قاعدة البيانات (تُرسل كملف للأدمن) ----
  bot.command('backup', async (ctx) => {
    if (!adminOnly(ctx)) return;
    try {
      const file = createBackup(ctx.db);
      await ctx.replyWithDocument(
        { source: file, filename: path.basename(file) },
        {
          caption:
            '💾 <b>نسخة احتياطية من قاعدة البيانات</b>\n\n' +
            '📅 تحتوي كل المستخدمين والأرصدة والاستثمارات حتى هذه اللحظة.\n' +
            '⚠️ احتفظ بها في مكان آمن — ضرورية على المنصات ذات القرص المؤقت (Koyeb).',
          parse_mode: 'HTML',
        }
      );
    } catch (err) {
      logger.error('فشل إنشاء النسخة الاحتياطية:', err.message);
      await ctx.reply(`❌ فشل إنشاء النسخة الاحتياطية: ${err.message}`);
    }
  });

  bot.hears('🛠 لوحة الأدمن', async (ctx) => {
    if (!adminOnly(ctx)) return;
    await ctx.replyWithHTML('🛠 <b>لوحة الأدمن</b>', adminKeyboard());
  });

  // ---- تشغيل صرف الأرباح يدوياً (مفيد عند تعطّل السيرفر يوم الصرف) ----
  bot.action('admin_run_payouts', async (ctx) => {
    if (!adminOnly(ctx)) return;
    await ctx.answerCbQuery('⏳ جارٍ الصرف...');
    const notify = (uid, txt) =>
      ctx.telegram.sendMessage(uid, txt, { parse_mode: 'HTML' }).catch(() => {});
    const result = runDailyPayouts(ctx.db, { notify });
    await ctx.replyWithHTML(
      `✅ تمت معالجة <b>${result.processed}</b> عقد من ${result.total} مستحق اليوم.`
    );
  });

  // ---- الإحصائيات ----
  bot.action('admin_stats', async (ctx) => {
    if (!adminOnly(ctx)) return;
    await ctx.answerCbQuery();
    const s = platformStats(ctx.db);
    await ctx.replyWithHTML(
      `📊 <b>إحصائيات المنصة</b>\n\n` +
      `👥 المستخدمون: <b>${s.users}</b>\n` +
      `📥 إجمالي الإيداعات: <b>${usd(s.deposited)}</b>\n` +
      `📤 إجمالي السحوبات: <b>${usd(s.withdrawn)}</b>\n` +
      `💸 إجمالي الأرباح المصروفة: <b>${usd(s.profit)}</b>\n` +
      `💰 أرصدة المستخدمين: <b>${usd(s.balances)}</b>\n` +
      `📈 عقود نشطة: <b>${s.activeInvestments.n}</b> بقيمة <b>${usd(s.activeInvestments.s)}</b>\n` +
      `⏳ سحوبات معلّقة: <b>${s.pendingWithdrawals.n}</b> بقيمة <b>${usd(s.pendingWithdrawals.s)}</b>\n` +
      `✅ إيداعات مكتملة: <b>${s.depositsFinished}</b>`,
      adminKeyboard()
    );
  });

  // ---- طلبات السحب المعلّقة ----
  bot.action('admin_withdrawals', async (ctx) => {
    if (!adminOnly(ctx)) return;
    await ctx.answerCbQuery();
    const list = getPendingWithdrawals(ctx.db);
    if (list.length === 0) {
      await ctx.reply('✅ لا توجد طلبات سحب معلّقة.', adminKeyboard());
      return;
    }
    for (const w of list) {
      await ctx.replyWithHTML(
        `🔔 <b>طلب سحب #${w.id}</b>\n` +
        `👤 المستخدم: <code>${w.user_id}</code> (@${w.username || '—'})\n` +
        `💵 المبلغ: <b>${fromMicro(w.amount).toFixed(2)}$</b>\n` +
        `🪙 العملة: ${w.currency.toUpperCase()}\n` +
        `🏦 العنوان: <code>${w.address}</code>\n` +
        `📅 التاريخ: ${w.created_at}`,
        withdrawalActionsKeyboard(w.id)
      );
    }
  });

  // ---- الموافقة على سحب (دفع تلقائي عبر NOWPayments إن كان مهيّأً) ----
  bot.action(/^wd_approve:(\d+)$/, async (ctx) => {
    if (!adminOnly(ctx)) return;
    await ctx.answerCbQuery('⏳ جارٍ التنفيذ...');
    const w = getWithdrawal(ctx.db, Number(ctx.match[1]));
    if (!w || w.status !== 'pending') {
      await ctx.reply('الطلب غير موجود أو تمت معالجته.');
      return;
    }
    if (payoutsConfigured()) {
      try {
        const payout = await createPayout({
          address: w.address,
          currency: w.currency,
          amount: fromMicro(w.amount),
        });
        markWithdrawalPaid(ctx.db, w.id, payout.id);
        await ctx.editMessageText(
          `✅ <b>تم دفع الطلب #${w.id}</b>\nمعرّف العملية: <code>${payout.id}</code>`
        );
        await ctx.telegram.sendMessage(w.user_id,
          `✅ <b>تم تنفيذ سحبك #${w.id}</b>\n` +
          `💵 المبلغ: ${fromMicro(w.amount).toFixed(2)}$\n` +
          `🏦 إلى: <code>${w.address}</code>`
        ).catch(() => {});
      } catch (err) {
        logger.error('فشل الدفع التلقائي:', err.message);
        markWithdrawalApproved(ctx.db, w.id);
        await ctx.editMessageText(
          `⚠️ <b>فشل الدفع التلقائي للطلب #${w.id}</b>\n` +
          `السبب: <code>${err.message}</code>\n` +
          `تم تعليم الطلب كـ«موافق عليه» — نفّذ التحويل يدوياً ثم استخدم زر «تم الدفع».`
        );
      }
    } else {
      markWithdrawalApproved(ctx.db, w.id);
      await ctx.editMessageText(
        `✅ <b>تمت الموافقة على الطلب #${w.id}</b>\n` +
        `نفّذ التحويل يدوياً إلى:\n<code>${w.address}</code>\n` +
        `ثم استخدم زر «تم الدفع» من القائمة.`,
        withdrawalActionsKeyboard(w.id)
      );
      await ctx.telegram.sendMessage(w.user_id,
        `✅ <b>تمت الموافقة على سحبك #${w.id}</b> وجارٍ تنفيذه.`
      ).catch(() => {});
    }
  });

  // ---- رفض سحب ----
  bot.action(/^wd_reject:(\d+)$/, async (ctx) => {
    if (!adminOnly(ctx)) return;
    await ctx.answerCbQuery();
    const w = getWithdrawal(ctx.db, Number(ctx.match[1]));
    if (!w || w.status !== 'pending') {
      await ctx.reply('الطلب غير موجود أو تمت معالجته.');
      return;
    }
    rejectWithdrawal(ctx.db, w.id, 'رفض من الأدمن');
    await ctx.editMessageText(`❌ <b>تم رفض الطلب #${w.id}</b> وإرجاع المبلغ للمحفظة.`);
    await ctx.telegram.sendMessage(w.user_id,
      `❌ <b>تم رفض طلب السحب #${w.id}</b> وأُعيد المبلغ إلى محفظتك.`
    ).catch(() => {});
  });

  // ---- تعليم كمدفوع يدوياً ----
  bot.action(/^wd_markpaid:(\d+)$/, async (ctx) => {
    if (!adminOnly(ctx)) return;
    await ctx.answerCbQuery();
    const w = getWithdrawal(ctx.db, Number(ctx.match[1]));
    if (!w) return;
    markWithdrawalPaid(ctx.db, w.id);
    await ctx.editMessageText(`✅ <b>تم تعليم الطلب #${w.id} كمدفوع.</b>`);
  });

  // ---- الرسائل الجماعية ----
  bot.action('admin_broadcast', async (ctx) => {
    if (!adminOnly(ctx)) return;
    await ctx.answerCbQuery();
    setState(ctx.db, ctx.from.id, STATES.BROADCAST);
    await ctx.reply('📣 أرسل نص الرسالة الجماعية الآن (أو /admin للإلغاء):');
  });

  bot.hears('📣 رسالة جماعية', async (ctx) => {
    if (!adminOnly(ctx)) return;
    setState(ctx.db, ctx.from.id, STATES.BROADCAST);
    await ctx.reply('📣 أرسل نص الرسالة الجماعية الآن:');
  });
}

/** معالجة إدخال الرسالة الجماعية */
export async function handleBroadcastInput(ctx, text) {
  clearState(ctx.db, ctx.from.id);
  // تهريب رموز HTML في نص الأدمن حتى لا يفشل الإرسال
  const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const users = getAllUsers(ctx.db);
  let sent = 0;
  let failed = 0;
  for (const u of users) {
    try {
      await ctx.telegram.sendMessage(u.id, `📣 <b>رسالة من الإدارة</b>\n\n${safe}`, { parse_mode: 'HTML' });
      sent++;
      if (sent % 25 === 0) await new Promise((r) => setTimeout(r, 1000)); // احترام حدود تلغرام
    } catch {
      failed++;
    }
  }
  await ctx.reply(`✅ تم الإرسال إلى ${sent} مستخدم${failed ? ` (فشل ${failed})` : ''}.`, mainMenu({ isAdmin: true }));
}

export default registerAdminHandlers;
