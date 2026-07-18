@echo off
chcp 65001 >nul
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先到 https://nodejs.org 下载安装 (v14 或以上)
  echo 安装完成后重新运行本脚本即可。
  pause
  exit /b 1
)
node "%~dp0check-env.js"
if errorlevel 1 (
  echo.
  echo [环境检查未通过] 请先解决上述问题再启动代理。
  pause
  exit /b 1
)
node "%~dp0proxy.js"
pause
