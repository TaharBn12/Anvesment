// ============================================================
//  خدمة الإحالة: رابط خاص بكل مستخدم، ومكافأة تُصرف مرة
//  واحدة فقط لكل مستخدم ينضم عبر الرابط.
//
//  القاعدة: المكافأة تُصرف لصاحب الرابط عند **أول إيداع ناجح**
//  للمستخدم المُحال — مو عند التسجيل. هكا ما يصير نظام
//  قابل للاستغلال بحسابات وهمية.
// ============================================================
import { config } from '../config.js';
import { toMicro } from '../utils/money.js';
import { creditWallet } from './wallet.js';
import logger from '../utils/logger.js';

/**
 * استخراج رمز الإحالة من حُمولة /start.
 * نقبل الأشكال: ref_ABC123 | ref=ABC123 | ABC123
 */
export function parseReferralPayload(payload) {
  if (!payload) return null;
  const raw = String(payload).trim();
  const match = raw.match(/^(?:ref[_=-]?)?([A-Za-z0-9]{4,32})$/);
  return match ? match[1].toUpperCase() : null;
}

/** البحث عن صاحب رمز الإحالة */
export function findUserByReferralCode(db, code) {
  if (!code) return null;
  return db.prepare('SELECT * FROM users WHERE referral_code = ?')
    .get(String(code).toUpperCase());
}

/**
 * ربط مستخدم جديد بمُحيله — يُنفّذ مرة واحدة فقط.
 * يُرفض: الإحالة الذاتية، أو مستخدم مرتبط سابقاً.
 */
export function attachReferrer(db, newUserId, referrerId) {
  if (!referrerId || !newUserId || referrerId === newUserId) return false;
  const row = db.prepare('SELECT referred_by FROM users WHERE id = ?').get(newUserId);
  if (!row || row.referred_by) return false;
  const result = db.prepare(
    'UPDATE users SET referred_by = ? WHERE id = ? AND referred_by IS NULL'
  ).run(referrerId, newUserId);
  if (result.changes > 0) {
    logger.info(`إحالة: المستخدم ${newUserId} انضم عبر رابط ${referrerId}`);
    return true;
  }
  return false;
}

/** بناء رابط الإحالة الكامل للمستخدم */
export function buildReferralLink(db, userId, botUsername) {
  const user = db.prepare('SELECT referral_code FROM users WHERE id = ?').get(userId);
  if (!user?.referral_code || !botUsername) return null;
  return `https://t.me/${botUsername}?start=ref_${user.referral_code}`;
}

/**
 * اسم مستخدم البوت — يلزم لبناء رابط الإحالة.
 * الترتيب: ما عرفناه من تلغرام، ثم BOT_USERNAME من .env، ثم استعلام مباشر.
 */
export async function resolveBotUsername(ctx) {
  if (ctx?.botInfo?.username) return ctx.botInfo.username;
  if (config.referral.botUsername) return config.referral.botUsername;
  try {
    const me = await ctx?.telegram?.getMe?.();
    return me?.username || null;
  } catch (err) {
    logger.warn('تعذّر جلب اسم البوت لبناء رابط الإحالة:', err.message);
    return null;
  }
}

/** إحصائيات الإحالة: عدد المدعوين، المكسب، والبانتظار */
export function referralStats(db, userId) {
  const invited = db.prepare('SELECT COUNT(*) AS n FROM users WHERE referred_by = ?')
    .get(userId).n;
  const paid = db.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS s
     FROM transactions WHERE user_id = ? AND type = 'referral'`
  ).get(userId);
  return {
    invited,
    paidCount: paid.n,
    earnedMicro: paid.s,
    // مدعوّن سجّلوا لكن لم يُودعوا بعد — مكافآتهم لم تُصرف
    pending: Math.max(0, invited - paid.n),
  };
}

/**
 * صرف مكافأة الإحالة — آمنة ضد التكرار (idempotent).
 * تُستدعى من تدفق الإيداع عند نجاح أول إيداع للمستخدم المُحال.
 * notify: دالة إشعار (userId, text) — اختيارية.
 */
export function payReferralBonus(db, referredUserId, notify = null) {
  const referred = db.prepare('SELECT * FROM users WHERE id = ?').get(referredUserId);
  if (!referred?.referred_by) return { paid: false, reason: 'no_referrer' };

  const referrerId = referred.referred_by;
  // مكافأة واحدة فقط لكل مستخدم مُحال (ref_id = معرّف المُحال)
  const already = db.prepare(
    `SELECT id FROM transactions WHERE user_id = ? AND type = 'referral' AND ref_id = ?`
  ).get(referrerId, String(referredUserId));
  if (already) return { paid: false, reason: 'already_paid' };

  const bonusMicro = toMicro(config.referral.bonusUsd);
  if (bonusMicro <= 0n) return { paid: false, reason: 'bonus_disabled' };

  // لو المكافأة أكبر من رصيد المُحيل ما يمنع الصرف — النظام يديره المشغّل
  creditWallet(db, referrerId, bonusMicro, {
    type: 'referral',
    refType: 'referral',
    refId: String(referredUserId),
    note: `مكافأة إحالة — مستخدم ${referredUserId}`,
  });

  logger.ok(`مكافأة إحالة: ${config.referral.bonusUsd}$ للمستخدم ${referrerId} (من ${referredUserId})`);

  notify?.(referrerId,
    `🎉 <b>مكافأة إحالة جديدة!</b>\n\n` +
    `💰 حصلت على <b>${config.referral.bonusUsd}$</b> لانضمام مستخدم عبر رابطك.\n` +
    `👤 المستخدم: ${referred.first_name || referred.username || referredUserId}\n\n` +
    `شارك رابطك أكثر لتربح أكثر 🔗`
  );

  return { paid: true, referrerId, amountMicro: bonusMicro };
}
