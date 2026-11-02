// ============================================================
//  حرس العرض الحي: يضمن بقاء البوت شغّالاً لمدة محددة
//  (ساعة افتراضياً) ويكتب حالة التشغيل في data/demo-status.json
//
//  • يفحص الصحة كل 15 ثانية (واجهة 3000 + بوت 3001)
//  • يعيد تشغيل العرض تلقائياً عند التوقف (حتى 12 محاولة)
//  • يكتب سجلاً زمنياً لكل حدث
//
//  التشغيل: node scripts/demo-watchdog.js
//  المدة:   DEMO_RUNTIME_MS=3600000 (ساعة)
// ============================================================
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const RUNTIME_MS = Number(process.env.DEMO_RUNTIME_MS || 60 * 60 * 1000); // 60 دقيقة
const CHECK_MS = Number(process.env.DEMO_CHECK_MS || 15_000);             // كل 15 ثانية
const WEB_PORT = Number(process.env.DEMO_WEB_PORT || 3000);
const APP_PORT = Number(process.env.DEMO_APP_WEBHOOK_PORT || 3001);
const MAX_RESTARTS = Number(process.env.DEMO_MAX_RESTARTS || 12);

const STATUS_FILE = path.join(ROOT, 'data', 'demo-status.json');
const LOG_FILE = path.join(ROOT, 'data', 'demo-watchdog.log');

const startedAt = Date.now();
let restarts = 0;
let checks = 0;
let failures = 0;
let child = null;
let stopping = false;

const pad = (n) => String(n).padStart(2, '0');
const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const fmtUptime = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};

function log(line) {
  const entry = `[${stamp()}] ${line}`;
  fs.appendFileSync(LOG_FILE, `${entry}\n`);
  process.stdout.write(`${entry}\n`);
}

function writeStatus(extra = {}) {
  const status = {
    service: 'live-bot-demo',
    state: extra.state || (child ? 'running' : 'starting'),
    startedAt: new Date(startedAt).toISOString(),
    uptime: fmtUptime(Date.now() - startedAt),
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    runtimeMinutes: Math.round(RUNTIME_MS / 60000),
    endsAt: new Date(startedAt + RUNTIME_MS).toISOString(),
    restarts,
    healthChecks: checks,
    healthFailures: failures,
    ports: { ui: WEB_PORT, webhook: APP_PORT },
    lastCheckAt: extra.lastCheckAt || null,
    lastError: extra.lastError || null,
  };
  fs.writeFileSync(STATUS_FILE, `${JSON.stringify(status, null, 2)}\n`);
}

async function healthy(port) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: ctl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

function launch() {
  log(`🚀 تشغيل العرض الحي (محاولة رقم ${restarts + 1})`);
  child = spawn('node', ['scripts/demo.js'], {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.stdout.write(`[demo] ${d}`));
  child.stderr.on('data', (d) => process.stdout.write(`[demo] ${d}`));
  child.on('exit', (code) => {
    child = null;
    if (stopping) return;
    restarts += 1;
    log(`⚠️  توقف العرض (رمز ${code ?? 'غير معروف'}) — إعادة التشغيل #${restarts}`);
    if (restarts > MAX_RESTARTS) {
      log('❌ تجاوز الحد الأقصى لإعادة التشغيل — أوقفت الحرس');
      writeStatus({ state: 'failed', lastError: `max restarts (${MAX_RESTARTS})` });
      process.exit(1);
    }
    setTimeout(launch, 2500);
  });
}

function hardRestart(reason) {
  log(`🔄 إعادة تشغيل قسرية: ${reason}`);
  writeStatus({ state: 'restarting', lastError: reason });
  try {
    child?.kill('SIGKILL');
  } catch { /* ignore */ }
  // إجبار تحرير المنافذ من أي عملية متبقية
  spawn('pkill', ['-f', 'scripts/demo.js'], { stdio: 'ignore' });
  spawn('pkill', ['-f', 'src/index.js'], { stdio: 'ignore' });
  child = null;
  setTimeout(launch, 1500);
}

// ── التشغيل ────────────────────────────────────────────────
log(`🛡️  حرس العرض بدأ — المدة ${Math.round(RUNTIME_MS / 60000)} دقيقة، فحص كل ${CHECK_MS / 1000}s`);
launch();

const timer = setInterval(async () => {
  checks += 1;
  const now = new Date().toISOString();
  const uiOk = await healthy(WEB_PORT);
  const appOk = await healthy(APP_PORT);

  if (!uiOk || !appOk) {
    failures += 1;
    log(`❌ فحص #${checks}: ${uiOk ? 'واجهة ✅' : 'واجهة ❌'} — ${appOk ? 'بوت ✅' : 'بوت ❌'}`);
    if (failures >= 2) {
      failures = 0;
      if (!stopping) hardRestart(`فحص #${checks} فشل مرتين متتاليتين`);
      return;
    }
  } else {
    failures = 0;
    if (checks % 4 === 0) {
      log(`✅ فحص #${checks} — كل شيء يعمل — مدة التشغيل ${fmtUptime(Date.now() - startedAt)}`);
    }
  }
  writeStatus({ lastCheckAt: now });
}, CHECK_MS);

// إيقاف تلقائي عند انتهاء المدة
const stopAt = setTimeout(() => {
  stopping = true;
  clearInterval(timer);
  log(`⏹️  انتهت المدة المحددة (${Math.round(RUNTIME_MS / 60000)} دقيقة) — إيقاف العرض`);
  writeStatus({ state: 'stopped' });
  try { child?.kill('SIGTERM'); } catch { /* ignore */ }
  setTimeout(() => process.exit(0), 1500);
}, RUNTIME_MS);

process.on('SIGINT', () => {
  stopping = true;
  clearInterval(timer);
  clearTimeout(stopAt);
  log('⏹️  إيقاف يدوي للحرس');
  writeStatus({ state: 'stopped' });
  try { child?.kill('SIGTERM'); } catch { /* ignore */ }
  setTimeout(() => process.exit(0), 1200);
});
