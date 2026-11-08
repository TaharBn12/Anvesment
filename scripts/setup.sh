#!/usr/bin/env bash
# ============================================================
#  التثبيت بأمر واحد — بوت الاستثمار
#
#  يعمل على: Ubuntu / Debian / Alpine
#  ما يفعله: يثبّت Node 22 إن لزم، يجلب الكود، يجهّز .env،
#            يثبّت pm2 ويشغّل البوت بشكل دائم (24/7).
#
#  التشغيل (احفظه أولاً حتى تعمل الأسئلة التفاعلية):
#    curl -fsSL https://raw.githubusercontent.com/TaharBn12/Anvesment/arena/eaf0e7c0-anvesment/scripts/setup.sh -o setup.sh
#    bash setup.sh
#
#  لإعادة التشغيل لاحقاً وتحديث الكود: bash setup.sh   (آمن للتكرار)
# ============================================================
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/TaharBn12/Anvesment.git}"
BRANCH="${BRANCH:-arena/eaf0e7c0-anvesment}"
APP_DIR="${APP_DIR:-Anvesment}"
APP_NAME="investment-bot"

# ---- ألوان للوضوح على الهاتف ----
if [ -t 1 ]; then
  G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; B=$'\e[1m'; N=$'\e[0m'
else
  G=''; Y=''; R=''; B=''; N=''
fi
step() { printf '\n%s▶%s %s%s%s\n' "$B" "$N" "$B" "$1" "$N"; }
ok()   { printf '  %s✅%s %s\n' "$G" "$N" "$1"; }
warn() { printf '  %s⚠️%s  %s\n' "$Y" "$N" "$1"; }
die()  { printf '  %s❌%s %s\n' "$R" "$N" "$1" >&2; exit 1; }

# ---- هل نحتاج sudo؟ ----
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then SUDO="sudo"; else die "شغّل السكربت بحساب root أو ثبّت sudo"; fi
fi

# ---- كشف النظام ----
if [ -f /etc/alpine-release ]; then DISTRO="alpine"
elif [ -f /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}" in
    ubuntu|debian|linuxmint|pop) DISTRO="debian" ;;
    *) case "${ID_LIKE:-}" in *debian*|*ubuntu*) DISTRO="debian" ;; *) DISTRO="unknown" ;; esac ;;
  esac
else DISTRO="unknown"; fi

printf '%s================================================%s\n' "$B" "$N"
printf '%s   🚀 تثبيت بوت الاستثمار — بأمر واحد%s\n' "$B" "$N"
printf '%s================================================%s\n' "$B" "$N"
printf '  النظام المكتشف: %s\n' "$DISTRO"

# ============================================================
step "1/5 — التحقق من Node.js"
# ============================================================
node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local v major minor
  v="$(node -v 2>/dev/null | sed 's/^v//')" || return 1
  major="${v%%.*}"
  minor="$(printf '%s' "$v" | cut -d. -f2)"
  [ "${major:-0}" -gt 22 ] && return 0
  [ "${major:-0}" -eq 22 ] && [ "${minor:-0}" -ge 5 ] && return 0
  return 1
}

if node_ok; then
  ok "Node $(node -v) موجود ويكفي"
else
  warn "Node 22.5 أو أحدث مطلوب (يوجد: $(node -v 2>/dev/null || echo 'لا شيء'))"
  case "$DISTRO" in
    debian)
      $SUDO apt-get update -qq
      $SUDO apt-get install -y -qq ca-certificates curl gnupg git >/dev/null
      curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash - >/dev/null 2>&1 \
        || die "فشل تحميل مثبّت Node. تحقق من الإنترنت وحاول مرة أخرى."
      $SUDO apt-get install -y -qq nodejs >/dev/null
      ;;
    alpine)
      $SUDO apk add --no-cache nodejs npm git >/dev/null 2>&1 \
        || die "فشل تثبيت Node. على Alpine قد تحتاج: apk add nodejs-current"
      ;;
    *) die "نظام غير مدعوم. ثبّت Node 22.5+ يدوياً ثم أعد التشغيل." ;;
  esac
  node_ok || die "ما زال Node قديماً بعد التثبيت: $(node -v 2>/dev/null). ثبّت 22.5+ يدوياً."
  ok "تم تثبيت Node $(node -v)"
fi

# npm مطلوب كذلك
command -v npm >/dev/null 2>&1 || die "npm غير موجود — ثبّت Node مرة أخرى"

# ============================================================
step "2/5 — جلب الكود من GitHub"
# ============================================================
if [ -d "$APP_DIR/.git" ]; then
  ok "المجلد موجود — جارٍ التحديث"
  git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH" -q
  git -C "$APP_DIR" checkout -q "$BRANCH" 2>/dev/null || git -C "$APP_DIR" checkout -qB "$BRANCH" "origin/$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$BRANCH" -q
  ok "الكود محدّث"
else
  git clone --depth 1 -b "$BRANCH" "$REPO_URL" "$APP_DIR" -q
  ok "تم نسخ المستودع"
fi
cd "$APP_DIR"

# ============================================================
step "3/5 — ملف الإعدادات .env"
# ============================================================
if [ -f .env ]; then
  ok "يوجد .env — لن يُستبدل (توكنك محفوظ)"
else
  cp .env.example .env
  printf '\n  📋 أدخل توكن البوت من @BotFather\n'
  printf '     (مثال: 123456789:AAEg...)\n'
  printf '     التوكن: '
  read -r TOKEN || TOKEN=""
  if [ -z "$TOKEN" ]; then
    warn "لم تُدخل توكناً — عدّل الملف لاحقاً: nano .env"
  else
    # استبدال سطر BOT_TOKEN بشكل آمن
    if grep -q '^BOT_TOKEN=' .env; then
      sed -i "s|^BOT_TOKEN=.*|BOT_TOKEN=$TOKEN|" .env
    else
      printf 'BOT_TOKEN=%s\n' "$TOKEN" >> .env
    fi
    ok "تم حفظ التوكن"
  fi
  printf '\n  💡 معرّف الأدمن: شغّل البوت ثم أرسل /id له في تلغرام،\n'
  printf '     ثم ضع الرقم في ADMIN_IDS داخل .env\n'
fi

# ============================================================
step "4/5 — تثبيت الحزم"
# ============================================================
npm install --no-audit --no-fund --loglevel=error
ok "الحزم مثبّتة"

# ============================================================
step "5/5 — التشغيل الدائم عبر pm2"
# ============================================================
if ! command -v pm2 >/dev/null 2>&1; then
  $SUDO npm install -g pm2 --no-audit --no-fund --loglevel=error >/dev/null 2>&1 \
    || npm install -g pm2 --no-audit --no-fund --loglevel=error >/dev/null 2>&1 \
    || die "فشل تثبيت pm2"
  ok "pm2 مثبّت"
fi

if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 reload "$APP_NAME" --update-env >/dev/null 2>&1 || pm2 restart "$APP_NAME" >/dev/null
  ok "أُعيد تحميل البوت"
else
  pm2 start src/index.js --name "$APP_NAME" --time >/dev/null
  ok "البوت يعمل الآن"
fi
pm2 save >/dev/null 2>&1 || true

# تشغيل تلقائي عند إعادة تشغيل السيرفر (يحتاج root)
if [ "$(id -u)" -eq 0 ]; then
  pm2 startup systemd -u "$(logname 2>/dev/null || echo root)" --hp "$(eval echo ~"$(logname 2>/dev/null || echo root)")" >/dev/null 2>&1 || true
fi

# ============================================================
printf '\n%s================================================%s\n' "$B" "$N"
printf '%s   ✅ تم! البوت يعمل على السيرفر%s\n' "$G" "$N"
printf '%s================================================%s\n' "$B" "$N"
printf '\n  📊 أوامر تحتاجها من iSH:\n'
printf '     pm2 status              — حالة البوت\n'
printf '     pm2 logs %-14s — السجلات المباشرة\n' "$APP_NAME"
printf '     pm2 restart %-11s — إعادة التشغيل\n' "$APP_NAME"
printf '     bash setup.sh           — تحديث الكود لاحقاً\n'
printf '\n  🤖 افتح تلغرام وأرسل /start لبوتك\n'
printf '  💾 للنسخ الاحتياطي: أرسل /backup (يحتاج ADMIN_IDS)\n'
printf '\n  ⚠️  تأكد من إضافة رابط الإشعارات في NOWPayments:\n'
printf '     http://<ip-السيرفر>:3000/webhooks/nowpayments\n\n'
