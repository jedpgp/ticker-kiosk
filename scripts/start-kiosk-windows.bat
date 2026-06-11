@echo off
REM Starts the ticker server, waits for it to come up, then opens
REM Edge in fullscreen kiosk mode pointing at it.
REM Place this project in C:\bitcoin-ticker and run "npm run build" once first.

cd /d C:\bitcoin-ticker

REM Start the server in the background
start "BitcoinTickerServer" /min cmd /c "set NODE_ENV=production && node dist\server.cjs"

REM Wait for the server to respond
:waitloop
timeout /t 1 /nobreak >nul
curl -s -o nul http://localhost:3000
if errorlevel 1 goto waitloop

REM Launch Edge in kiosk mode
start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --kiosk http://localhost:3000 --edge-kiosk-type=fullscreen --no-first-run --noerrdialogs
