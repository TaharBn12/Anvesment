import { debitWallet, creditWallet, bumpTotals } from './wallet.js';
import { fromMicro } from '../utils/money.js';
import { logToChannel, formatWithdrawalLog } from './channelLog.js';
import { getUser } from './users.js';
import logger from '../utils/logger.js';

/** تسجيل عملية سحب في القناة — آمن ضد الأخطاء */
function logWithdrawal(db, withdrawal, event) {
  try {
    logToChannel('withdrawal', formatWithdrawalLog(withdrawal, {
      user: getUser(db, withdrawal.user_id),
      event,
    }));
  } catch (err) {
    logger.warn('فشل تسجيل السحب في القناة:', err.message);
  }
}

/** إنشاء طلب سحب (يخصم المبلغ فوراً ويثبّته في الطلب) */
export function createWithdrawal(db, userId, amountMicro, currency, address) {
  db.exec('BEGIN');
  try {
    debitWallet(db, userId, amountMicro, {
      type: 'withdraw',
      note: `طلب سحب إلى ${address}`,
    });
    const info = db.prepare(
      `INSERT INTO withdrawals (user_id, amount, currency, address, status)
       VALUES (?, ?, ?, ?, 'pending')`
    ).run(userId, amountMicro, currency, address);
    db.exec('COMMIT');
    logger.info(`طلب سحب جديد #${info.lastInsertRowid}: مستخدم ${userId} بمبلغ ${fromMicro(amountMicro)}$`);
    const w = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(info.lastInsertRowid);
    logWithdrawal(db, w, 'طلب');
    return w;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getWithdrawal(db, id) {
  return db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(id);
}

export function getPendingWithdrawals(db) {
  return db.prepare(
    `SELECT w.*, u.username FROM withdrawals w
     JOIN users u ON u.id = w.user_id
     WHERE w.status = 'pending' ORDER BY w.id ASC`
  ).all();
}

export function getUserWithdrawals(db, userId, limit = 10) {
  return db.prepare(
    'SELECT * FROM withdrawals WHERE user_id = ? ORDER BY id DESC LIMIT ?'
  ).all(userId, limit);
}

/** رفض طلب سحب وإرجاع المبلغ للمحفظة */
export function rejectWithdrawal(db, id, note = null) {
  const w = getWithdrawal(db, id);
  if (!w || w.status !== 'pending') throw new Error('الطلب غير موجود أو تمت معالجته');
  db.exec('BEGIN');
  try {
    creditWallet(db, w.user_id, w.amount, {
      type: 'refund',
      refType: 'withdrawal',
      refId: String(w.id),
      note: `إرجاع مبلغ سحب مرفوض #${w.id}`,
    });
    db.prepare(
      `UPDATE withdrawals SET status = 'rejected', admin_note = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(note, id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  logWithdrawal(db, getWithdrawal(db, id), 'رفض');
  return w;
}

/** تعليم الطلب كمدفوع (بعد تنفيذ التحويل فعلياً عبر NOWPayments أو يدوياً) */
export function markWithdrawalPaid(db, id, payoutId = null) {
  db.prepare(
    `UPDATE withdrawals SET status = 'paid', payout_id = COALESCE(?, payout_id), updated_at = datetime('now') WHERE id = ?`
  ).run(payoutId, id);
  const w = getWithdrawal(db, id);
  bumpTotals(db, w.user_id, { withdrawn: w.amount });
  logWithdrawal(db, w, 'تنفيذ');
  return w;
}

/** تعليم الطلب كموافق عليه ومنتظر الدفع اليدوي */
export function markWithdrawalApproved(db, id) {
  db.prepare(
    `UPDATE withdrawals SET status = 'approved', updated_at = datetime('now') WHERE id = ?`
  ).run(id);
  const w = getWithdrawal(db, id);
  logWithdrawal(db, w, 'موافقة على');
  return w;
}
