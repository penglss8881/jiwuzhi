@echo off
chcp 65001 >nul
pushd "%~dp0"
echo 请先确认 MySQL80 已启动。前端地址：http://localhost:5173
echo 按 Ctrl+C 停止服务。
call npm run dev:all
popd
pause
