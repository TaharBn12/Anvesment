import { getLevel, INVESTMENT_LEVELS } from '../constants.js';
import { toMicro, applyRate, rateToMicro, toBig, fromMicro } from '../utils/money.js';
import { addDays, todayStr, daysBetween } from '../utils/format.js';
import { debitWallet, creditWallet, bumpTotals } from './wallet.js';
import logger from '../utils/logger.js';

/** إنشاء استثمار جديد من رصيد المحفظة */
export function createInvestment(db, userId, levelNumber, amountMicro) {
  const level = getLevel(levelNumber);
  if (!level) throw new Error('مستوى استثماري غير صالح');
  const amount = fromMicroSafe(amountMicro);
  if (amount < level.min || amount > level.max) {
    throw new Error(`المبلغ يجب أن يكون بين ${level.min}$ و ${level.max === Infinity ? '∞' : level.max + '$'}`);
  }

  const start = todayStr();
  const end = addDays(start, level.durationDays);
  const dailyRateMicro = rateToMicro(level.dailyRate);

  db.exec('BEGIN');
  try {
    debitWallet(db, userId, amountMicro, {
      type: 'invest',
      note: `استثمار مستوى ${level.level} — ${level.name}`,
    });
    const info = db.prepare(
      `INSERT INTO investments
        (user_id, level, amount, daily_rate, duration_days, start_date, end_date, next_payout)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(userId, level.level, amountMicro, dailyRateMicro, level.durationDays, start, end, addDays(start, 1));
    db.exec('COMMIT');
    logger.ok(`استثمار جديد: مستخدم ${userId} مستوى ${level.level} بمبلغ ${amount}$`);
    return db.prepare('SELECT * FROM investments WHERE id = ?').get(info.lastInsertRowid);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** استثمارات المستخدم */
export function getUserInvestments(db, userId, { onlyActive = false } = {}) {
  const sql = onlyActive
    ? 'SELECT * FROM investments WHERE user_id = ? AND status = ? ORDER BY id DESC'
    : 'SELECT * FROM investments WHERE user_id = ? ORDER BY id DESC';
  return onlyActive
    ? db.prepare(sql).all(userId, 'active')
    : db.prepare(sql).all(userId);
}

export function getInvestment(db, id) {
  return db.prepare('SELECT * FROM investments WHERE id = ?').get(id);
}

/** الاستثمارات النشطة المستحقة لصرف ربحها اليوم */
export function getDueInvestments(db, date = todayStr()) {
  return db.prepare(
    `SELECT * FROM investments WHERE status = 'active' AND next_payout <= ?`
  ).all(date);
}

/**
 * صرف الربح اليومي لاستثمار واحد.
 * - يُضاف الربح اليومي للمحفظة
 * - عند اكتمال المدة: يُعاد رأس المال ويُغلق العقد
 */
export function processInvestmentPayout(db, investment, { date = todayStr(), notify = null } = {}) {
  const dailyProfit = applyRate(investment.amount, investment.daily_rate);
  const isLastDay = investment.paid_days + 1 >= investment.duration_days;
  const capital = isLastDay ? toBig(investment.amount) : 0n;
  const newPaid = investment.paid_days + 1;

  db.exec('BEGIN');
  try {
    creditWallet(db, investment.user_id, dailyProfit, {
      type: 'profit',
      refType: 'investment',
      refId: String(investment.id),
      note: `ربح يومي — استثمار #${investment.id} (مستوى ${investment.level})`,
    });
    if (capital > 0n) {
      creditWallet(db, investment.user_id, capital, {
        type: 'capital',
        refType: 'investment',
        refId: String(investment.id),
        note: `إعادة رأس المال — استثمار #${investment.id}`,
      });
    }
    db.prepare(
      `INSERT INTO payouts (investment_id, user_id, amount, payout_date, type)
       VALUES (?, ?, ?, ?, 'profit')`
    ).run(investment.id, investment.user_id, dailyProfit, date);
    if (capital > 0n) {
      db.prepare(
        `INSERT INTO payouts (investment_id, user_id, amount, payout_date, type)
         VALUES (?, ?, ?, ?, 'capital')`
      ).run(investment.id, investment.user_id, capital, date);
    }
    const newStatus = isLastDay ? 'completed' : 'active';
    const nextPayout = isLastDay ? investment.end_date : addDays(date, 1);
    db.prepare(
      `UPDATE investments
       SET paid_days = ?, earned = earned + ?, status = ?, next_payout = ?
       WHERE id = ?`
    ).run(newPaid, dailyProfit, newStatus, nextPayout, investment.id);
    bumpTotals(db, investment.user_id, { profit: dailyProfit });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    logger.error(`فشل صرف ربح الاستثمار #${investment.id}:`, err.message);
    throw err;
  }

  const remaining = investment.duration_days - newPaid;
  notify?.(investment.user_id,
    isLastDay
      ? `🏆 <b>اكتمل استثمارك!</b>\n\n` +
        `🧾 العقد: #${investment.id} (مستوى ${investment.level})\n` +
        `💵 الربح الأخير: ${fromMicro(dailyProfit).toFixed(2)}$\n` +
        `🔄 تم إعادة رأس المال: ${fromMicro(capital).toFixed(2)}$ إلى محفظتك\n` +
        `إجمالي أرباحك من هذا العقد: ${fromMicro(toBig(investment.earned) + dailyProfit).toFixed(2)}$`
      : `💸 <b>ربحك اليومي وصل!</b>\n\n` +
        `🧾 العقد: #${investment.id} (مستوى ${investment.level})\n` +
        `💵 الربح: ${fromMicro(dailyProfit).toFixed(2)}$\n` +
        `📅 الأيام المتبقية: ${remaining}\n` +
        `💰 رصيدك الحالي متاح في قسم 💼 محفظتي.`
  );
  return { dailyProfit, isLastDay };
}

/** صرف كل الأرباح المستحقة حتى تاريخ معين (افتراضياً اليوم) */
export function runDailyPayouts(db, { notify = null, date = todayStr() } = {}) {
  const due = getDueInvestments(db, date);
  let paid = 0;
  for (const inv of due) {
    try {
      processInvestmentPayout(db, inv, { date, notify });
      paid++;
    } catch (err) {
      logger.error('تخطّي استثمار بسبب خطأ:', inv.id, err.message);
    }
  }
  logger.info(`صرف الأرباح (${date}): تمت معالجة ${paid} من ${due.length} استثمار مستحق`);
  return { processed: paid, total: due.length };
}

/** ملخص الاستثمار للعرض */
export function investmentSummary(inv) {
  const totalProfit = applyRate(inv.amount, inv.daily_rate) * BigInt(inv.duration_days);
  return {
    id: inv.id,
    level: inv.level,
    amount: inv.amount,
    dailyProfit: applyRate(inv.amount, inv.daily_rate),
    totalProfit,
    paidDays: inv.paid_days,
    durationDays: inv.duration_days,
    progressPct: Math.round((inv.paid_days / inv.duration_days) * 100),
    daysLeft: Math.max(0, daysBetween(todayStr(), inv.end_date)),
    status: inv.status,
    nextPayout: inv.next_payout,
    endDate: inv.end_date,
  };
}

function fromMicroSafe(micro) {
  return Number(micro) / 1_000_000;
}

export { INVESTMENT_LEVELS, toMicro };
