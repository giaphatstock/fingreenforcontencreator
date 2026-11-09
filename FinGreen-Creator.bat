@echo off
title FinGreen For Content Creator
chcp 65001 >nul
cls

echo ========================================================
echo   FinGreen For Content Creator - AI Financial News Video
echo ========================================================
echo.
echo [1/2] Đang khởi động máy chủ FinGreen Studio Engine...

start /b npx tsx src/server/app-server.ts > nul 2>&1

echo [2/2] Đang mở ứng dụng Desktop FinGreen...
timeout /t 2 /nobreak > nul

REM Check if Chrome is available
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" --app=http://localhost:3721 --window-size=1440,900
    goto done
)
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" --app=http://localhost:3721 --window-size=1440,900
    goto done
)
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
    start "" "%LocalAppData%\Google\Chrome\Application\chrome.exe" --app=http://localhost:3721 --window-size=1440,900
    goto done
)

REM Fallback to Microsoft Edge App mode
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
    start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" --app=http://localhost:3721 --window-size=1440,900
    goto done
)
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
    start "" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" --app=http://localhost:3721 --window-size=1440,900
    goto done
)

REM Default browser fallback
start http://localhost:3721

:done
echo.
echo ========================================================
echo   Ứng dụng FinGreen đang chạy tại: http://localhost:3721
echo   (Đóng cửa sổ này khi bạn muốn tắt server)
echo ========================================================
echo.
pause

