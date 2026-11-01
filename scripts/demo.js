// ============================================================
//  العرض الحي: يشغّل البوت الحقيقي على هذا السيرفر ضد خوادم
//  محاكاة تلغرام و NOWPayments، ويعرض واجهة محادثة تفاعلية.
//
//  يُستخدم عندما تكون خوادم تلغرام محجوبة (كما في بيئة الوكيل):
//  يمكنك تجربة كل ميزات البوت من المتصفح كما في تلغرام.
//
//  التشغيل: node scripts/demo.js
// ============================================================
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMocks } from './mocks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const WEB_PORT = Number(process.env.DEMO_WEB_PORT || 3000);
const APP_WEBHOOK_PORT = Number(process.env.DEMO_APP_WEBHOOK_PORT || 3001);
const DEMO_USER = Number(process.env.DEMO_USER_ID || 555);
const IPN_SECRET = 'demo_ipn_secret';

async function main() {
  console.log('🎬 تشغيل العرض الحي...\n');

  const mocks = await startMocks({
    telegramPort: WEB_PORT,
    host: '0.0.0.0',
    webUserId: DEMO_USER,
    appWebhookPort: APP_WEBHOOK_PORT,
    appWebhookPath: '/webhooks/nowpayments',
    ipnSecret: IPN_SECRET,
  });

  const child = spawn('node', ['src/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      BOT_TOKEN: 'demo:token',
      TELEGRAM_API_ROOT: `http://127.0.0.1:${mocks.telegramPort}`,
      ADMIN_IDS: String(DEMO_USER),
      NOWPAYMENTS_API_KEY: 'demo_key',
      NOWPAYMENTS_API_URL: `http://127.0.0.1:${mocks.nowpaymentsPort}`,
      NOWPAYMENTS_IPN_SECRET: IPN_SECRET,
      NOWPAYMENTS_PAYOUTS_EMAIL: 'demo@example.com',
      NOWPAYMENTS_PAYOUTS_PASSWORD: 'demo_password',
      WEBHOOK_PORT: String(APP_WEBHOOK_PORT),
      WEBHOOK_PATH: '/webhooks/nowpayments',
      DB_PATH: './data/demo.db',
      CURRENCY: 'usd',
      MIN_DEPOSIT: '10',
      MIN_WITHDRAW: '5',
      PAYOUT_HOUR: '0',
      DEPOSIT_POLL_SECONDS: '999999',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logs = [];
  child.stdout.on('data', (d) => { logs.push(d.toString()); process.stdout.write(`[bot] ${d}`); });
  child.stderr.on('data', (d) => { logs.push(d.toString()); process.stdout.write(`[bot] ${d}`); });

  // انتظار جهوزية البوت
  const t0 = Date.now();
  while (Date.now() - t0 < 30_000) {
    if (logs.some((l) => l.includes('البوت يعمل'))) break;
    await new Promise((r) => setTimeout(r, 300));
  }

  const ready = logs.some((l) => l.includes('البوت يعمل'));
  console.log(`
${'='.repeat(58)}
${ready ? '✅ البوت يعمل على السيرفر (وضع المحاكاة)' : '⚠️  تحقق من سجلات البوت أعلاه'}
${'='.repeat(58)}

🌐 واجهة المحادثة الحية:  http://localhost:${WEB_PORT}
💳 لوحة محاكاة NOWPayments مدمجة في الواجهة

📱 جرّب من الواجهة:
   1. /start          → الترحيب والقائمة
   2. 💰 إيداع        → اختر المبلغ والعملة → يظهر QR
   3. اضغط «💳 محاكاة الدفع» في اللوحة البرتقالية → يُضاف الرصيد
   4. 📈 استثمار      → اختر مستوى → الربح اليومي
   5. 📊 استثماراتي   → صرف الأرباح (من /admin ← تشغيل الصرف)
   6. 💼 محفظتي / 💸 سحب / /backup

👤 أنت تدخل كأدمن (معرّف ${DEMO_USER}) — كل الأوامر متاحة.
${'='.repeat(58)}
`);

  const shutdown = () => {
    child.kill('SIGTERM');
    mocks.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('❌ فشل تشغيل العرض:', err);
  process.exit(1);
});
