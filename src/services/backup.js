import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import logger from '../utils/logger.js';

/**
 * إنشاء نسخة احتياطية متسقة من قاعدة البيانات باستخدام VACUUM INTO.
 * ضرورية على المنصات ذات القرص المؤقت (مثل Koyeb المجاني) حيث تُفقد
 * قاعدة البيانات عند كل تحديث أو إعادة تشغيل.
 */
export function createBackup(db) {
  const dir = path.join(path.dirname(path.resolve(config.dbPath)), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const file = path.join(dir, `bot-${stamp}.db`);
  // VACUUM INTO يفشل إذا كان الملف موجوداً — نستخدم اسماً فريداً
  const unique = fs.existsSync(file)
    ? path.join(dir, `bot-${stamp}-${Date.now()}.db`)
    : file;
  db.exec(`VACUUM INTO '${unique.replace(/'/g, "''")}'`);
  logger.ok(`نسخة احتياطية: ${unique} (${(fs.statSync(unique).size / 1024).toFixed(1)} KB)`);
  return unique;
}

/** قائمة النسخ الاحتياطية المحفوظة */
export function listBackups() {
  const dir = path.join(path.dirname(path.resolve(config.dbPath)), 'backups');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.db'))
    .map((f) => ({
      name: f,
      path: path.join(dir, f),
      sizeKb: fs.statSync(path.join(dir, f)).size / 1024,
      created: fs.statSync(path.join(dir, f)).mtime,
    }))
    .sort((a, b) => b.created - a.created);
}

export default createBackup;
