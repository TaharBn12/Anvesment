// ============================================================
//  المستويات الاستثمارية الخمسة
//  - min / max: بالدولار ( inclusive )
//  - dailyRate: نسبة الربح اليومي %
//  - durationDays: مدة العقد بالأيام
//  - عند انتهاء المدة يُعاد رأس المال + تُصرف الأرباح اليومية
// ============================================================
export const INVESTMENT_LEVELS = [
  { level: 1, name: '🥉 برونزي',  min: 10,    max: 99,      dailyRate: 2,   durationDays: 30  },
  { level: 2, name: '🥈 فضي',     min: 100,   max: 499,     dailyRate: 2.5, durationDays: 45  },
  { level: 3, name: '🥇 ذهبي',    min: 500,   max: 1999,    dailyRate: 3,   durationDays: 60  },
  { level: 4, name: '💎 بلاتيني', min: 2000,  max: 9999,    dailyRate: 3.5, durationDays: 90  },
  { level: 5, name: '👑 VIP',     min: 10000, max: Infinity, dailyRate: 4,   durationDays: 120 },
];

export function getLevel(levelNumber) {
  return INVESTMENT_LEVELS.find((l) => l.level === Number(levelNumber)) || null;
}

export function findLevelForAmount(amountUsd) {
  return INVESTMENT_LEVELS.find((l) => amountUsd >= l.min && amountUsd <= l.max) || null;
}

// ============================================================
//  العملات المدعومة للإيداع (رموز NOWPayments)
//  الأسماء تُعرض للمستخدم؛ الرموز تُرسل للـ API
// ============================================================
export const DEFAULT_DEPOSIT_CURRENCIES = [
  { code: 'usdttrc20',  name: 'USDT — TRC20 (شبكة ترون)' },
  { code: 'usdtbsc',    name: 'USDT — BEP20 (BSC)' },
  { code: 'usdterc20',  name: 'USDT — ERC20 (Ethereum)' },
  { code: 'usdcerc20',  name: 'USDC — ERC20 (Ethereum)' },
  { code: 'trx',        name: 'TRX — TRON' },
  { code: 'btc',        name: 'BTC — Bitcoin' },
  { code: 'eth',        name: 'ETH — Ethereum' },
  { code: 'ltc',        name: 'LTC — Litecoin' },
];

export const CURRENCY_NAMES = Object.fromEntries(
  DEFAULT_DEPOSIT_CURRENCIES.map((c) => [c.code, c.name])
);

// ============================================================
//  حالات محادثة المستخدم (FSM مبسّطة محفوظة في قاعدة البيانات)
// ============================================================
export const STATES = {
  IDLE: 'idle',
  DEPOSIT_AMOUNT: 'deposit_amount',
  INVEST_AMOUNT: 'invest_amount',     // state_data: { level }
  WITHDRAW_AMOUNT: 'withdraw_amount',
  WITHDRAW_CURRENCY: 'withdraw_currency', // state_data: { amount }
  WITHDRAW_ADDRESS: 'withdraw_address',   // state_data: { amount, currency }
  BROADCAST: 'broadcast',                 // خاص بالأدمن
};

// حالات إيداع NOWPayments النهائية (لا تُحدَّث بعدها)
export const FINAL_PAYMENT_STATUSES = ['finished', 'failed', 'expired', 'refunded'];

// الحالات التي تُحتسب للإيداع الناجح
export const SUCCESS_PAYMENT_STATUSES = ['finished'];
