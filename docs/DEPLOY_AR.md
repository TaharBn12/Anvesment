# 📱 دليل التشغيل من الهاتف

بوت تلغرام يجب أن يعمل **24 ساعة** لاستقبال الرسائل وصرف الأرباح. لذلك أمامك خياران:

| الطريقة | المناسبة لـ | التكلفة |
|---|---|---|
| ☁️ **النشر على Railway** (موصى به) | أي هاتف (أندرويد/آيفون) | مجاني (~5$ شهرياً تكفي) |
| 📲 **Termux** على أندرويد | فقط أندرويد، للتجربة السريعة | مجاني |

---

## ☁️ الخيار الأول: النشر على Railway (الأفضل)

يعمل من متصفح هاتفك، والبوت يبقى شغّالاً 24/7 بدون هاتفك.

### 1️⃣ جهّز المستودع على GitHub
الكود مرفوع مسبقاً على: `https://github.com/TaharBn12/Anvesment`
(الفرع: `arena/eaf0e7c0-anvesment`)

### 2️⃣ أنشئ حساب Railway
1. من متصفح هاتفك افتح [railway.app](https://railway.app)
2. سجّل بحساب GitHub مباشرة (زر **Login with GitHub**)
3. اضغط **New Project** → **Deploy from GitHub repo** → اختر `Anvesment`

### 3️⃣ أضف متغيرات البيئة
في صفحة المشروع: **Variables** → **Raw Editor** → الصق:

```env
BOT_TOKEN=9068383353:AAEGXAEUpOCy-cdGTGZpy05aADxegQJs3b0
ADMIN_IDS=ضع_معرفك_هنا
NOWPAYMENTS_API_KEY=
NOWPAYMENTS_IPN_SECRET=
CURRENCY=usd
MIN_DEPOSIT=10
MIN_WITHDRAW=5
PAYOUT_HOUR=0
DB_PATH=/app/data/bot.db
```

> ⚠️ املأ `ADMIN_IDS` لاحقاً: بعد التشغيل أرسل `/id` للبوت في تلغرام وسيعطيك معرّفك.

### 4️⃣ انتظر النشر
Railway سيبني المشروع تلقائياً (يستخدم `Dockerfile`). بعد دقيقة ستظهر السجلات:
```
✅ قاعدة البيانات جاهزة
✅ خادم الإشعارات يعمل على المنفذ 3000
🚀 البوت يعمل (وضع polling)
```

### 5️⃣ جرّب البوت
افتح تلغرام → بوتك → أرسل `/start` 🎉

### 6️⃣ (مهم) قرص دائم للبيانات
حتى لا تُفقد الأرصدة عند إعادة النشر:
**Settings** → **Volumes** → **Add Volume** → المسار: `/app/data`

---

## 📲 الخيار الثاني: Termux على أندرويد

للتجربة السريعة على هاتف أندرويد مباشرة:

### 1️⃣ ثبّت Termux
من [F-Droid](https://f-droid.org/packages/com.termux/) (ليس من Google Play — النسخة هناك قديمة).

### 2️⃣ نفّذ هذه الأوامر (انسخ والصق واحداً واحداً)
```bash
pkg update && pkg upgrade -y
pkg install nodejs-lts git -y
git clone https://github.com/TaharBn12/Anvesment.git
cd Anvesment
git checkout arena/eaf0e7c0-anvesment
npm install
```

### 3️⃣ أنشئ ملف .env بتوكنك
```bash
cp .env.example .env
nano .env
```
عدّل السطر `BOT_TOKEN=` بتوكنك (الصق بالضغط المطوّل → Paste)، ثم:
- احفظ بـ `CTRL+O` ثم Enter
- اخرج بـ `CTRL+X`

### 4️⃣ شغّل البوت
```bash
npm start
```

### 5️⃣ أبقِه شغّالاً
- أوقف تحسين البطارية لـ Termux من إعدادات أندرويد (وضع "غير مقيّد")
- أو نفّذ `termux-wake-lock` قبل التشغيل

> ⚠️ ملاحظة: Termux للتجربة فقط — إذا أُطفئ الهاتف أو قتل أندرويد التطبيق، يتوقف البوت.

---

## 🍎 آيفون؟
لا يوجد Termux على iOS. استخدم **خيار Railway** أعلاه — يعمل من متصفح سفاري تماماً.

---

## 🔔 للحفاظ على الإشعارات الفورية (IPN)
بعد النشر، Railway يعطيك رابطاً عاماً (مثل `https://xxx.up.railway.app`). أضفه في Variables:
```env
PUBLIC_URL=https://xxx.up.railway.app
```
ثم في لوحة NOWPayments → **Settings → IPN** → ضع رابط الإشعارات:
`https://xxx.up.railway.app/webhooks/nowpayments`

بدون هذا الرابط يعمل الإيداع عبر المتابعة الدورية (تأخير دقيقة واحدة) — لكن للإنتاج اضبطه.

---

## 🆘 استكشاف الأخطاء من الهاتف

| المشكلة | الحل |
|---|---|
| السجلات تظهر `فشل الاتصال بتلغرام` | التوكن خاطئ — تحقق منه في Variables |
| البوت لا يرد | تأكد أن آخر سطر في السجلات `🚀 البوت يعمل` |
| `Unauthorized` | التوكن غير صحيح أو مُبطَل (/revoke) |
| فقدت الأرصدة بعد إعادة النشر | أضف Volume على المسار `/app/data` |
| الإيداع لا يُضاف تلقائياً | اضبط `PUBLIC_URL` ورابط IPN في NOWPayments |
