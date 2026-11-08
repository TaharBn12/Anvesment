@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

REM الانتقال لجذر المشروع (حتى يعمل النقر المزدوج من أي مكان)
cd /d "%~dp0.."

echo ========================================
echo     تشغيل بوت الاستثمار
echo ========================================
echo.

REM ---------- 1) التحقق من Node ----------
where node >nul 2>nul
if errorlevel 1 (
    echo [خطأ] Node.js غير مثبت على الجهاز.
    echo.
    echo   الحل: افتح https://nodejs.org وحمّل النسخة
    echo   التي عليها شارة LTS، ثم ثبّتها وأعد تشغيل هذا الملف.
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODEV=%%i
echo [ok] Node !NODEV! مثبت

REM ---------- 2) ملف الإعدادات .env ----------
if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo.
        echo [!] تم إنشاء ملف .env — سيفتح الآن في Notepad
        echo     ضع توكن البوت في السطر BOT_TOKEN= ثم احفظ بـ CTRL+S
        echo.
        notepad .env
    ) else (
        echo [خطأ] ملف .env.example غير موجود — تأكد أنك في مجلد المشروع.
        pause
        exit /b 1
    )
) else (
    echo [ok] ملف .env موجود
)

REM ---------- 3) تثبيت الحزم ----------
if not exist "node_modules" (
    echo.
    echo [!] تثبيت الحزم لأول مرة، انتظر دقيقة...
    call npm install --no-audit --no-fund --loglevel=error
    if errorlevel 1 (
        echo.
        echo [خطأ] فشل تثبيت الحزم. تأكد من اتصال الإنترنت وأعد المحاولة.
        pause
        exit /b 1
    )
    echo [ok] تم تثبيت الحزم
)

REM ---------- 4) تشغيل البوت ----------
echo.
echo ========================================
echo   البوت يعمل الآن — لا تغلق هذه النافذة
echo   للإيقاف: اضغط CTRL+C
echo ========================================
echo.
call npm start

echo.
echo [!] توقف البوت.
pause
