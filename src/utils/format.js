import { formatMoney, fromMicro } from './money.js';

/** تاريخ اليوم بصيغة YYYY-MM-DD (بتوقيت UTC) */
export function todayStr(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

/** إضافة أيام لتاريخ بصيغة YYYY-MM-DD وإرجاع نفس الصيغة */
export function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** فرق بالأيام بين تاريخين (b - a) */
export function daysBetween(aStr, bStr) {
  const a = new Date(`${aStr}T00:00:00Z`).getTime();
  const b = new Date(`${bStr}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** عرض نسبة مئوية بشكل نظيف */
export function formatPercent(ratePercent) {
  return `${Number(ratePercent)}%`;
}

/** عرض رصيد بعملة الدولار */
export function usd(micro, decimals = 2) {
  return formatMoney(micro, { decimals, symbol: '$' });
}

/** رقم بسيط بدون رمز */
export function amountStr(micro, decimals = 6) {
  return formatMoney(micro, { decimals, symbol: '' }).trim();
}

/** نسبة الإنجاز 0..1 */
export function progress(done, total) {
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, done / total));
}

export function progressBar(done, total, width = 10) {
  const p = progress(done, total);
  const filled = Math.round(p * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/** مخفي رقم تلغرام جزئياً للعرض في لوحة الأدمن */
export function maskId(id) {
  const s = String(id);
  return s.length > 4 ? `${s.slice(0, 2)}***${s.slice(-2)}` : s;
}

export { fromMicro };
