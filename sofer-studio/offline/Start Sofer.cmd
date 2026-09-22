@echo off
cd /d "%~dp0"
"runtime\node.exe" "sofer-studio\offline\launch.mjs"
if errorlevel 1 pause
