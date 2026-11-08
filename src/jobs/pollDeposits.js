import cron from 'node-cron';
import { config } from '../config.js';
import { getPendingDeposits, handlePaymentUpdate, creditDeposit } from '../services/deposits.js';
import { getInvoice } from '../api/nowpayments.js';
import logger from '../utils/logger.js';

/**
 * مهمة احتياطية: تتابع الفواتير المعلّقة مع NOWPayments دورياً
 * حتى لو لم يصل الـ Webhook (مثلاً أثناء التطوير بدون دومين عام).
 */
export function startDepositPollJob(db, notify) {
  const run = async () => {
    let pending;
    try {
      pending = getPendingDeposits(db);
    } catch (err) {
      logger.error('فشل قراءة الإيداعات المعلّقة:', err.message);
      return;
    }
    if (pending.length === 0) return;

    let changed = 0;
    for (const dep of pending) {
      try {
        const invoice = await getInvoice(dep.invoice_id);
        const before = dep.status;
        const result = handlePaymentUpdate(db, invoice, notify);
        if (result !== 'ignored' && invoice.payment_status !== before) changed++;
        if (invoice.payment_status === 'finished' && !dep.credited) {
          const fresh = db.prepare('SELECT * FROM deposits WHERE id = ?').get(dep.id);
          creditDeposit(db, fresh, notify);
          changed++;
        }
      } catch (err) {
        logger.warn(`تعذّر متابعة الفاتورة ${dep.invoice_id}:`, err.message);
      }
    }
    if (changed > 0) logger.info(`المتابعة الدورية: تحديث ${changed} إيداع من ${pending.length}`);
  };

  const every = Math.max(30, config.depositPollSeconds);
  const schedule = `*/${Math.floor(every / 60) || 1} * * * *`;
  cron.schedule(schedule, run);
  // تشغيل فوري عند البدء
  setTimeout(run, 5_000);
  logger.ok(`مهمة متابعة الإيداعات مجدولة: كل ${every} ثانية`);
}

export default startDepositPollJob;
