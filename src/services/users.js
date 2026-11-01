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
