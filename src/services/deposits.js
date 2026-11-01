import crypto from 'node:crypto';
import { FINAL_PAYMENT_STATUSES, SUCCESS_PAYMENT_STATUSES } from '../constants.js';
import { toMicro, fromMicro } from '../utils/money.js';
import { creditWallet, bumpTotals } from './wallet.js';
import logger from '../utils/logger.js';

/** إنشاء طلب إيداع جديد (يُستدعى بعد إنشاء الفاتورة في NOWPayments) */
export function createDeposit(db, {
  userId, invoiceId, orderId, orderDesc,
  priceAmountMicro, priceCurrency, payCurrency, payAmount, payAddress,
}) {
  const desc = orderDesc ?? null;
  const amount = payAmount ?? null;
  const address = payAddress ?? null;
  const currency = payCurrency ?? null;
  db.prepare(
    `INSERT INTO deposits
      (user_id, invoice_id, order_id, order_desc, price_amount, price_currency,
       pay_currency, pay_amount, pay_address, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting')`
  ).run(userId, invoiceId, orderId, desc, priceAmountMicro, priceCurrency,
        currency, amount, address);
  return db.prepare('SELECT * FROM deposits WHERE invoice_id = ?').get(invoiceId);
}

export function getDepositByInvoice(db, invoiceId) {
  return db.prepare('SELECT * FROM deposits WHERE invoice_id = ?').get(invoiceId);
}

export function getDepositById(db, id) {
  return db.prepare('SELECT * FROM deposits WHERE id = ?').get(id);
}

export function getUserDeposits(db, userId, limit = 10) {
  return db.prepare(
    'SELECT * FROM deposits WHERE user_id = ? ORDER BY id DESC LIMIT ?'
  ).all(userId, limit);
}

/** الإيداعات المعلّقة التي يجب متابعتها مع NOWPayments */
export function getPendingDeposits(db) {
  return db.prepare(
    `SELECT * FROM deposits WHERE credited = 0 AND status IN ('waiting','confirming','sending','confirmed')`
  ).all();
}

/** تحديث حالة إيداع من إشعار NOWPayments */
export function updateDepositStatus(db, deposit, { status, actuallyPaid, payAmount, payAddress }) {
  db.prepare(
    `UPDATE deposits
     SET status = ?, actually_paid = COALESCE(?, actually_paid),
         pay_amount = COALESCE(?, pay_amount),
         pay_address = COALESCE(?, pay_address),
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(status, actuallyPaid ?? null, payAmount ?? null, payAddress ?? null, deposit.id);
}

/**
 * إضافة قيمة الإيداع إلى رصيد المحفظة — آمنة ضد التكرار (idempotent).
 * تُستدعى من الـ Webhook أو من مهمة المتابعة الدورية.
 * notify: دالة إشعار المستخدم (userId, text) — اختيارية.
 */
export function creditDeposit(db, deposit, notify = null) {
  if (deposit.credited) return { alreadyCredited: true };

  // حساب المبلغ المستحق بالدولار:
  // - عند الدفع الكامل: المبلغ المطلوب كاملاً
  // - عند الدفع الجزئي: نسبة المدفوع فعلياً من المبلغ المطلوب
  let amountMicro;
  if (deposit.status === 'partially_paid' && deposit.actually_paid && deposit.pay_amount) {
    const ratio = Number(deposit.actually_paid) / Number(deposit.pay_amount);
    amountMicro = toMicro(fromMicro(deposit.price_amount) * ratio);
  } else {
    amountMicro = deposit.price_amount;
  }

  if (amountMicro <= 0n) {
    updateDepositStatus(db, deposit, { status: 'failed' });
    return { alreadyCredited: false, failed: true };
  }

  db.exec('BEGIN');
  try {
    creditWallet(db, deposit.user_id, amountMicro, {
      type: 'deposit',
      refType: 'deposit',
      refId: String(deposit.id),
      note: `إيداع ${deposit.pay_currency?.toUpperCase()} — فاتورة ${deposit.invoice_id}`,
    });
    bumpTotals(db, deposit.user_id, { deposited: amountMicro });
    db.prepare('UPDATE deposits SET credited = 1, status = ? WHERE id = ?')
      .run(deposit.status, deposit.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    logger.error('فشل إضافة الإيداع للرصيد:', err.message);
    throw err;
  }

  logger.ok(`إيداع ناجح: مستخدم ${deposit.user_id} بمبلغ ${fromMicro(amountMicro)} ${deposit.price_currency}`);
  notify?.(deposit.user_id,
    `✅ <b>تم تأكيد إيداعك!</b>\n\n` +
    `💵 المبلغ المضاف: <b>${fromMicro(amountMicro).toFixed(2)}$</b>\n` +
    `🪙 العملة: ${deposit.pay_currency?.toUpperCase()}\n` +
    `🧾 الفاتورة: <code>${deposit.invoice_id}</code>\n\n` +
    `يمكنك الآن استثمار مبلغك من قسم 📈 الاستثمار.`
  );
  return { alreadyCredited: false, amountMicro };
}

/**
 * معالجة إشعار دفع قادم من NOWPayments (أو نتيجة متابعة دورية).
 * يعيد: 'credited' | 'updated' | 'ignored'
 */
export function handlePaymentUpdate(db, payload, notify = null) {
  const deposit = getDepositByInvoice(db, String(payload.invoice_id));
  if (!deposit) {
    logger.warn('إشعار لفاتورة غير معروفة:', payload.invoice_id);
    return 'ignored';
  }

  const status = String(payload.payment_status || '').toLowerCase();
  updateDepositStatus(db, deposit, {
    status,
    actuallyPaid: payload.actually_paid,
    payAmount: payload.pay_amount,
    payAddress: payload.pay_address,
  });

  if (SUCCESS_PAYMENT_STATUSES.includes(status)) {
    const fresh = getDepositById(db, deposit.id);
    creditDeposit(db, fresh, notify);
    return 'credited';
  }

  if (['failed', 'expired', 'refunded'].includes(status)) {
    notify?.(deposit.user_id,
      `❌ <b>فشل الإيداع</b>\n\nالفاتورة: <code>${deposit.invoice_id}</code>\n` +
      `الحالة: ${status}\nيمكنك إنشاء إيداع جديد من قسم 💰 الإيداع.`
    );
    return 'updated';
  }

  if (status === 'partially_paid') {
    notify?.(deposit.user_id,
      `⚠️ <b>دفعة جزئية</b>\n\nالفاتورة: <code>${deposit.invoice_id}</code>\n` +
      `المدفوع فعلياً: ${payload.actually_paid} ${deposit.pay_currency?.toUpperCase()}\n` +
      `سيُضاف المبلغ المدفوع فقط إلى رصيدك تلقائياً.`
    );
  }

  return 'updated';
}

/** توليد معرّف طلب داخلي فريد */
export function generateOrderId(userId) {
  return `dep_${userId}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
}

export { FINAL_PAYMENT_STATUSES };
