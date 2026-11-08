import cron from 'node-cron';
import { config } from '../config.js';
import { runDailyPayouts } from '../services/investments.js';
import logger from '../utils/logger.js';

/**
 * مهمة يومية لصرف أرباح الاستثمارات النشطة.
 * تعمل كل يوم في الساعة المحددة (PAYOUT_HOUR) بتوقيت السيرفر.
 */
export function startProfitJob(db, notify) {
  // كل يوم في الدقيقة 5 من الساعة المحددة
  const schedule = `5 ${config.payoutHour} * * *`;
  cron.schedule(schedule, () => {
    logger.info('⏰ تشغيل مهمة صرف الأرباح اليومية...');
    try {
      const result = runDailyPayouts(db, { notify });
      logger.info(`انتهت المهمة: ${result.processed}/${result.total}`);
    } catch (err) {
      logger.error('فشلت مهمة صرف الأرباح:', err.message);
    }
  });
  logger.ok(`مهمة الأرباح اليومية مجدولة: ${schedule} (توقيت السيرفر)`);
}

export default startProfitJob;
