import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import logger from './utils/logger.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY,           -- معرّف تلغرام
  username        TEXT,
  first_name      TEXT,
  balance         INTEGER NOT NULL DEFAULT 0,    -- رصيد المحفظة (micro USD)
  total_deposited INTEGER NOT NULL DEFAULT 0,
  total_withdrawn INTEGER NOT NULL DEFAULT 0,
  total_profit    INTEGER NOT NULL DEFAULT 0,
  referral_code   TEXT UNIQUE,
  referred_by     INTEGER,
  is_admin        INTEGER NOT NULL DEFAULT 0,
  state           TEXT NOT NULL DEFAULT 'idle',
  state_data      TEXT,                          -- JSON
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deposits (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  invoice_id      TEXT UNIQUE,
  order_id        TEXT UNIQUE,
  order_desc      TEXT,
  price_amount    INTEGER NOT NULL DEFAULT 0,    -- المبلغ بالدولار (micro)
  price_currency  TEXT NOT NULL DEFAULT 'usd',
  pay_currency    TEXT,
  pay_amount      TEXT,                          -- المبلغ بالعملة الرقمية
  pay_address     TEXT,
  status          TEXT NOT NULL DEFAULT 'waiting',
  actually_paid   TEXT,
  credited        INTEGER NOT NULL DEFAULT 0,    -- هل أُضيف للرصيد (لمنع التكرار)
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_deposits_user   ON deposits(user_id);
CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits(status);

CREATE TABLE IF NOT EXISTS investments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  level           INTEGER NOT NULL,
  amount          INTEGER NOT NULL,              -- رأس المال (micro USD)
  daily_rate      INTEGER NOT NULL,              -- النسبة اليومية (micro)
  duration_days   INTEGER NOT NULL,
  start_date      TEXT NOT NULL,
  end_date        TEXT NOT NULL,
  next_payout     TEXT NOT NULL,
  paid_days       INTEGER NOT NULL DEFAULT 0,
  earned          INTEGER NOT NULL DEFAULT 0,    -- إجمالي ما صُرف من أرباح
  status          TEXT NOT NULL DEFAULT 'active',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_investments_user   ON investments(user_id);
CREATE INDEX IF NOT EXISTS idx_investments_status ON investments(status, next_payout);

CREATE TABLE IF NOT EXISTS payouts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  investment_id   INTEGER NOT NULL,
  user_id         INTEGER NOT NULL,
  amount          INTEGER NOT NULL,
  payout_date     TEXT NOT NULL,
  type            TEXT NOT NULL DEFAULT 'profit', -- profit | capital
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  amount          INTEGER NOT NULL,              -- micro USD
  currency        TEXT NOT NULL,
  address         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending', -- pending|approved|paid|rejected
  payout_id       TEXT,
  admin_note      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  type            TEXT NOT NULL,                 -- deposit|invest|profit|capital|withdraw|refund
  amount          INTEGER NOT NULL,              -- micro USD (موجب = دخول، سالب = خروج)
  ref_type        TEXT,
  ref_id          TEXT,
  note            TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`;

export function createDatabase(dbPath) {
  // دعم ':memory:' كقاعدة في الذاكرة (بدون تحويلها لمسار ملف)
  const isMemory = dbPath === ':memory:';
  const resolved = isMemory ? dbPath : path.resolve(dbPath);
  if (!isMemory) {
    const dir = path.dirname(resolved);
    if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(resolved);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  logger.ok(`قاعدة البيانات جاهزة: ${resolved}`);
  return db;
}

/** أدوات مساعدة عامة على قاعدة البيانات */
export const dbHelpers = {
  getSetting(db, key, fallback = null) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : fallback;
  },
  setSetting(db, key, value) {
    db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(key, String(value));
  },
};

export default createDatabase;
