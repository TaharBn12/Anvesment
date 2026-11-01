// ============================================================
//  حساب مالي دقيق باستخدام أعداد صحيحة (وحدات صغيرة = micro)
//  1 دولار = 1_000_000 وحدة صغيرة  (6 منازل عشرية)
//  نتجنب أخطاء الفواصل العائمة باستخدام BigInt
// ============================================================
export const MICRO = 1_000_000n;
const MICRO_NUM = 1_000_000;

/** يحوّل نصاً/رقماً إلى وحدات صغيرة (BigInt) */
export function toMicro(value) {
  if (typeof value === 'bigint') return value;
  const str = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(str)) throw new Error(`قيمة غير صالحة: ${value}`);
  const negative = str.startsWith('-');
  const [intPart, fracPart = ''] = str.replace('-', '').split('.');
  const frac = (fracPart + '000000').slice(0, 6);
  const micro = BigInt(intPart || '0') * MICRO + BigInt(frac || '0');
  return negative ? -micro : micro;
}

/** يحوّل وحدات صغيرة إلى Number (للاستخدام في العمليات غير الحساسة) */
export function fromMicro(micro) {
  return Number(micro) / MICRO_NUM;
}

/** تنسيق مبلغ للعرض: يزيل الأصفار الزائدة ويضيف فواصل الآلاف */
export function formatMoney(micro, { decimals = 2, symbol = '$' } = {}) {
  const value = toBig(micro); // يقبل Number (من SQLite) أو BigInt أو نصاً
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const intPart = abs / MICRO;
  let fracPart = (abs % MICRO).toString().padStart(6, '0').slice(0, decimals);
  const intStr = intPart.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (decimals > 0) {
    fracPart = fracPart.replace(/0+$/, '');
    return `${neg ? '-' : ''}${intStr}${fracPart ? '.' + fracPart : ''} ${symbol}`.trim();
  }
  return `${neg ? '-' : ''}${intStr} ${symbol}`.trim();
}

/** تحويل آمن إلى BigInt (يقبل Number أو BigInt أو نص رقمي) */
export function toBig(value) {
  if (typeof value === 'bigint') return value;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`قيمة غير صالحة للتحويل: ${value}`);
  }
  return BigInt(n);
}

/** ضرب كسر (مخزّن كـ micro نسبة) في مبلغ micro: amount * rateMicro / 1e6 */
export function applyRate(amountMicro, rateMicro) {
  return (toBig(amountMicro) * toBig(rateMicro)) / MICRO;
}

/** نسبة يومية (مثلاً 2.5) إلى micro نسبة (2500000) */
export function rateToMicro(dailyRatePercent) {
  return toMicro(dailyRatePercent / 100);
}

/** التحقق أن النص يمثل مبلغاً موجباً صالحاً، ويعيد الرقم أو null */
export function parsePositiveAmount(input) {
  const str = String(input).trim().replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(str)) return null;
  const value = Number(str);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}
