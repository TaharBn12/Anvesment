// ============================================================
//  واجهة API للوحة التحكم على الموقع (GitHub Pages).
//
//  الموقع ثابت (static) على github.io، فما يقدر يقرأ قاعدة بيانات
//  السيرفر مباشرة — لهذا يتكلم مع هاذي النقاط عبر HTTPS.
//
//  ⚠️ مهم: المنصات المجانية (Render/Koyeb) تفتح منفذاً واحداً فقط،
//  فالنقاط مُركّبة على نفس خادم الـ Webhook تحت المسار /admin/api.
//  (لو حاب منفذاً منفصلاً في التطوير، استخدم startAdminApiServer.)
//
//  الأمان:
//   - كل النقاط تحتاج ترويسة x-admin-token تطابق ADMIN_API_TOKEN
//   - لو ADMIN_API_TOKEN فاضي → الـ API مُعطّل بالكامل (آمن افتراضياً)
// ============================================================
import express from 'express';
import { config } from '../config.js';
import { adminDashboardStats, adminUserDetail, adminListWithdrawals, adminApproveWithdrawal, adminRejectWithdrawal, adminMarkWithdrawalPaid, adminAdjustBalance, adminSetBan } from '../services/admin.js';
import { searchUsers } from '../services/users.js';
import { getTransactions } from '../services/wallet.js';
import { getUserDeposits } from '../services/deposits.js';
import { getUserInvestments } from '../services/investments.js';
import { fromMicro } from '../utils/money.js';
import logger from '../utils/logger.js';

const BASE = '/admin/api';

/** ترويسات CORS — نكتبها يدوياً (بدون حزمة إضافية) */
function applyCors(req, res, next) {
  const allowed = (config.adminApi.corsOrigins || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const origin = req.get('origin');
  if (allowed.length === 0 || allowed.includes('*') || (origin && allowed.includes(origin))) {
    res.set('Access-Control-Allow-Origin', origin || '*');
  }
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type,x-admin-token');
  res.set('Access-Control-Max-Age', '86400');
  next(); // ضروري — بدونه يعلّق الطلب إلى الأبد
}

/** بوابة المصادقة — تُطبّق على كل نقاط الإدارة */
function authGate(req, res, next) {
  if (!config.adminApi.token) {
    return res.status(503).json({
      error: 'واجهة الإدارة معطّلة — اضبط ADMIN_API_TOKEN في متغيّرات البيئة',
    });
  }
  const token = req.get('x-admin-token');
  if (token !== config.adminApi.token) {
    logger.warn(`محاولة وصول غير مصرّح للوحة الإدارة من ${req.ip}`);
    return res.status(401).json({ error: 'رمز الدخول غير صحيح' });
  }
  next();
}

/**
 * تركيب نقاط الإدارة على خادم Express قائم (نفس منفذ الـ Webhook).
 * db: قاعدة البيانات، notify: دالة إشعار تلغرام (userId, text).
 */
export function mountAdminApi(app, db, notify) {
  app.use(BASE, applyCors, (req, res, next) => {
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // فحص صحة بدون مصادقة (يستعمله الموقع للتأكد أن الرابط صحيح)
  app.get(`${BASE}/ping`, (req, res) => {
    res.json({
      ok: true,
      service: 'admin-api',
      needsToken: Boolean(config.adminApi.token),
      time: new Date().toISOString(),
    });
  });

  app.use(BASE, authGate);

  // ============================================================
  //  الإحصائيات
  // ============================================================
  app.get(`${BASE}/stats`, (req, res) => {
    const s = adminDashboardStats(db);
    res.json({
      users: s.users,
      banned: s.banned,
      balances: fromMicro(s.balances),
      deposited: fromMicro(s.deposited),
      withdrawn: fromMicro(s.withdrawn),
      profit: fromMicro(s.profit),
      referrals: s.referrals,
      activeInvestments: { count: s.activeInvestments.n, total: fromMicro(s.activeInvestments.s) },
      pendingWithdrawals: { count: s.pendingWithdrawals.n, total: fromMicro(s.pendingWithdrawals.s) },
      referralBonus: config.referral.bonusUsd,
      minDeposit: config.minDeposit,
      serverTime: new Date().toISOString(),
    });
  });

  // ============================================================
  //  المستخدمون
  // ============================================================
  app.get(`${BASE}/users`, (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(5, Number(req.query.limit) || 25));
    const { rows, total } = searchUsers(db, {
      query: String(req.query.q || ''),
      bannedOnly: req.query.banned === '1',
      limit,
      offset: (page - 1) * limit,
    });
    res.json({
      page, limit, total,
      pages: Math.max(1, Math.ceil(total / limit)),
      users: rows.map((u) => ({
        id: u.id,
        username: u.username,
        firstName: u.first_name,
        balance: fromMicro(u.balance),
        totalDeposited: fromMicro(u.total_deposited),
        totalWithdrawn: fromMicro(u.total_withdrawn),
        totalProfit: fromMicro(u.total_profit),
        banned: Boolean(u.is_banned),
        banReason: u.ban_reason,
        referralCode: u.referral_code,
        referredBy: u.referred_by,
        isAdmin: Boolean(u.is_admin),
        createdAt: u.created_at,
      })),
    });
  });

  app.get(`${BASE}/users/:id`, (req, res) => {
    const u = adminUserDetail(db, Number(req.params.id));
    if (!u) return res.status(404).json({ error: 'المستخدم غير موجود' });
    res.json({
      user: {
        id: u.id, username: u.username, firstName: u.first_name,
        balance: fromMicro(u.balance),
        totalDeposited: fromMicro(u.total_deposited),
        totalWithdrawn: fromMicro(u.total_withdrawn),
        totalProfit: fromMicro(u.total_profit),
        banned: Boolean(u.is_banned), banReason: u.ban_reason,
        referralCode: u.referral_code, referredBy: u.referred_by,
        referralCount: u.referral_count,
        isAdmin: Boolean(u.is_admin), createdAt: u.created_at,
        activeInvestments: { count: u.activeInvestments.n, total: fromMicro(u.activeInvestments.s) },
        creditedDeposits: { count: u.creditedDeposits.n, total: fromMicro(u.creditedDeposits.s) },
      },
      transactions: getTransactions(db, u.id, 20).map((t) => ({
        id: t.id, type: t.type, amount: fromMicro(t.amount), note: t.note, date: t.created_at,
      })),
      deposits: getUserDeposits(db, u.id, 20).map((d) => ({
        id: d.id, invoiceId: d.invoice_id, amount: fromMicro(d.price_amount),
        currency: d.pay_currency, status: d.status, credited: Boolean(d.credited), date: d.created_at,
      })),
      investments: getUserInvestments(db, u.id, 20).map((i) => ({
        id: i.id, level: i.level, amount: fromMicro(i.amount),
        dailyRate: i.daily_rate / 1_000_000 * 100, status: i.status,
        earned: fromMicro(i.earned), paidDays: i.paid_days, durationDays: i.duration_days,
        endDate: i.end_date,
      })),
    });
  });

  // ---- حظر / رفع الحظر ----
  app.post(`${BASE}/users/:id/ban`, (req, res) => {
    const id = Number(req.params.id);
    const banned = req.body?.banned !== false; // الافتراضي: حظر
    const reason = req.body?.reason ? String(req.body.reason).slice(0, 300) : null;
    const user = adminSetBan(db, id, banned, reason);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    notify?.(id, banned
      ? `⛔ <b>تم حظرك من هذا البوت.</b>${reason ? `\nالسبب: ${reason}` : ''}`
      : '🎉 <b>تم رفع الحظر عن حسابك.</b>\nتقدر تستخدم البوت بشكل طبيعي الآن.');
    res.json({ ok: true, banned, id, reason });
  });

  // ---- إضافة / خصم رصيد ----
  app.post(`${BASE}/users/:id/balance`, (req, res) => {
    const id = Number(req.params.id);
    const amount = Number(req.body?.amount);
    const note = req.body?.note ? String(req.body.note).slice(0, 300) : null;
    if (!Number.isFinite(amount) || amount === 0) {
      return res.status(400).json({ error: 'مبلغ غير صالح' });
    }
    try {
      adminAdjustBalance(db, id, amount, { note, actor: 'لوحة الإدارة' });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const after = db.prepare('SELECT balance FROM users WHERE id = ?').get(id);
    notify?.(id,
      `💳 <b>تعديل في رصيدك</b>\n\n` +
      `${amount > 0 ? '➕ أُضيف' : '➖ خُصم'} <b>${Math.abs(amount).toFixed(2)}$</b>` +
      `${note ? `\n📝 ${note}` : ''}\n` +
      `💰 الرصيد الحالي: <b>${fromMicro(after.balance).toFixed(2)}$</b>`);
    res.json({ ok: true, id, amount, newBalance: fromMicro(after.balance) });
  });

  // ============================================================
  //  السحوبات
  // ============================================================
  app.get(`${BASE}/withdrawals`, (req, res) => {
    const status = String(req.query.status || '');
    const { rows, total } = adminListWithdrawals(db, { status, limit: 200 });
    res.json({
      total,
      withdrawals: rows.map((w) => ({
        id: w.id,
        userId: w.user_id,
        username: w.username,
        firstName: w.first_name,
        amount: fromMicro(w.amount),
        currency: w.currency,
        address: w.address,
        status: w.status,
        payoutId: w.payout_id,
        adminNote: w.admin_note,
        createdAt: w.created_at,
        updatedAt: w.updated_at,
      })),
    });
  });

  app.post(`${BASE}/withdrawals/:id/approve`, async (req, res) => {
    try {
      const result = await adminApproveWithdrawal(db, Number(req.params.id), notify);
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post(`${BASE}/withdrawals/:id/reject`, (req, res) => {
    try {
      const note = req.body?.note ? String(req.body.note).slice(0, 300) : null;
      const w = adminRejectWithdrawal(db, Number(req.params.id), note, notify);
      res.json({ ok: true, id: w.id, status: 'rejected' });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post(`${BASE}/withdrawals/:id/mark-paid`, (req, res) => {
    try {
      const w = adminMarkWithdrawalPaid(db, Number(req.params.id), notify);
      res.json({ ok: true, id: w.id, status: 'paid' });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ============================================================
  //  الإيداعات (للمراجعة)
  // ============================================================
  app.get(`${BASE}/deposits`, (req, res) => {
    const status = String(req.query.status || '');
    const rows = db.prepare(
      `SELECT d.*, u.username FROM deposits d LEFT JOIN users u ON u.id = d.user_id
       ${status ? 'WHERE d.status = ?' : ''} ORDER BY d.id DESC LIMIT 200`
    ).all(...(status ? [status] : []));
    res.json({
      deposits: rows.map((d) => ({
        id: d.id, userId: d.user_id, username: d.username,
        invoiceId: d.invoice_id, amount: fromMicro(d.price_amount),
        currency: d.pay_currency, status: d.status,
        credited: Boolean(d.credited), createdAt: d.created_at,
      })),
    });
  });

  logger.ok(`نقاط إدارة الموقع مُركّبة على المسار ${BASE}`);
}

/**
 * خادم مستقل لنقاط الإدارة — للتطوير المحلي فقط.
 * في الإنتاج استخدم mountAdminApi على نفس منفذ الـ Webhook
 * (المنصات المجانية تفتح منفذاً واحداً).
 */
export function startAdminApiServer(db, notify) {
  const app = express();
  mountAdminApi(app, db, notify);
  const port = config.adminApi.port;
  return app.listen(port, '0.0.0.0', () => {
    logger.ok(`واجهة إدارة الموقع تعمل على المنفذ ${port}`);
  });
}

export default mountAdminApi;
