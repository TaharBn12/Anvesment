// ============================================================
//  خدمة المحفظة: كل تغيير في الرصيد يمرّ من هنا ويُسجّل في
//  جدول المعاملات (ledger) لضمان الدقة وقابلية التدقيق.
// ============================================================

/** إضافة مبلغ لرصيد المستخدم + تسجيل معاملة */
export function creditWallet(db, userId, microAmount, { type, refType = null, refId = null, note = null } = {}) {
  db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(microAmount, userId);
  db.prepare(
    `INSERT INTO transactions (user_id, type, amount, ref_type, ref_id, note)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(userId, type, microAmount, refType, refId, note);
}

/** خصم مبلغ من رصيد المستخدم — يفشل إذا كان الرصيد غير كافٍ */
export function debitWallet(db, userId, microAmount, { type, refType = null, refId = null, note = null } = {}) {
  const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('المستخدم غير موجود');
  if (BigInt(user.balance) < BigInt(microAmount)) {
    throw new Error('رصيد غير كافٍ');
  }
  db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(microAmount, userId);
  db.prepare(
    `INSERT INTO transactions (user_id, type, amount, ref_type, ref_id, note)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(userId, type, -microAmount, refType, refId, note);
}

/** تحديث إجماليات المستخدم (إيداعات/سحوبات/أرباح) */
export function bumpTotals(db, userId, { deposited = 0, withdrawn = 0, profit = 0 } = {}) {
  db.prepare(
    `UPDATE users
     SET total_deposited = total_deposited + ?,
         total_withdrawn = total_withdrawn + ?,
         total_profit    = total_profit + ?
     WHERE id = ?`
  ).run(deposited, withdrawn, profit, userId);
}

/** سجل معاملات المستخدم */
export function getTransactions(db, userId, limit = 20) {
  return db.prepare(
    'SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT ?'
  ).all(userId, limit);
}
