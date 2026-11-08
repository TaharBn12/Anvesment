# 📖 دليل الإعداد خطوة بخطوة

## 1️⃣ إنشاء بوت تلغرام

1. افتح [@BotFather](https://t.me/BotFather) في تلغرام.
2. أرسل `/newbot` واتبع التعليمات (اختر اسماً واسم مستخدم ينتهي بـ `bot`).
3. احتفظ بالتوكن الذي يعطيك إياه (مثل `123456:ABC-DEF...`).
4. (اختياري) أرسل `/setdescription` و`/setuserpic` لتجميل البوت.
5. احصل على معرّفك الرقمي من [@userinfobot](https://t.me/userinfobot) — تحتاجه لـ `ADMIN_IDS`.

## 2️⃣ إنشاء حساب NOWPayments

1. سجّل في [nowpayments.io](https://account.nowpayments.io/sign-up).
2. من لوحة التحكم → **Settings → API keys** → أنشئ مفتاحاً جديداً (احتفظ به).
3. من **Settings → Instant Payment Notifications** → أنشئ سرّ IPN (احتفظ به).
4. أضف عناوين السحب الخاصة بك في **Settings → Payout addresses** إن أردت السحب التلقائي.

## 3️⃣ إعداد ملف البيئة

```bash
cp .env.example .env
```

عدّل القيم:

```env
BOT_TOKEN=123456:ABC-DEF...
ADMIN_IDS=123456789
NOWPAYMENTS_API_KEY=XXXX-XXXX
NOWPAYMENTS_IPN_SECRET=XXXX
```

## 4️⃣ التشغيل للتطوير (مع ngrok)

الإشعارات الفورية تحتاج رابطاً عاماً (HTTPS). أثناء التطوير:

```bash
# نافذة 1: شغّل البوت
npm start

# نافذة 2: اجعل الخادم متاحاً عبر الإنترنت
ngrok http 3000
```

خذ الرابط من ngrok (مثل `https://a1b2.ngrok.io`) وضعه في `.env`:

```env
PUBLIC_URL=https://a1b2.ngrok.io
```

ثم أعد تشغيل البوت. رابط الإشعارات الكامل سيظهر في السجلات:
`https://a1b2.ngrok.io/webhooks/nowpayments`

## 5️⃣ التشغيل في الإنتاج

```bash
# على السيرفر (مثال بـ Node 22)
git clone <repo> && cd <repo>
npm install --omit=dev
cp .env.example .env   # عدّل القيم
npm start
```

**مهم:** شغّل الخادم خلف nginx مع HTTPS حتى يعمل IPN:

```nginx
server {
    listen 443 ssl;
    server_name mybot.example.com;
    ssl_certificate     /path/cert.pem;
    ssl_certificate_key /path/key.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

ثم اضبط:

```env
PUBLIC_URL=https://mybot.example.com
```

> ⚠️ بوابة NOWPayments ترسل الإشعارات فقط لروابط HTTPS صالحة. بدون `PUBLIC_URL` سيعمل البوت عبر **المتابعة الدورية** (كل 60 ثانية) لكن التأكيد سيتأخر دقيقة بدلاً من كونه فورياً.

## 6️⃣ تخصيص المستويات الاستثمارية

عدّل `src/constants.js`:

```js
export const INVESTMENT_LEVELS = [
  { level: 1, name: '🥉 برونزي',  min: 10,    max: 99,      dailyRate: 2,   durationDays: 30  },
  { level: 2, name: '🥈 فضي',     min: 100,   max: 499,     dailyRate: 2.5, durationDays: 45  },
  { level: 3, name: '🥇 ذهبي',    min: 500,   max: 1999,    dailyRate: 3,   durationDays: 60  },
  { level: 4, name: '💎 بلاتيني', min: 2000,  max: 9999,    dailyRate: 3.5, durationDays: 90  },
  { level: 5, name: '👑 VIP',     min: 10000, max: Infinity, dailyRate: 4,   durationDays: 120 },
];
```

- `min` / `max`: نطاق المبلغ بالدولار (`Infinity` = بلا حد أعلى).
- `dailyRate`: نسبة الربح اليومي %.
- `durationDays`: مدة العقد بالأيام، وبعدها يُعاد رأس المال.

## 7️⃣ أوامر البوت

| الأمر / الزر | الوظيفة |
|---|---|
| `/start` | التسجيل + القائمة الرئيسية |
| 💰 إيداع | إنشاء عنوان دفع فريد بالإيداع |
| 📈 استثمار | عرض المستويات واختيار واحد |
| 📊 استثماراتي | متابعة العقود النشطة والأرباح |
| 💼 محفظتي | الرصيد والإجماليات وسجل العمليات |
| 💸 سحب | طلب سحب إلى عنوان المستخدم |
| `/admin` | لوحة الأدمن (إحصائيات، سحوبات، رسائل جماعية) |

## 8️⃣ حل المشكلات

| المشكلة | الحل |
|---|---|
| `المتغير البيئي مطلوب: BOT_TOKEN` | تأكد من نسخ `.env.example` إلى `.env` وملء القيم |
| الإيداع لا يُضاف تلقائياً | تحقق من `PUBLIC_URL` وأن الرابط يعمل (`curl https://your-url/health`)، ومن `NOWPAYMENTS_IPN_SECRET` |
| `invalid signature` في السجلات | سرّ IPN في `.env` لا يطابق سرّ NOWPayments |
| `رصيد غير كافٍ` عند السحب | المبلغ أكبر من رصيد المحفظة |
| الأرباح لا تصرف | المهمة مجدولة على `PAYOUT_HOUR` بتوقيت السيرفر — أو شغّلها يدوياً من Node بـ `runDailyPayouts(db)` |
| العملة غير مدعومة | اضغط «🔄 تحديث القائمة» في شاشة الإيداع لجلب القائمة الحية من NOWPayments |

## 9️⃣ النسخ الاحتياطي

قاعدة البيانات في `data/bot.db`. انسخها دورياً:

```bash
sqlite3 data/bot.db ".backup 'backup.db'"
# أو ببساطة
cp data/bot.db backups/bot-$(date +%F).db
```
