import axios from 'axios';
import crypto from 'node:crypto';
import { config } from '../config.js';
import logger from '../utils/logger.js';

const api = axios.create({
  baseURL: config.nowpayments.apiUrl,
  headers: { 'x-api-key': config.nowpayments.apiKey },
  timeout: 30_000,
});

/** واجهة السحب تستخدم توثيقاً مختلفاً (بريد + كلمة مرور → JWT) */
const payoutsApi = axios.create({
  baseURL: config.nowpayments.apiUrl,
  timeout: 30_000,
});

// ============================================================
//  التحقق من توقيع إشعار NOWPayments (IPN)
//  التوقيع = HMAC-SHA512 لمفتاح ipn_secret على كائن JSON
//  بمفاتيح مرتبة أبجدياً
// ============================================================
function sortedStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(sortedStringify).join(',')}]`;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${sortedStringify(obj[k])}`).join(',')}}`;
}

export function verifyIpnSignature(payload, signature) {
  if (!config.nowpayments.ipnSecret || !signature) return false;
  const hmac = crypto.createHmac('sha512', config.nowpayments.ipnSecret);
  hmac.update(sortedStringify(payload));
  const expected = hmac.digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ============================================================
//  نقاط النهاية العامة
// ============================================================

/** حالة الخدمة (هل تعمل العملة المطلوبة؟) */
export async function getApiStatus() {
  const { data } = await api.get('/v1/status');
  return data;
}

/** قائمة العملات المدعومة */
export async function getAvailableCurrencies() {
  const { data } = await api.get('/v1/currencies');
  return data.currencies || [];
}

/** الحد الأدنى للدفع بعملة معينة */
export async function getMinimumPaymentAmount(currencyFrom, currencyTo = config.currency) {
  const { data } = await api.get('/v1/min-amount', {
    params: { currency_from: currencyFrom, currency_to: currencyTo },
  });
  return Number(data.min_amount);
}

/** تقدير المبلغ المطلوب بالعملة الرقمية مقابل مبلغ بالدولار */
export async function getEstimate(amount, currencyFrom = config.currency, currencyTo) {
  const { data } = await api.get('/v1/estimate', {
    params: { amount, currency_from: currencyFrom, currency_to: currencyTo },
  });
  return data;
}

/**
 * إنشاء فاتورة إيداع — تولّد عنوان دفع فريداً لهذه العملية
 * وهذا ما يجعل "كل مستخدم له عنوان إيداع خاص" (لكل عملية إيداع عنوان فريد)
 */
export async function createInvoice({
  priceAmount, priceCurrency = config.currency, payCurrency,
  orderId, orderDescription, ipnCallbackUrl,
}) {
  const body = {
    price_amount: priceAmount,
    price_currency: priceCurrency,
    pay_currency: payCurrency,
    order_id: orderId,
    order_description: orderDescription || `إيداع في منصة الاستثمار — ${orderId}`,
    ipn_callback_url: ipnCallbackUrl,
  };
  const { data } = await api.post('/v1/invoice', body);
  return data;
}

/** استعلام حالة فاتورة */
export async function getInvoice(invoiceId) {
  const { data } = await api.get(`/v1/invoice/${invoiceId}`);
  return data;
}

// ============================================================
//  السحب التلقائي (يتطلب NOWPAYMENTS_PAYOUTS_EMAIL/PASSWORD)
// ============================================================
let payoutsToken = null;
let payoutsTokenExp = 0;

async function getPayoutsToken() {
  if (!config.nowpayments.payoutsEmail || !config.nowpayments.payoutsPassword) {
    throw new Error('بيانات واجهة السحب غير مهيّأة في .env');
  }
  if (payoutsToken && Date.now() < payoutsTokenExp) return payoutsToken;
  const { data } = await payoutsApi.post('/v1/auth', {
    email: config.nowpayments.payoutsEmail,
    password: config.nowpayments.payoutsPassword,
  });
  payoutsToken = data.token;
  payoutsTokenExp = Date.now() + (data.expires_in ? data.expires_in * 1000 : 3_600_000) - 60_000;
  return payoutsToken;
}

export function payoutsConfigured() {
  return Boolean(config.nowpayments.payoutsEmail && config.nowpayments.payoutsPassword);
}

/** إنشاء عملية دفع (payout) إلى عنوان خارجي */
export async function createPayout({ address, currency, amount }) {
  const token = await getPayoutsToken();
  const { data } = await payoutsApi.post(
    '/v1/payout',
    { address, currency, amount: String(amount) },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return data;
}

/** التحقق من أن العملة مدعومة فعلياً (عند توفر الاتصال) */
export async function filterSupportedCurrencies(codes) {
  try {
    const available = await getAvailableCurrencies();
    const set = new Set(available.map((c) => String(c).toLowerCase()));
    return codes.filter((c) => set.has(c));
  } catch (err) {
    logger.warn('تعذّر جلب قائمة العملات من NOWPayments، سيتم استخدام القائمة الافتراضية:', err.message);
    return codes;
  }
}
