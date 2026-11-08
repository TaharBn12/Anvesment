import cron from 'node-cron';
import { config } from '../config.js';
import logger from '../utils/logger.js';

/**
 * مهمة النبض الذاتي: ترسل طلباًperiodicياً إلى رابط الخدمة العام
 * (SELF_PING_URL) لمنع المنصات المجانية (مثل Koyeb) من "إسكان"
 * الخدمة إلى صفر بعد ساعة بلا طلب — بوت تلغرام يستقبل الطلبات
 * outward (polling) فلا يولّد زيارات واردة بنفسه.
 */
export function startSelfPingJob() {
  if (!config.selfPingUrl) {
    logger.info('مهمة النبض الذاتي معطّلة (لم يُضبط SELF_PING_URL)');
    return;
  }

  const ping = async () => {
    try {
      const res = await fetch(config.selfPingUrl, { signal: AbortSignal.timeout(15_000) });
      logger.info(`💓 نبضة ذاتية → ${res.status}`);
    } catch (err) {
      logger.warn('فشلت النبضة الذاتية:', err.message);
    }
  };

  // كل SELF_PING_MINUTES دقيقة (أقل من ساعة حتى لا تنام الخدمة)
  const minutes = Math.max(5, Math.min(55, config.selfPingMinutes));
  cron.schedule(`*/${minutes} * * * *`, ping);
  setTimeout(ping, 30_000); // نبضة أولى بعد 30 ثانية
  logger.ok(`مهمة النبض الذاتي مجدولة: كل ${minutes} دقيقة → ${config.selfPingUrl}`);
}

export default startSelfPingJob;
