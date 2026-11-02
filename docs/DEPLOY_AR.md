# 📱 دليل التشغيل من الهاتف

بوت تلغرام يجب أن يعمل **24 ساعة** لاستقبال الرسائل وصرف الأرباح. لذلك أمامك خياران:

| الطريقة | المناسبة لـ | التكلفة |
|---|---|---|
| ☁️ **النشر على Koyeb** (موصى به) | أي هاتف (أندرويد/آيفون) | مجاني |
| 📲 **Termux** على أندرويد | فقط أندرويد، للتجربة السريعة | مجاني |

> 📘 **الدليل الكامل لـ Koyeb: [KOYEB_AR.md](KOYEB_AR.md)** — خطوة بخطوة بالصور من متصفح الهاتف.

---

## ☁️ الخيار الأول: النشر على Koyeb (الأفضل)

يعمل من متصفح هاتفك، والبوت يبقى شغّالاً 24/7 بدون هاتفك.

### 1️⃣ جهّز المستودع على GitHub
الكود مرفوع مسبقاً على: `https://github.com/TaharBn12/Anvesment`
(الفرع: `arena/eaf0e7c0-anvesment`)

### 2️⃣ إلى دليل Koyeb الكامل
الخطوات التفصيلية (بالصور، من متصفح الهاتف) في:
👉 **[KOYEB_AR.md](KOYEB_AR.md)**

باختصار: حساب Koyeb → **Create Service** → **GitHub** → اختر `Anvesment`
→ **Deploy** → أضف المتغيرات التالية في **Environment variables**:

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

### 3️⃣ انتظر النشر
Koyeb يبني المشروع تلقائياً (يستخدم `Dockerfile`). بعد دقيقة ستظهر السجلات:
```
✅ قاعدة البيانات جاهزة
✅ خادم الإشعارات يعمل على المنفذ 3000
🚀 البوت يعمل (وضع polling)
```

### 4️⃣ جرّب البوت
افتح تلغرام → بوتك → أرسل `/start` 🎉

### 5️⃣ (مهم) نسخة احتياطية من البيانات
الخطة المجانية في Koyeb **لا توفّر أقراصاً دائمة** — القرص يُمسح عند كل نشر.
أرسل `/backup` للبوت (أنت أدمن) لتحميل نسخة من القاعدة، أو اطّلع على
قسم النسخ الاحتياطي في [KOYEB_AR.md](KOYEB_AR.md).

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

## 🍎 آيفون؟ اقرأ هذا أولاً

### ❌ iSH Shell لا يستطيع تشغيل هذا البوت

جرّبت التحقق من الأمر بدل التخمين، والنتيجة قاطعة:

| السبب | التفصيل |
|---|---|
| **Node يُنهار داخل iSH** | Node الحديث يصدر أوامر معالج غير منفّذة في محاكي iSH → يظهر خطأ `illegal instruction` فوراً عند `node --version`. هذا عطل معروف ومفتوح منذ 2024 ([iSH#2335](https://github.com/ish-app/ish/issues/2335)) |
| **الحل الوحيد لا يفيدنا** | الحل المعروف هو تثبيت Node 12 من مستودعات Alpine v3.12 (سنة 2020). وهذا المشروع يحتاج **Node 22.5 أو أحدث** |
| **لماذا 22.5؟** | قاعدة البيانات مبنية على `node:sqlite` التي أُضيفت في Node 22.5 — لا وجود لها في Node 12 |
| **سرعة المحاكاة** | iSH يحاكي معالج 32-bit بدون JIT. حتى لو عمل Node، `npm install` يأخذ عشرات الدقائق |
| **لا يبقى شغّالاً** | لو عمل، يتوقف البوت لحظة إغلاق التطبيق أو قفل الشاشة — وهذا يُسقط البوت عن تلغرام |

> الخلاصة: **لا تضع توكنك في iSH.** لن يعمل، وستضيّع وقتك.

### ✅ الطرق الثلاث التي تعمل فعلاً على الآيفون

| # | الطريقة | Terminal؟ | يبقى 24/7؟ | التكلفة |
|---|---|---|---|---|
| 1 | **Koyeb** من متصفح سفاري | ❌ لا يحتاج | ✅ نعم | مجاني |
| 2 | **GitHub Codespaces** | ✅ داخل سفاري | ❌ يتوقف مع الجلسة | مجاني (محدود) |
| 3 | **Termius + سيرفر سحابي** | ✅ SSH | ✅ نعم | مجاني (Oracle) |

#### 1️⃣ Koyeb — الأفضل لك (بدون أي طرفية)

افتح **[دليل Koyeb الكامل](KOYEB_AR.md)** ونفّذه من سفاري. كل شيء بالضغط:
GitHub → Koyeb → اختر المستودع → Deploy → ضع المتغيرات. **لا تكتب أي أمر.**

#### 2️⃣ GitHub Codespaces — لتجربة سريعة داخل سفاري

1. من المستودع على GitHub اضغط الزر الأخضر **`<> Code`**
2. تبويب **Codespaces** → **Create codespace**
3. انتظر دقيقة، ثم في الطرفية:
```bash
cp .env.example .env
nano .env          # ضع BOT_TOKEN ثم CTRL+O للحفظ و CTRL+X للخروج
npm install
npm start
```
4. يجب أن يظهر `🚀 البوت يعمل`

> ⚠️ Codespace يتوقف بعد ~30 دقيقة من عدم الاستخدام (في الخطة المجانية). للتشغيل الدائم استخدم Koyeb.

#### 3️⃣ Termius + سيرفر — تحكم كامل

ثبّت **Termius** من App Store، وأنشئ حساباً على **Oracle Cloud Always Free**
(سيرفر لينكس مجاني دائماً: 1GB RAM، Node 22 يُثبَّت بأمر واحد). ثم:
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
git clone https://github.com/TaharBn12/Anvesment.git
cd Anvesment && git checkout arena/eaf0e7c0-anvesment
cp .env.example .env && nano .env
npm install && npm start
```
للإبقاء شغّالاً بعد إغلاق Termius: `npm install -g pm2 && pm2 start src/index.js && pm2 save`

---

## 🔔 للحفاظ على الإشعارات الفورية (IPN)
بعد النشر، Koyeb يعطيك رابطاً عاماً (مثل `https://xxx.up.railway.app`). أضفه في Variables:
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
