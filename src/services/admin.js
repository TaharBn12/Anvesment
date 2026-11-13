// ============================================================
//  خدمة الإدارة: عمليات لوحة التحكم (إضافة/خصم رصيد، حظر،
//  معالجة السحوبات). مشتركة بين لوحة تلغرام والموقع.
//
//  كل عملية رصيد تمرّ من هنا وتُسجّل في الـ ledger بنوعها
//  عشان تبقى قابلة للتدقيق.
// ============================================================
import { creditWallet, debitWallet } from './wallet.js';
import { toMicro, fromMicro, toBig } from '../utils/money.js';
import { banUser, unbanUser, getUser } from './users.js';
import { getWithdrawal, markWithdrawalPaid, markWithdrawalApproved, rejectWithdrawal } from './withdrawals.js';
import { createPayout, payoutsConfigured } from '../api/nowpayments.js';
import logger from '../utils/logger.js';

/**
 * إضافة رصيد لمستخدم من الإدارة (مبلغ موجب = إضافة، سالب = خصم).
 * يعيد المبلغ المُطبّق فعلاً بالوحدات الصغيرة.
 */
export function adminAdjustBalance(db, userId, amountUsd, { note = null, actor = 'admin' } = {}) {
  const value = Number(amountUsd);
  if (!Number.isFinite(value) || value === 0) throw new Error('مبلغ غير صالح');
  const user = getUser(db, userId);
  if (!user) throw new Error('المستخدم غير موجود');

  const micro = toMicro(Math.abs(value).toFixed(6));
  if (value > 0) {
    creditWallet(db, userId, micro, {
      type: 'admin_credit',
      refType: 'admin',
      refId: String(userId),
      note: note || `إضافة رصيد من الإدارة (${actor})`,
    });
  } else {
    // debitWallet يرمي «رصيد غير كافٍ» لو حاولنا نخصم أكثر من الموجود
    debitWallet(db, userId, micro, {
      type: 'admin_debit',
      refType: 'admin',
      refId: String(userId),
      note: note || `خصم رصيد من الإدارة (${actor})`,
    });
  }
  logger.info(`تعديل رصيد: المستخدم ${userId} ${value > 0 ? '+' : ''}${value}$ (${actor})`);
  return micro;
}

/** حظر/رفع حظر مع التحقق من وجود المستخدم */
export function adminSetBan(db, userId, banned, reason = null) {
  const user = getUser(db, userId);
  if (!user) throw new Error('المستخدم غير موجود');
  return banned ? banUser(db, userId, reason) : unbanUser(db, userId);
}

/** تفاصيل مستخدم كاملة للوحة التحكم */
export function adminUserDetail(db, userId) {
  const user = getUser(db, userId);
  if (!user) return null;
  const active = db.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS s FROM investments WHERE user_id = ? AND status = 'active'`
  ).get(userId);
  const deposits = db.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(price_amount),0) AS s FROM deposits WHERE user_id = ? AND credited = 1`
  ).get(userId);
  const referrals = db.prepare('SELECT COUNT(*) AS n FROM users WHERE referred_by = ?').get(userId).n;
  const pendingWd = db.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS s FROM withdrawals WHERE user_id = ? AND status = 'pending'`
  ).get(userId);
  return {
    ...user,
    activeInvestments: active,
    creditedDeposits: deposits,
    referralCount: referrals,
    pendingWithdrawals: pendingWd,
  };
}

/** كل السحوبات مع فلترة الحالة (للوحة التحكم) */
export function adminListWithdrawals(db, { status = '', limit = 100, offset = 0 } = {}) {
  const where = status ? 'WHERE w.status = ?' : '';
  const params = status ? [status] : [];
  const rows = db.prepare(
    `SELECT w.*, u.username, u.first_name FROM withdrawals w
     LEFT JOIN users u ON u.id = w.user_id
     ${where} ORDER BY w.id DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM withdrawals w ${where}`).get(...params).n;
  return { rows, total };
}

/**
 * موافقة على سحب — نفس منطق لوحة تلغرام: دفع تلقائي عبر NOWPayments
 * إن كان مهيّأً، وإلا تعليمه كموافق عليه للتنفيذ اليدوي.
 */
export async function adminApproveWithdrawal(db, id, notify = null) {
  const w = getWithdrawal(db, id);
  if (!w) throw new Error('الطلب غير موجود');
  if (w.status !== 'pending') throw new Error('الطلب تمت معالجته مسبقاً');

  if (payoutsConfigured()) {
    try {
      const payout = await createPayout({
        address: w.address,
        currency: w.currency,
        amount: fromMicro(w.amount),
      });
      markWithdrawalPaid(db, w.id, payout.id);
      notify?.(w.user_id,
        `✅ <b>تم تنفيذ سحبك #${w.id}</b>\n` +
        `💵 المبلغ: ${fromMicro(w.amount).toFixed(2)}$\n` +
        `🏦 إلى: <code>${w.address}</code>`
      );
      return { status: 'paid', payoutId: payout.id };
    } catch (err) {
      logger.error('فشل الدفع التلقائي:', err.message);
      markWithdrawalApproved(db, w.id);
      notify?.(w.user_id, `✅ <b>تمت الموافقة على سحبك #${w.id}</b> وجارٍ تنفيذه.`);
      return { status: 'approved', error: err.message };
    }
  }
  markWithdrawalApproved(db, w.id);
  notify?.(w.user_id, `✅ <b>تمت الموافقة على سحبك #${w.id}</b> وجارٍ تنفيذه.`);
  return { status: 'approved' };
}

/** رفض سحب (يُرجاع المبلغ للمحفظة) */
export function adminRejectWithdrawal(db, id, note = null, notify = null) {
  const w = getWithdrawal(db, id);
  if (!w) throw new Error('الطلب غير موجود');
  if (w.status !== 'pending') throw new Error('الطلب تمت معالجته مسبقاً');
  rejectWithdrawal(db, id, note || 'رفض من الإدارة');
  notify?.(w.user_id, `❌ <b>تم رفض طلب السحب #${w.id}</b> وأُعيد المبلغ إلى محفظتك.`);
  return w;
}

/** تعليم سحب كمدفوع يدوياً */
export function adminMarkWithdrawalPaid(db, id, notify = null) {
  const w = getWithdrawal(db, id);
  if (!w) throw new Error('الطلب غير موجود');
  markWithdrawalPaid(db, w.id);
  notify?.(w.user_id, `✅ <b>تم تنفيذ سحبك #${w.id}</b>\n💵 المبلغ: ${fromMicro(w.amount).toFixed(2)}$`);
  return w;
}

/** إجماليات لوحة التحكم (نفس أرقام لوحة تلغرام + تفاصيل أكثر) */
export function adminDashboardStats(db) {
  const users = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const banned = db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_banned = 1').get().n;
  const balances = db.prepare('SELECT COALESCE(SUM(balance),0) AS s FROM users').get().s;
  const deposited = db.prepare('SELECT COALESCE(SUM(total_deposited),0) AS s FROM users').get().s;
  const withdrawn = db.prepare('SELECT COALESCE(SUM(total_withdrawn),0) AS s FROM users').get().s;
  const profit = db.prepare('SELECT COALESCE(SUM(total_profit),0) AS s FROM users').get().s;
  const active = db.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS s FROM investments WHERE status = 'active'`
  ).get();
  const pendingWd = db.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS s FROM withdrawals WHERE status = 'pending'`
  ).get();
  const referrals = db.prepare('SELECT COUNT(*) AS n FROM users WHERE referred_by IS NOT NULL').get().n;
  return {
    users, banned, balances, deposited, withdrawn, profit,
    activeInvestments: active, pendingWithdrawals: pendingWd, referrals,
  };
}
