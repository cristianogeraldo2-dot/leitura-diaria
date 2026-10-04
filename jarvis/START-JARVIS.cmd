@echo off
setlocal
title J.A.R.V.I.S. - PERSONAL INTELLIGENCE SYSTEM
cd /d "%~dp0"

rem  Uso:  START-JARVIS.cmd            -> janela visivel (modo seguro)
rem         START-JARVIS.cmd hidden    -> sem janelas, interface fora da tela (wake word em segundo plano)
rem  Modo seguro = somente leitura + confirmacao por voz. Para liberar escrita: set JARVIS_WRITES=1 antes.

rem --- Chaves privadas (opcional, fora do git)
if exist "%~dp0jarvis-secrets.cmd" call "%~dp0jarvis-secrets.cmd"

rem --- Pre-requisitos
where node >nul 2>&1 || (echo [ERRO] Node.js nao encontrado. Instale o Node 20+ em https://nodejs.org & pause & exit /b 1)
for /f "tokens=1 delims=." %%v in ('node -v') do set "NODEMAJOR=%%v"
set "NODEMAJOR=%NODEMAJOR:v=%"
if %NODEMAJOR% LSS 20 (echo [ERRO] Node %NODEMAJOR% detectado; o JARVIS exige Node 20+. & pause & exit /b 1)
where claude >nul 2>&1 || (echo [ERRO] Claude Code nao encontrado. Instale: npm install -g @anthropic-ai/claude-code ^& depois rode "claude" uma vez para entrar na conta. & pause & exit /b 1)
if not exist "node_modules" (
  echo Instalando dependencias pela primeira vez...
  call npm ci || (echo [ERRO] npm ci falhou & pause & exit /b 1)
)
if not exist "logs" mkdir logs

rem --- Ja esta rodando?
powershell -NoProfile -Command "if (Get-NetTCPConnection -State Listen -LocalPort 8787 -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if %ERRORLEVEL%==0 (
  echo J.A.R.V.I.S. ja esta em execucao na porta 8787. Use STOP-JARVIS.cmd ou RESTART-JARVIS.cmd.
  timeout /t 4 >nul & exit /b 0
)

if /i "%~1"=="hidden" (
  wscript.exe "%~dp0start-jarvis.vbs"
  echo J.A.R.V.I.S. iniciado em segundo plano. Use show-jarvis.vbs para exibir a interface.
  timeout /t 3 >nul & exit /b 0
)

rem --- Navegador real (Chrome ou Edge): microfone nao funciona em paineis embutidos
set "BROWSER="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "BROWSER=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER set "BROWSER=explorer.exe"

set "WRITEFLAG="
if "%JARVIS_WRITES%"=="1" set "WRITEFLAG=-- --writes"

echo.
echo  J.A.R.V.I.S. - PERSONAL INTELLIGENCE SYSTEM
if "%JARVIS_WRITES%"=="1" (echo  MODO: escrita liberada ^(use com cuidado^)) else (echo  MODO: seguro - somente leitura, acoes exigem confirmacao por voz)
echo  A interface abre em instantes. Clique em INITIALISE e diga "Hey Jarvis".
echo  Feche esta janela ou pressione Ctrl+C para parar.
echo.

start "" /min cmd /c "timeout /t 8 /nobreak >nul & start "" "%BROWSER%" http://localhost:5173"
call npm start %WRITEFLAG%
pause
