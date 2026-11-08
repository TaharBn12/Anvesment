import QRCode from 'qrcode';
import { config } from '../../config.js';
import { setState, clearState, getState } from '../../services/users.js';
import { createDeposit, generateOrderId } from '../../services/deposits.js';
import { createInvoice, getMinimumPaymentAmount, getEstimate, filterSupportedCurrencies } from '../../api/nowpayments.js';
import { DEFAULT_DEPOSIT_CURRENCIES, STATES } from '../../constants.js';
import { parsePositiveAmount, toMicro, fromMicro } from '../../utils/money.js';
import { depositCurrencyKeyboard, mainMenu, backKeyboard } from '../keyboards.js';
import logger from '../../utils/logger.js';

let currencies = DEFAULT_DEPOSIT_CURRENCIES;

/** رابط الإشعارات المرسل إلى NOWPayments عند إنشاء الفاتورة */
function ipnCallbackUrl() {
  if (!config.webhook.publicUrl) return undefined;
  return `${config.webhook.publicUrl}${config.webhook.path}`;
}

export function registerDepositHandlers(bot) {
  // ---- بدء تدفق الإيداع ----
  bot.hears('💰 إيداع', async (ctx) => {
    setState(ctx.db, ctx.from.id, STATES.DEPOSIT_AMOUNT);
    await ctx.replyWithHTML(
      `💰 <b>إيداع جديد</b>\n\n` +
      `أدخل المبلغ الذي تريد إيداعه <b>بالدولار</b> (مثال: 50)\n\n` +
      `▫️ الحد الأدنى للإيداع: <b>${config.minDeposit}$</b>\n` +
      `▫️ تُحوَّل العملات الرقمية إلى الدولار تلقائياً حسب سعر اللحظة.`,
      backKeyboard()
    );
  });

  bot.action('dep_refresh', async (ctx) => {
    await ctx.answerCbQuery('⏳ جارٍ تحديث القائمة...');
    const codes = await filterSupportedCurrencies(currencies.map((c) => c.code));
    currencies = DEFAULT_DEPOSIT_CURRENCIES.filter((c) => codes.includes(c.code));
    if (currencies.length === 0) currencies = DEFAULT_DEPOSIT_CURRENCIES;
    await ctx.editMessageReplyMarkup(depositCurrencyKeyboard(currencies));
  });

  // ---- اختيار العملة وإنشاء الفاتورة ----
  bot.action(/^dep_cur:(.+)$/, async (ctx) => {
    const code = ctx.match[1];
    await ctx.answerCbQuery();

    const { data: stateData } = getState(ctx.db, ctx.from.id);
    const amountUsd = stateData?.amount;
    if (!amountUsd) {
      await ctx.reply('⏳ انتهت صلاحية الجلسة، ابدأ من جديد عبر زر 💰 إيداع', mainMenu());
      return;
    }

    await ctx.editMessageText(`⏳ جارٍ إنشاء عنوان الدفع بعملة ${code.toUpperCase()}...`);

    try {
      // الحد الأدنى الفعلي من NOWPayments لهذه العملة
      const minAmount = await getMinimumPaymentAmount(code, config.currency);
      const estimate = await getEstimate(amountUsd, config.currency, code);
      if (estimate.estimated_amount < minAmount) {
        await ctx.replyWithHTML(
          `⚠️ المبلغ صغير جداً لهذه العملة.\n` +
          `الحد الأدنى للدفع بـ ${code.toUpperCase()}: <b>${minAmount}</b>\n` +
          `أعد المحاولة بمبلغ أكبر أو عملة أخرى.`
        );
        return;
      }

      const orderId = generateOrderId(ctx.from.id);
      const invoice = await createInvoice({
        priceAmount: amountUsd,
        payCurrency: code,
        orderId,
        orderDescription: `إيداع ${amountUsd}$ — مستخدم ${ctx.from.id}`,
        ipnCallbackUrl: ipnCallbackUrl(),
      });

      createDeposit(ctx.db, {
        userId: ctx.from.id,
        invoiceId: String(invoice.id),
        orderId,
        orderDesc: `إيداع ${amountUsd}$`,
        priceAmountMicro: toMicro(amountUsd),
        priceCurrency: config.currency,
        payCurrency: code,
        payAmount: invoice.pay_amount,
        payAddress: invoice.pay_address,
      });
      clearState(ctx.db, ctx.from.id);

      // رسالة العنوان + رمز QR
      const qrBuffer = await QRCode.toBuffer(invoice.pay_address, { margin: 1, width: 400 });
      const caption =
        `📩 <b>تفاصيل الإيداع</b>\n\n` +
        `💵 أرسل بالضبط: <b>${invoice.pay_amount} ${code.toUpperCase()}</b>\n` +
        `🏦 إلى العنوان:\n<code>${invoice.pay_address}</code>\n\n` +
        `🧾 رقم الفاتورة: <code>${invoice.id}</code>\n` +
        `⏳ الحالة: في انتظار الدفع...\n\n` +
        `✅ سيتم إضافة <b>${fromMicro(toMicro(amountUsd)).toFixed(2)}$</b> إلى رصيدك <b>تلقائياً</b> ` +
        `بعد تأكيد الشبكة (عادة دقائق). لا تغيّر المبلغ أو العملة.`;

      await ctx.replyWithPhoto({ source: qrBuffer }, { caption, parse_mode: 'HTML' });
      logger.info(`فاتورة إيداع جديدة: مستخدم ${ctx.from.id} — ${amountUsd}$ بـ ${code}`);
    } catch (err) {
      logger.error('فشل إنشاء فاتورة الإيداع:', err.message);
      await ctx.replyWithHTML(
        `❌ فشل إنشاء عنوان الدفع.\nالسبب: <code>${err.message}</code>\n` +
        `تأكد من مفتاح NOWPayments وحاول لاحقاً.`,
        mainMenu()
      );
      clearState(ctx.db, ctx.from.id);
    }
  });
}

/** معالجة إدخال المبلغ (تُستدعى من الموجّه المركزي) */
export async function handleDepositAmountInput(ctx, text) {
  const amount = parsePositiveAmount(text);
  if (amount === null) {
    await ctx.reply('⚠️ أدخل مبلغاً صحيحاً بالدولار (مثال: 50)');
    return;
  }
  if (amount < config.minDeposit) {
    await ctx.reply(`⚠️ الحد الأدنى للإيداع هو ${config.minDeposit}$`);
    return;
  }
  setState(ctx.db, ctx.from.id, STATES.DEPOSIT_AMOUNT, { amount });
  await ctx.replyWithHTML(
    `💵 المبلغ: <b>${amount}$</b>\nاختر العملة التي تريد الإيداع بها:`,
    depositCurrencyKeyboard(currencies)
  );
}
