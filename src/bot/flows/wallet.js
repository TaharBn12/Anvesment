import { messages } from '../messages.js';
import { getUserInvestments } from '../../services/investments.js';
import { getTransactions } from '../../services/wallet.js';
import { mainMenu, walletActionsKeyboard } from '../keyboards.js';

export function registerWalletHandlers(bot) {
  bot.hears('💼 محفظتي', async (ctx) => {
    const user = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.from.id);
    const active = getUserInvestments(ctx.db, ctx.from.id, { onlyActive: true });
    await ctx.replyWithHTML(messages.walletText(user, active.length), walletActionsKeyboard());
  });

  // سجل آخر العمليات
  bot.action('wallet_tx', async (ctx) => {
    await ctx.answerCbQuery();
    const txs = getTransactions(ctx.db, ctx.from.id, 15);
    await ctx.replyWithHTML(
      `🧾 <b>آخر العمليات</b>\n\n${messages.transactionsText(txs)}`,
      mainMenu()
    );
  });

  // إيداعاتي السابقة
  bot.action('wallet_deposits', async (ctx) => {
    await ctx.answerCbQuery();
    const { getUserDeposits } = await import('../../services/deposits.js');
    const deposits = getUserDeposits(ctx.db, ctx.from.id, 10);
    if (deposits.length === 0) {
      await ctx.reply('لا توجد إيداعات بعد.');
      return;
    }
    const statusLabels = {
      waiting: '⏳ في الانتظار', confirming: '🔄 قيد التأكيد',
      confirmed: '✅ مؤكد', sending: '📤 جارٍ الإرسال',
      finished: '✅ مكتمل', partially_paid: '⚠️ دفع جزئي',
      failed: '❌ فاشل', expired: '⌛️ منتهي', refunded: '↩️ مسترد',
    };
    const text = deposits.map((d) =>
      `🧾 <code>${d.invoice_id}</code>\n` +
      `   💵 ${(d.price_amount / 1_000_000).toFixed(2)}$ | 🪙 ${d.pay_currency?.toUpperCase()} | ` +
      `${statusLabels[d.status] || d.status} | ${d.created_at?.slice(0, 10)}`
    ).join('\n\n');
    await ctx.replyWithHTML(`📥 <b>إيداعاتي</b>\n\n${text}`, mainMenu());
  });
}

export default registerWalletHandlers;
