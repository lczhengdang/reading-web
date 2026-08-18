@echo off
chcp 65001 >nul
title 考研阅读 - 启动中

echo ============================================
echo   考研阅读 Web 版 - 一键启动（带 TTS 代理）
echo ============================================
echo.

echo [1/3] 清理占用 8080~8089 端口的旧服务器进程...
set FOUND=0
for /f "tokens=5" %%a in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":808"') do (
    taskkill /F /PID %%a >nul 2>&1 && set FOUND=1
)
if "%FOUND%"=="1" (
    echo       已清理旧进程，等待端口释放...
    timeout /t 2 /nobreak >nul
) else (
    echo       无旧进程占用
)

echo [2/3] 启动带 TTS 代理的服务器...
echo.
python tools\serve.py 8080

echo.
echo [3/3] 服务器已停止。
pause
