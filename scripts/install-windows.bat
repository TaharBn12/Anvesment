@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

REM ============================================================
REM  مثبّت بوت الاستثمار — بنقرة واحدة على Windows
REM
REM  ما يفعله تلقائياً:
REM    1) يتحقق من Node.js (ويفتح صفحة التحميل لو ناقص)
REM    2) يحمّل المشروع من GitHub
REM    3) يفكّ الضغط في %USERPROFILE%\Anvesment
REM    4) يجهّز ملف .env ويسألك على التوكن
REM    5) يثبّت الحزم ويشغّل البوت
REM
REM  التشغيل: انقر مرتين على هذا الملف. هذا كل شيء.
REM ============================================================

set "ZIP_URL=https://github.com/TaharBn12/Anvesment/archive/refs/heads/main.zip"
set "INSTALL_DIR=%USERPROFILE%\Anvesment"
set "ZIP=%TEMP%\anvesment.zip"
set "EXTRACT=%TEMP%\anvesment-extract"

echo ========================================
echo    مثبّت بوت الاستثمار — بنقرة واحدة
echo ========================================
echo.

REM ---------- 1) التحقق من Node ----------
where node >nul 2>nul
if errorlevel 1 (
    echo [!/] Node.js غير مثبت على الجهاز.
    echo.
    echo      سأفتح صفحة التحميل الآن:
    echo        1. حمّل النسخة التي عليها شارة LTS
    echo        2. ثبّتها ^(اضغط Next في كل الخطوات^)
    echo        3. شغّل هذا الملف مرة أخرى
    echo.
    start https://nodejs.org
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do set NODEV=%%i
echo [ok] Node !NODEV! مثبت

REM ---------- 2) تحميل المشروع وفك الضغط ----------
if exist "%INSTALL_DIR%\package.json" (
    echo [ok] المشروع موجود مسبقاً في:
    echo      %INSTALL_DIR%
) else (
    echo [!] جارٍ تحميل المشروع من GitHub...
    echo      ^(لا تغلق هذه النافذة^)
    powershell -NoProfile -Command "Invoke-WebRequest -Uri '%ZIP_URL%' -OutFile '%ZIP%'"
    if not exist "%ZIP%" (
        echo.
        echo [خطأ] فشل التحميل.
        echo        تأكد من اتصال الإنترنت وحاول مرة أخرى.
        pause
        exit /b 1
    )
    echo [!] جارٍ فك الضغط...
    if exist "%EXTRACT%" rmdir /s /q "%EXTRACT%" >nul 2>&1
    powershell -NoProfile -Command "Expand-Archive -Path '%ZIP%' -DestinationPath '%EXTRACT%' -Force"
    if not exist "%EXTRACT%\Anvesment-main" (
        echo [خطأ] ما لقيت المجلد بعد فك الضغط.
        pause
        exit /b 1
    )
    REM لو كان فيه مجلد ناقص من محاولة سابقة، نحذفه أولاً
    REM (وإلا move يحط المشروع داخل بدل ما يستبدله)
    if exist "%INSTALL_DIR%" (
        if not exist "%INSTALL_DIR%\package.json" rmdir /s /q "%INSTALL_DIR%" >nul 2>&1
    )
    if not exist "%INSTALL_DIR%" (
        move /y "%EXTRACT%\Anvesment-main" "%INSTALL_DIR%" >nul
    ) else (
        REM المجلد موجود وكامل — نحدّث الملفات فقط
        xcopy /y /e /q "%EXTRACT%\Anvesment-main\*" "%INSTALL_DIR%\" >nul
    )
    del "%ZIP%" >nul 2>&1
    rmdir /s /q "%EXTRACT%" >nul 2>&1
    echo [ok] تم التحميل إلى:
    echo      %INSTALL_DIR%
)

cd /d "%INSTALL_DIR%"
if errorlevel 1 (
    echo [خطأ] ما قدرت أدخل مجلد المشروع.
    pause
    exit /b 1
)

REM ---------- 3) ملف الإعدادات .env ----------
if exist ".env" (
    echo [ok] ملف .env موجود
) else (
    if not exist ".env.example" (
        echo [خطأ] ملف .env.example مفقود — التحميل ناقص.
        pause
        exit /b 1
    )
    copy ".env.example" ".env" >nul
    echo.
    echo ----------------------------------------
    echo  [!] سيفتح ملف .env الآن في Notepad
    echo.
    echo      ضع توكن البوت في السطر:
    echo          BOT_TOKEN=التوكن_هنا
    echo.
    echo      التوكن تجيبه من @BotFather في تلغرام
    echo      ثم احفظ بـ CTRL+S وأغلق Notepad
    echo ----------------------------------------
    echo.
    notepad .env
)

REM ---------- 4) تثبيت الحزم ----------
if exist "node_modules" (
    echo [ok] الحزم مثبّتة مسبقاً
) else (
    echo [!] تثبيت الحزم ^(أول مرة، دقيقة أو اثنتين^)...
    call npm install --no-audit --no-fund --loglevel=error
    if errorlevel 1 (
        echo.
        echo [خطأ] فشل تثبيت الحزم.
        echo        جرّب: شغّل هذا الملف كمسؤول ^(يمين - Run as administrator^)
        pause
        exit /b 1
    )
    echo [ok] تم تثبيت الحزم
)

REM ---------- 5) تشغيل البوت ----------
echo.
echo ========================================
echo   البوت يعمل الآن — لا تغلق هذه النافذة
echo   للإيقاف: اضغط CTRL+C
echo ========================================
echo.
call npm start

echo.
echo [!] توقف البوت.
echo     لإعادة التشغيل: انقر مرتين على install-windows.bat
pause
