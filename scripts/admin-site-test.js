// ============================================================
//  اختبار ملفات موقع اللوحة (GitHub Pages)
//  يخدم ملفات docs/ كما يفعل GitHub Pages ويتأكد أن كل شي يُحمَّل.
// ============================================================
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs');

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

async function main() {
  console.log('\n🧪 اختبار ملفات موقع اللوحة\n');

  // ---- 1) الملفات موجودة ----
  console.log('1️⃣ الملفات');
  for (const f of ['admin/index.html', 'admin/app.js', 'admin/style.css', 'admin/README.md']) {
    const p = path.join(DOCS, f);
    const ok = fs.existsSync(p) && fs.statSync(p).size > 200;
    check(`${f} موجود`, ok, fs.existsSync(p) ? `${fs.statSync(p).size} bytes` : 'مفقود');
  }
  check('_config.yml موجود (لضبط Jekyll)', fs.existsSync(path.join(ROOT, '_config.yml')));

  const html = fs.readFileSync(path.join(DOCS, 'admin/index.html'), 'utf8');
  const js = fs.readFileSync(path.join(DOCS, 'admin/app.js'), 'utf8');
  const css = fs.readFileSync(path.join(DOCS, 'admin/style.css'), 'utf8');

  // ---- 2) بنية الصفحة ----
  console.log('\n2️⃣ بنية الصفحة');
  check('الصفحة عربية RTL', html.includes('dir="rtl"') && html.includes('lang="ar"'));
  check('تربط ملف CSS', html.includes('href="style.css"'));
  check('تربط ملف JS', html.includes('src="app.js"'));
  check('شاشة الدخول موجودة', html.includes('id="loginScreen"'));
  check('حقل الرابط موجود', html.includes('id="apiUrl"'));
  check('حقل الرمز موجود', html.includes('id="apiToken"'));
  for (const tab of ['dashboard', 'users', 'withdrawals', 'deposits']) {
    check(`تبويب ${tab} موجود`, html.includes(`id="tab-${tab}"`));
  }
  check('زر رابط الإحالة/المستخدم موجود', html.includes('data-tab="users"'));
  check('جدول السحوبات موجود', html.includes('id="wdTable"'));
  check('جدول المستخدمين موجود', html.includes('id="usersTable"'));
  check('جدول الإيداعات موجود', html.includes('id="depTable"'));
  check('نافذة منبثقة موجودة', html.includes('id="modal"'));

  // ---- 3) المنطق ----
  console.log('\n3️⃣ منطق JavaScript');
  check('يقرأ الرابط من localStorage', js.includes("localStorage.getItem('adminApiUrl')"));
  check('يقرأ الرمز من localStorage', js.includes("localStorage.getItem('adminToken')"));
  check('يرسل ترويسة x-admin-token', js.includes("'x-admin-token'"));
  check('يستخدم مسار /admin/api', js.includes('/admin/api'));
  check('يتحقق من الرابط عبر /ping قبل الرمز', js.includes('/admin/api/ping'));
  for (const ep of ['stats', 'users', 'withdrawals', 'deposits']) {
    check(`ينادي نقطة /${ep}`, js.includes(`/admin/api/${ep}`) || js.includes(`/admin/api/${ep}?`));
  }
  check('يعالج خطأ 401 بتسجيل الخروج', js.includes("err.status === 401"));
  check('يعالج خطأ 503 (واجهة معطّلة)', js.includes('503'));
  check('دوال الحظر مكشوفة', /window\.App = \{[\s\S]*setBan/.test(js));
  check('دوال تعديل الرصيد مكشوفة', /window\.App = \{[\s\S]*doAddBalance/.test(js));
  check('دوال السحوبات مكشوفة', /window\.App = \{[\s\S]*wdApprove[\s\S]*wdRejectPrompt[\s\S]*wdMarkPaid/.test(js));
  check('يهرّب HTML (مقاومة XSS)', js.includes('esc = (s)') && js.includes('&lt;'));

  // ---- 4) CSS ----
  console.log('\n4️⃣ التنسيق');
  check('تصميم داكن', css.includes('--bg:'));
  check('متغيّرات معرّفة', css.includes(':root {'));
  check('تنسيق الجوال', css.includes('@media (max-width: 640px)'));
  check('تنسيق الجداول', css.includes('.table'));
  check('تنسيق الحالة (pill)', css.includes('.pill'));
  check('RTL body', css.includes('body {') && css.includes('font-family'));

  // ---- 5) خدمة فعلية مثل GitHub Pages ----
  console.log('\n5️⃣ خدمة الملفات');
  const app = express();
  app.use(express.static(DOCS));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const get = async (p) => {
    const r = await fetch(`${base}${p}`);
    return { status: r.status, type: r.headers.get('content-type'), text: await r.text() };
  };
  const idx = await get('/admin/');
  check('/admin/ يُخدَم (200)', idx.status === 200, `status=${idx.status}`);
  check('يحتوي شاشة الدخول', idx.text.includes('loginScreen'));
  const a = await get('/admin/app.js');
  check('app.js يُخدَم', a.status === 200 && a.text.includes('window.App'));
  const c = await get('/admin/style.css');
  check('style.css يُخدَم', c.status === 200 && c.text.includes('--bg'));
  const missing = await get('/admin/nope.js');
  check('ملف مفقود → 404', missing.status === 404);
  server.close();

  console.log(`\n${'='.repeat(56)}`);
  console.log(`النتيجة: ✅ ${passed} نجاح | ❌ ${failed} فشل`);
  if (failures.length) console.log(`الفشل: ${failures.join(' | ')}`);
  console.log('='.repeat(56));
  process.exit(failed > 0 ? 1 : 0);
}

main();
