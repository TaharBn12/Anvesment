import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`المتغير البيئي مطلوب: ${name} — انسخ .env.example إلى .env واملأ القيم`);
  }
  return value;
}

function num(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  // تلغرام
  botToken: process.env.BOT_TOKEN || '',
  adminIds: (process.env.ADMIN_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n)),

  // NOWPayments
  nowpayments: {
    apiKey: process.env.NOWPAYMENTS_API_KEY || '',
    ipnSecret: process.env.NOWPAYMENTS_IPN_SECRET || '',
    apiUrl: process.env.NOWPAYMENTS_API_URL || 'https://api.nowpayments.io',
    // بيانات واجهة السحب (اختيارية) — تُستخدم لدفع الأرباح تلقائياً
    payoutsEmail: process.env.NOWPAYMENTS_PAYOUTS_EMAIL || '',
    payoutsPassword: process.env.NOWPAYMENTS_PAYOUTS_PASSWORD || '',
  },

  // خادم الـ Webhook الخاص باستقبال إشعارات الدفع
  webhook: {
    port: num('WEBHOOK_PORT', 3000),
    path: process.env.WEBHOOK_PATH || '/webhooks/nowpayments',
    publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
  },

  // العملة الأساسية للأرصدة (NOWPayments يقبل 'usd' كعملة تسعير)
  currency: (process.env.CURRENCY || 'usd').toLowerCase(),

  // حدود الإيداع والسحب بالدولار
  minDeposit: num('MIN_DEPOSIT', 10),
  minWithdraw: num('MIN_WITHDRAW', 5),

  // المهام المجدولة
  depositPollSeconds: num('DEPOSIT_POLL_SECONDS', 60),
  payoutHour: num('PAYOUT_HOUR', 0), // ساعة صرف الأرباح اليومية (0-23 بتوقيت السيرفر)

  // قاعدة البيانات
  dbPath: process.env.DB_PATH || './data/bot.db',

  // (اختياري) عنوان API تلغرام مخصص — يُستخدم للاختبارات أو
  // لتشغيل Bot API Server محلي. فارغ = api.telegram.org الرسمي
  telegramApiRoot: process.env.TELEGRAM_API_ROOT || '',

  // (اختياري) رابط الخدمة العام — تستخدمه مهمة النبض الذاتي لمنع
  // المنصات المجانية (Koyeb) من إسكان الخدمة إلى صفر عند الخمول
  selfPingUrl: process.env.SELF_PING_URL || '',
  selfPingMinutes: num('SELF_PING_MINUTES', 10),
};

export function isAdmin(userId) {
  return config.adminIds.includes(userId);
}

export function assertBotConfig() {
  required('BOT_TOKEN');
  if (!config.nowpayments.apiKey) required('NOWPAYMENTS_API_KEY');
  if (config.adminIds.length === 0) {
    console.warn('⚠️  لم تحدد ADMIN_IDS — لوحة الأدمن غير متاحة لأي مستخدم');
  }
}
