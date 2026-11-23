@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "EXITCODE=0"

echo.
echo === FONTYPE - وضع التطوير ===
echo المجلد: %CD%
echo.

where npm >nul 2>nul
if errorlevel 1 (
  echo [خطأ] npm غير موجود في PATH. ثبّت Node.js 24 ثم أعد المحاولة.
  set "EXITCODE=1"
  goto :fail
)

where uv >nul 2>nul
if errorlevel 1 (
  echo [خطأ] uv غير موجود في PATH. ثبّت uv ثم أعد المحاولة.
  set "EXITCODE=1"
  goto :fail
)

if not exist "node_modules" (
  echo تثبيت تبعيات الواجهة...
  call npm ci
  if errorlevel 1 (
    set "EXITCODE=1"
    goto :fail
  )
)

if not exist "engine\.venv" (
  echo تثبيت بيئة محرك Python...
  call uv sync --project engine --all-extras
  if errorlevel 1 (
    set "EXITCODE=1"
    goto :fail
  )
)

echo إقلاع Tauri + Vite... اضغط Ctrl+C في هذه النافذة لإيقاف التطبيق.
echo.
call npm run tauri dev
set "EXITCODE=%ERRORLEVEL%"
if not "%EXITCODE%"=="0" goto :fail

echo.
echo انتهت جلسة التطوير.
endlocal
exit /b 0

:fail
echo.
echo [فشل] تعذّر إقلاع التطبيق. راجع الرسائل أعلاه (رمز الخروج: %EXITCODE%).
pause
endlocal
exit /b %EXITCODE%
