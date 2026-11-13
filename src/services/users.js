import crypto from 'node:crypto';
import logger from '../utils/logger.js';

/** إنشاء مستخدم جديد أو جلب الموجود، وتحديث بياناته */
export function upsertUser(db, tgUser, { isAdmin = false } = {}) {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(tgUser.id);
  if (existing) {
    db.prepare(
      `UPDATE users SET username = ?, first_name = ?, is_admin = MAX(is_admin, ?) WHERE id = ?`
    ).run(tgUser.username || null, tgUser.first_name || null, isAdmin ? 1 : 0, tgUser.id);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(tgUser.id);
  }
  const referralCode = crypto.randomBytes(4).toString('hex').toUpperCase();
  db.prepare(
    `INSERT INTO users (id, username, first_name, referral_code, is_admin)
     VALUES (?, ?, ?, ?, ?)`
  ).run(tgUser.id, tgUser.username || null, tgUser.first_name || null, referralCode, isAdmin ? 1 : 0);
  logger.info(`مستخدم جديد: ${tgUser.id} (@${tgUser.username || '—'}) — لضبطه كأدمن أضف معرّفه إلى ADMIN_IDS`);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(tgUser.id);
}

export function getUser(db, userId) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

export function getAllUsers(db) {
  return db.prepare('SELECT * FROM users ORDER BY created_at ASC').all();
}

export function setState(db, userId, state, stateData = null) {
  db.prepare('UPDATE users SET state = ?, state_data = ? WHERE id = ?')
    .run(state, stateData ? JSON.stringify(stateData) : null, userId);
}

export function clearState(db, userId) {
  setState(db, userId, 'idle', null);
}

export function getState(db, userId) {
  const row = db.prepare('SELECT state, state_data FROM users WHERE id = ?').get(userId);
  if (!row) return { state: 'idle', data: null };
  let data = null;
  if (row.state_data) {
    try { data = JSON.parse(row.state_data); } catch { data = null; }
  }
  return { state: row.state, data };
}

export function countUsers(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

// ============================================================
//  الحظر (Ban) — يُنفّذ من لوحة الأدمن في تلغرام أو من الموقع
// ============================================================

/** حظر مستخدم مع تسجيل السبب */
export function banUser(db, userId, reason = null) {
  db.prepare('UPDATE users SET is_banned = 1, ban_reason = ? WHERE id = ?')
    .run(reason, userId);
  logger.info(`حظر المستخدم ${userId}${reason ? ` — ${reason}` : ''}`);
  return getUser(db, userId);
}

/** رفع الحظر عن مستخدم */
export function unbanUser(db, userId) {
  db.prepare('UPDATE users SET is_banned = 0, ban_reason = NULL WHERE id = ?').run(userId);
  logger.info(`رفع الحظر عن المستخدم ${userId}`);
  return getUser(db, userId);
}

/** هل المستخدم محظور؟ */
export function isBanned(db, userId) {
  const row = db.prepare('SELECT is_banned FROM users WHERE id = ?').get(userId);
  return Boolean(row?.is_banned);
}

/** قائمة المستخدمين مع فلترة (للبحث في لوحة التحكم) */
export function searchUsers(db, { query = '', bannedOnly = false, limit = 50, offset = 0 } = {}) {
  const clauses = [];
  const params = [];
  if (query) {
    const q = `%${String(query).replace(/%/g, '')}%`;
    clauses.push('(CAST(id AS TEXT) LIKE ? OR IFNULL(username,\'\') LIKE ? OR IFNULL(first_name,\'\') LIKE ?)');
    params.push(q, q, q);
  }
  if (bannedOnly) clauses.push('is_banned = 1');
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(
    `SELECT * FROM users ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM users ${where}`).get(...params).n;
  return { rows, total };
}

/** إجماليات للوحة الأدمن */
export function platformStats(db) {
  const users = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const balances = db.prepare('SELECT COALESCE(SUM(balance),0) AS s FROM users').get().s;
  const deposited = db.prepare('SELECT COALESCE(SUM(total_deposited),0) AS s FROM users').get().s;
  const withdrawn = db.prepare('SELECT COALESCE(SUM(total_withdrawn),0) AS s FROM users').get().s;
  const profit = db.prepare('SELECT COALESCE(SUM(total_profit),0) AS s FROM users').get().s;
  const activeInvestments = db.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS s FROM investments WHERE status = 'active'`
  ).get();
  const pendingWithdrawals = db.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS s FROM withdrawals WHERE status = 'pending'`
  ).get();
  const depositsFinished = db.prepare(
    `SELECT COUNT(*) AS n FROM deposits WHERE status = 'finished'`
  ).get().n;
  return { users, balances, deposited, withdrawn, profit, activeInvestments, pendingWithdrawals, depositsFinished };
}
