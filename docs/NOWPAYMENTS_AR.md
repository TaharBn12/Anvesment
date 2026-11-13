# 💳 دليل إعداد NOWPayments بالكامل

> **قبل ما تبدأ:** البوت **لا يعمل بدون** `NOWPAYMENTS_API_KEY` — يتوقف
> فوراً عند التشغيل إن كان ناقصاً. فجهّزه قبل النشر.

---

## 📋 شنو تحتاج بالضبط؟

| المتغير | إلزامي؟ | وين تجيبه | شنو يسوي |
|---|---|---|---|
| `NOWPAYMENTS_API_KEY` | 🔴 **نعم** | Settings → API Keys | إنشاء الفواتير وجلب العناوين |
| `NOWPAYMENTS_IPN_SECRET` | 🟡 **مهم جداً** | Settings → IPN | التحقق من الإشعارات (بدونه: ثغرة أمنية) |
| `NOWPAYMENTS_PAYOUTS_EMAIL/PASSWORD` | 🟢 اختياري | حسابك | السحب التلقائي (بدونه: موافقة يدوية) |
| `PUBLIC_URL` | 🟡 للإيداع الفوري | رابط خدمتك | رابط استقبال الإشعارات |

---

## 1️⃣ إنشاء الحساب

1. افتح [nowpayments.io](https://account.nowpayments.io/sign-up)
2. سجّل بالبريد أو بحساب Google
3. أكّد البريد

> 💡 **بدون تحقق هوية (KYC)** تقدر تستقبل الإيداع. السحب التلقائي فقط
> يحتاج إكمال التحقق لاحقاً.

---

## 2️⃣ الحصول على مفتاح API

1. من لوحة التحكم → **Settings** (أو **Store Settings**)
2. اختر **API Keys**
3. اضغط **Add new key** / **Create**
4. انسخ المفتاح — يبدأ عادةً بحروف مثل `XXXX-XXXX-XXXX`

```
NOWPAYMENTS_API_KEY=ABCD1234-EFGH5678-IJKL9012
```

> 🔐 **احتفظ به في مكان آمن.** لو ضاع، احذفه وأنشئ غيره.

---

## 3️⃣ الحصول على سرّ IPN

1. من **Settings** → **Instant Payment Notifications** (أو **IPN**)
2. اضغط **Generate** / **Create secret**
3. انسخ السرّ

```
NOWPAYMENTS_IPN_SECRET=YOURIPNSECRET123
```

> ⚠️ **بدون هذا السرّ** يقبل البوت أي إشعار دون تحقق — يعني أي أحد
> يقدر يرسل إشعاراً مزيّفاً ويضيف رصيداً لنفسه! البوت يحذرك في السجلات:
> `NOWPAYMENTS_IPN_SECRET غير مضبوط — يتم قبول الإشعارات بدون تحقق (غير آمن!)`

---

## 4️⃣ ضبط رابط الإشعارات (IPN Callback)

هاذا الرابط اللي يرسل NOWPayments عليه تأكيد الدفع — **وهو سرّ الإيداع التلقائي**.

### الشكل
```
https://<رابط-خدمتك>/webhooks/nowpayments
```

### من وين تجيب `<رابط-خدمتك>`؟

| المنصة | الرابط |
|---|---|
| **Render** | `https://investment-bot.onrender.com` (من أعلى صفحة الخدمة) |
| **Koyeb** | `https://<app>.koyeb.app` |
| **ngrok** (للتجربة) | `https://a1b2.ngrok-free.app` |

### الخطوات
1. **قبل** أي شيء، ضع الرابط في إعدادات البوت:
```env
PUBLIC_URL=https://investment-bot.onrender.com
```
2. في لوحة NOWPayments → **Settings → IPN** → حقل **IPN Callback URL**، ضع:
```
https://investment-bot.onrender.com/webhooks/nowpayments
```
3. فعّل الإشعارات (Enable IPN)

> ✅ **كيف تعرف الرابط الصح؟** البوت يطبعه في السجلات عند التشغيل:
> `رابط الإشعارات (IPN): https://.../webhooks/nowpayments`
> انسخه كما هو حرفياً.

> ⚠️ **HTTPS فقط** — NOWPayments ما يرسل إشعارات لروابط HTTP عادية.
> و`localhost` أو `127.0.0.1` ما يشتغلون (لذلك ngrok أثناء التطوير).

---

## 5️⃣ وضع المفاتيح في البوت

### على الكمبيوتر (ملف `.env`)
```env
NOWPAYMENTS_API_KEY=ABCD1234-EFGH5678
NOWPAYMENTS_IPN_SECRET=YOURIPNSECRET123
PUBLIC_URL=https://investment-bot.onrender.com
```

### على Render / Koyeb
من لوحة الخدمة ← **Environment Variables** ← أضف الثلاثة ← **Save**.
(سيعاد النشر تلقائياً)

---

## 🧪 6️⃣ الطريقة الذكية للتجربة: الساندبوكس

**ما تحتاج تدفع مال حقيقي عشان تختبر!** NOWPayments يعطيك بيئة تجريبية:

1. سجّل في [account-sandbox.nowpayments.io](https://account-sandbox.nowpayments.io/sign-up)
2. خذ منها `API Key` و`IPN Secret` (نفس الخطوات أعلاه)
3. في إعدادات البوت غيّر الرابط:
```env
NOWPAYMENTS_API_URL=https://api-sandbox.nowpayments.io
```
4. شغّل البوت وجرّب إيداع 10$

**شنو يصير؟** تظهر لك تفاصيل الدفع مع رمز QR كالعادة. وبعد **ثوانٍ حتى دقيقتين**
NOWPayments الساندبوكس يُكمل الدفع تلقائياً — **بدون ما ترسل عملة حقيقية** —
ويرسل إشعار IPN، فيُضاف الرصيد تلقائياً.

> 🎯 **هذا أفضل طريقة تختبر بها التدفق كامل** قبل ما تستخدمه مع مستخدمين حقيقيين.
> ولما ترتاح، رجّع `NOWPAYMENTS_API_URL` (أو احذفه) عشان يرجع للإنتاج.

---

## 💸 7️⃣ السحب التلقائي (اختياري)

افتراضياً: المستخدم يطلب سحب → **الأدمن يوافق** → الدفع يدوي.

**للسحب التلقائي بالكامل:**

1. من لوحة NOWPayments أكّد حسابك (KYC) وفعّل **Payouts**
2. في الإعدادات، استخدم **نفس** بريد حسابك وكلمة مروره:
```env
NOWPAYMENTS_PAYOUTS_EMAIL=your@email.com
NOWPAYMENTS_PAYOUTS_PASSWORD=yourpassword
```

> ⚠️ **تحذير أمني:** هذي كلمة مرور حسابك في ملف `.env`. خلّه محلياً
> وعلى منصة موثوقة فقط. ولو ما ضبطتهم، البوت يشتغل عادي بموافقة يدوية —
> وهذا **أآمن** في البداية.

---

## 🆘 8️⃣ حل المشاكل

| المشكلة | السبب | الحل |
|---|---|---|
| البوت ما يبدأ، السجل: `NOWPAYMENTS_API_KEY` | المفتاح ناقص | ضيفه في `.env` أو Environment |
| `401 Unauthorized` عند الإيداع | المفتاح خاطئ أو محذوف | راجعه في Settings → API Keys |
| `فشل إنشاء عنوان الدفع` في البوت | المفتاح/الشبكة | راجع السجلات؛ جرّب `/start` ← إيداع |
| الإيداع ما يُضاف تلقائياً | `PUBLIC_URL` أو IPN غير مضبوط | يشتغل عبر المتابعة الدورية (تأخير دقيقة) — اضبط IPN للإيداع الفوري |
| `إشعار وصول بتوقيع غير صالح` | السرّ ما يطابق | تأكد أن `NOWPAYMENTS_IPN_SECRET` = سرّ IPN في اللوحة |
| `العملة غير مدعومة` | العملة ما تشتغلش بالحساب | اضغط «🔄 تحديث القائمة» في شاشة الإيداع لجلب القائمة الحية |
| `المبلغ صغير جداً لهذه العملة` | أقل من الحد الأدنى | البوت يخبرك بالحد الأدنى — جرّب مبلغاً أكبر أو عملة أخرى |
| الإيداع يعلّق على `confirming` | الشبكة بطيئة | طبيعي — يكمل تلقائياً عند تأكيد الشبكة |
| جرّبت الساندبوكس ودفعت حقيقي | نسيت تغيير `NOWPAYMENTS_API_URL` | رجّع القيمة أو احذفها |

---

## 🔐 9️⃣ نصائح أمنية

| افعل | لا تفعل |
|---|---|
| ✅ احتفظ بالمفاتيح في `.env` فقط | ❌ لا ترفع `.env` على GitHub |
| ✅ استخدم الساندبوكس أولاً | ❌ لا تبدأ بالإنتاج مباشرة |
| ✅ اضبط `NOWPAYMENTS_IPN_SECRET` دائماً | ❌ لا تشغّل بوت مال بدون تحقق التوقيع |
| ✅ سجّل `ADMIN_IDS` | ❌ لا تترك لوحة الأدمن مفتوحة للجميع |
| ✅ خذ نسخة بـ `/backup` دورياً | ❌ لا تعتمد على قرص منصة مجانية |

---

## ✅ 10️⃣ قائمة تحقق نهائية

قبل ما تقول "جاهز"، تأكد:

- [ ] حساب NOWPayments منشأ
- [ ] `NOWPAYMENTS_API_KEY` مضبوط
- [ ] `NOWPAYMENTS_IPN_SECRET` مضبوط
- [ ] `BOT_TOKEN` مضبوط
- [ ] `PUBLIC_URL` مضبوط (للإيداع الفوري)
- [ ] رابط IPN مضبوط في لوحة NOWPayments
- [ ] `ADMIN_IDS` مضبوط
- [ ] جرّبت إيداعاً في الساندبوكس ✅
- [ ] جرّبت إيداعاً حقيقياً صغيراً ✅

---

## 🔗 مراجع

- لوحة NOWPayments: [account.nowpayments.io](https://account.nowpayments.io)
- ساندبوكس: [account-sandbox.nowpayments.io](https://account-sandbox.nowpayments.io)
- وثائق API: [documenter.gopostman.com](https://documenter.getpostman.com/view/7907941/S1a32n38)
- [الدليل المفصّل للبوت](SETUP_AR.md) · [النشر على Render](RENDER_AR.md) · [النشر على Koyeb](KOYEB_AR.md)
