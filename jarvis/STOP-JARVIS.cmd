@echo off
cd /d "%~dp0"
echo Parando J.A.R.V.I.S. (somente processos iniciados por ele)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-jarvis.ps1"
rem Garantia: libera as portas do bridge e do frontend se ainda houver node escutando nelas
powershell -NoProfile -Command "foreach ($p in 8787,5173) { Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue | ForEach-Object { $proc = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $_.OwningProcess); if ($proc.Name -eq 'node.exe') { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } } }"
echo J.A.R.V.I.S. parado.
timeout /t 2 >nul
