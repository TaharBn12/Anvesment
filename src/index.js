import { config, assertBotConfig } from './config.js';
import { createDatabase } from './db.js';
import { createBot } from './bot/index.js';
import { startWebhookServer } from './api/webhook.js';
import { startProfitJob } from './jobs/profitJob.js';
import { startDepositPollJob } from './jobs/pollDeposits.js';
import { startSelfPingJob } from './jobs/selfPing.js';
import logger from './utils/logger.js';

async function main() {
  // 1) التحقق من الإعدادات
  assertBotConfig();

  // 2) قاعدة البيانات
  const db = createDatabase(config.dbPath);

  // 3) خادم إشعارات الدفع (IPN)
  const server = startWebhookServer(db, (userId, text) =>
    bot.telegram.sendMessage(userId, text, { parse_mode: 'HTML' }).catch((err) =>
      logger.warn(`تعذّر إشعار المستخدم ${userId}:`, err.message)
    )
  );

  // 4) البوت (مع إعادة محاولة تلقائية إذا كانت تلغرام غير متاحة مؤقتاً)
  const bot = createBot(db);
  await launchBotWithRetry(bot);

  // 5) المهام المجدولة
  startProfitJob(db, (userId, text) =>
    bot.telegram.sendMessage(userId, text, { parse_mode: 'HTML' }).catch(() => {})
  );
  startDepositPollJob(db, (userId, text) =>
    bot.telegram.sendMessage(userId, text, { parse_mode: 'HTML' }).catch(() => {})
  );

  // 6) إيقاف نظيف
  const shutdown = async (signal) => {
    logger.info(`إيقاف البوت (${signal})...`);
    bot.stop(signal);
    server.close();
    db.close();
    process.exit(0);
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * تشغيل البوت مع إعادة محاولة تلقائية بفاصل متزايد (حتى 60 ثانية).
 * ملاحظة مهمة: bot.launch() في وضع polling لا تُكمل أبداً (حلقة لا تنتهي)،
 * لذا ننتظر فترة قصيرة فقط للتأكد من بدء الاستقصاء ثم نتابع تشغيل
 * المهام المجدولة — وإذا توقّف البوت لاحقاً نعيد تشغيله تلقائياً.
 */
async function launchBotWithRetry(bot) {
  for (let attempt = 1; ; attempt++) {
    const launchPromise = bot.launch();
    // منع الأخطاء غير المعالجة إذا رفضت launch() لاحقاً (مثل توكن مُبطَل)
    launchPromise.catch((err) => {
      logger.error('توقّف البوت:', err.message);
      setTimeout(() => launchBotWithRetry(bot).catch(() => {}), 5_000);
    });
    try {
      await Promise.race([launchPromise, delay(3_000)]);
      logger.ok('🚀 البوت يعمل (وضع polling)');
      return;
    } catch (err) {
      const waitMs = Math.min(attempt * 10_000, 60_000);
      logger.error(`فشل الاتصال بتلغرام (محاولة ${attempt}): ${err.message}`);
      logger.info(`إعادة المحاولة بعد ${waitMs / 1000} ثانية...`);
      await delay(waitMs);
    }
  }
}

main().catch((err) => {
  logger.error('فشل تشغيل التطبيق:', err);
  process.exit(1);
});
