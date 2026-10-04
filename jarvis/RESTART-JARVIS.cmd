@echo off
cd /d "%~dp0"
call "%~dp0STOP-JARVIS.cmd"
timeout /t 2 >nul
call "%~dp0START-JARVIS.cmd" %*
