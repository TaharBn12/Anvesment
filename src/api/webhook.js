import express from 'express';
import { config } from '../config.js';
import { verifyIpnSignature } from './nowpayments.js';
import { handlePaymentUpdate } from '../services/deposits.js';
import logger from '../utils/logger.js';

/**
 * خادم Express لاستقبال إشعارات الدفع الفورية (IPN) من NOWPayments.
 * يجب أن يكون متاحاً عبر رابط عام (HTTPS) — انشر السيرفر على دومين
 * واضبط PUBLIC_URL، أو استخدم ngrok أثناء التطوير.
 */
export function startWebhookServer(db, notify) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // فحص صحة
  app.get('/health', (req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  // استقبال إشعارات NOWPayments
  app.post(config.webhook.path, (req, res) => {
    const signature = req.get('x-nowpayments-sig');

    // التحقق من التوقيع لحماية الخادم من الطلبات المزيّفة
    if (config.nowpayments.ipnSecret) {
      if (!verifyIpnSignature(req.body, signature)) {
        logger.warn('إشعار وصول بتوقيع غير صالح من', req.ip);
        return res.status(401).json({ error: 'invalid signature' });
      }
    } else {
      logger.warn('NOWPAYMENTS_IPN_SECRET غير مضبوط — يتم قبول الإشعارات بدون تحقق (غير آمن!)');
    }

    const payload = req.body;
    logger.info(`IPN: فاتورة ${payload.invoice_id} — الحالة ${payload.payment_status}`);

    try {
      const result = handlePaymentUpdate(db, payload, notify);
      // نُعيد 200 دائماً ليعيد NOWPayments المحاولة فقط عند الأخطاء الحقيقية
      res.json({ received: true, result });
    } catch (err) {
      logger.error('خطأ في معالجة الإشعار:', err.message);
      res.status(500).json({ error: 'processing failed' });
    }
  });

  const server = app.listen(config.webhook.port, '0.0.0.0', () => {
    const callbackUrl = config.webhook.publicUrl
      ? `${config.webhook.publicUrl}${config.webhook.path}`
      : `http://<YOUR-DOMAIN>:${config.webhook.port}${config.webhook.path}`;
    logger.ok(`خادم الإشعارات يعمل على المنفذ ${config.webhook.port}`);
    logger.info(`رابط الإشعارات (IPN): ${callbackUrl}`);
  });

  return server;
}

export default startWebhookServer;
