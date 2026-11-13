import { config } from '../../config.js';
import { setState, clearState, getState } from '../../services/users.js';
import { createDeposit, generateOrderId, getUserDeposits } from '../../services/deposits.js';
import { createInvoice, getMinimumPaymentAmount, getEstimate, filterSupportedCurrencies, getInvoice } from '../../api/nowpayments.js';
import { DEFAULT_DEPOSIT_CURRENCIES, STATES, SUCCESS_PAYMENT_STATUSES } from '../../constants.js';
import { parsePositiveAmount, toMicro, fromMicro } from '../../utils/money.js';
import { depositCurrencyKeyboard, depositPayLinkKeyboard, mainMenu, backKeyboard } from '../keyboards.js';
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

  // ---- تحديث حالة الدفع يدوياً (زر «🔄 تحديث حالة الدفع») ----
  // المتابعة الدورية تكفي عادةً، لكن الزر يعطي المستخدم رداً فورياً.
  bot.action('dep_check', async (ctx) => {
    await ctx.answerCbQuery('⏳ جارٍ التحقق من الحالة...');
    try {
      const last = getUserDeposits(ctx.db, ctx.from.id, 1)[0];
      if (!last) {
        await ctx.replyWithHTML('ما عندك إيداعات سابقة.', mainMenu());
        return;
      }
      const invoice = await getInvoice(String(last.invoice_id));
      const status = String(invoice.payment_status || last.status);
      const paid = SUCCESS_PAYMENT_STATUSES.includes(status);

      await ctx.replyWithHTML(
        `🔎 <b>حالة إيداعك</b>\n\n` +
        `💵 المبلغ: <b>${fromMicro(last.price_amount).toFixed(2)}$</b>\n` +
        `🪙 العملة: <b>${(last.pay_currency || '').toUpperCase()}</b>\n` +
        `📊 الحالة: <b>${status}</b>\n\n` +
        (paid
          ? '✅ وصلتنا العملية — الرصيد يُضاف الآن إن ما أُضيف بعد.'
          : '⏳ لسّه في الانتظار. أرسل المبلغ ثم انتظر قليلاً.'),
        mainMenu()
      );
    } catch (err) {
      logger.warn('فشل التحقق من حالة الإيداع:', err.message);
      await ctx.replyWithHTML(
        '⚠️ تعذّر التحقق الآن. جرّب بعد قليل — المتابعة التلقائية مستمرة.',
        mainMenu()
      );
    }
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

      // ---- رسالة بسيطة: العنوان فقط ----
      // NOWPayments يرجّع إمّا عنوان دفع مباشر (pay_address) أو رابط صفحة
      // دفع مستضافة (invoice_url) — نتعرّف على الاثنين ونعرض المناسب.
      const amountText = `${fromMicro(toMicro(amountUsd)).toFixed(2)}$`;
      const hasAddress = typeof invoice.pay_address === 'string' && invoice.pay_address.length > 0;

      if (hasAddress) {
        // الكمية بالعملة الرقمية قد تكون مفقودة في استجابة الصفحة المستضافة
        const cryptoAmount = invoice.pay_amount
          ? `\n📦 الكمية المطلوبة: <b>${invoice.pay_amount} ${code.toUpperCase()}</b>`
          : '';
        await ctx.replyWithHTML(
          `💵 أرسل <b>${amountText}</b> بعملة <b>${code.toUpperCase()}</b>\n` +
          `🏦 إلى هذا العنوان:\n<code>${invoice.pay_address}</code>${cryptoAmount}\n\n` +
          `⏳ سنخبرك تلقائياً عند وصول المبلغ ✅`,
          mainMenu()
        );
      } else {
        await ctx.replyWithHTML(
          `💵 أرسل <b>${amountText}</b> بعملة <b>${code.toUpperCase()}</b>\n\n` +
          `🔗 اضغط الزر بالأسفل لفتح صفحة الدفع:\n\n` +
          `⏳ سنخبرك تلقائياً عند وصول المبلغ ✅`,
          depositPayLinkKeyboard(invoice.invoice_url)
        );
      }
      logger.info(`فاتورة إيداع جديدة: مستخدم ${ctx.from.id} — ${amountUsd}$ بـ ${code}` +
        (hasAddress ? '' : ' (صفحة دفع مستضافة)'));
    } catch (err) {
      // استجابة NOWPayments عند الأخطاء (401 مفتاح خاطئ، عملة غير مدعومة...)
      const apiDetail = err.response?.data
        ? `\nاستجابة NOWPayments: <code>${JSON.stringify(err.response.data).slice(0, 200)}</code>`
        : '';
      logger.error('فشل إنشاء فاتورة الإيداع:', err.message, apiDetail ? JSON.stringify(err.response.data) : '');
      await ctx.replyWithHTML(
        `❌ فشل إنشاء عنوان الدفع.\nالسبب: <code>${err.message}</code>${apiDetail}\n` +
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
