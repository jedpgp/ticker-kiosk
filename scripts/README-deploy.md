# Deploying the Bitcoin Ticker to Linux / Surface Pro

## What changed from the AI Studio version

- Removed the unused `@google/genai` dependency (it was never imported, just left over from the AI Studio template — and it was causing `npm install` to fail in some environments).
- Added `undici`'s `Agent({ connect: { family: 4 } })` as the global fetch dispatcher in `server.ts`. This forces **every** outgoing request (mempool.space, its mirrors, Coinbase) to use IPv4 only, on top of the existing `dns.setDefaultResultOrder("ipv4first")`. This is the fix for the IPv6 timeout issue.
- Cleaned up `.env.example` — no API keys are needed to run this.

## 1. Copy the project to the Surface Pro

From your computer (replace `user@surface-ip` with your SSH target):

```bash
scp -r bitcoin-ticker user@surface-ip:~/bitcoin-ticker
```

Or `git clone` it if you push this to a repo first.

## 2. Install Node.js (if not already installed)

**Linux:**
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Windows:** download the Node 20 LTS installer from nodejs.org.

## 3. Install dependencies and build

```bash
cd bitcoin-ticker
npm install
npm run build
```

This produces `dist/server.cjs` and the built frontend in `dist/`.

## 4. Test it manually first

```bash
NODE_ENV=production npm start
```

Open `http://<surface-ip>:3000` from another device (or `http://localhost:3000` on the Surface itself) and confirm the price/fees/blocks load. Check the terminal output — you should NOT see repeated "Failed to connect to https://mempool.space" warnings anymore.

## 5. Auto-start on boot

### Option A: Linux (recommended if the Surface runs Ubuntu/Debian + a desktop)

1. Move the project to `/opt/bitcoin-ticker` (replace `YOUR_USERNAME` in both service files with your actual Linux username):
   ```bash
   sudo mv ~/bitcoin-ticker /opt/bitcoin-ticker
   sudo chmod +x /opt/bitcoin-ticker/scripts/start-kiosk-linux.sh
   ```

2. Install the systemd services:
   ```bash
   sudo cp /opt/bitcoin-ticker/scripts/bitcoin-ticker.service /etc/systemd/system/
   sudo cp /opt/bitcoin-ticker/scripts/bitcoin-ticker-kiosk.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now bitcoin-ticker.service
   sudo systemctl enable --now bitcoin-ticker-kiosk.service
   ```

3. Make sure `chromium-browser` (or `chromium`) is installed:
   ```bash
   sudo apt-get install -y chromium-browser
   ```

4. Reboot to confirm it comes up automatically:
   ```bash
   sudo reboot
   ```

### Option B: Windows

1. Place the project at `C:\bitcoin-ticker` and run `npm install` + `npm run build` there.

2. Put `scripts\start-kiosk-windows.bat` in your Startup folder (so it runs at login):
   - Press `Win+R`, type `shell:startup`, hit Enter.
   - Copy `start-kiosk-windows.bat` into that folder.

3. Set Windows to auto-login (so it doesn't sit at the lock screen):
   - `netplwiz` → uncheck "Users must enter a password" → set the account.

4. Reboot to confirm.

## Troubleshooting

- If mempool data still doesn't load, SSH in and check `journalctl -u bitcoin-ticker -f` (Linux) for fetch errors.
- The server caches data and serves `recommendedFees`, `recentBlocks`, `candles`, and `priceUSD` from `/api/ticker-data` — if that endpoint times out, the issue is network/DNS on the Surface itself, not the app.
- To verify IPv4 is being used, run on the Surface: `curl -4 -v https://mempool.space/api/v1/fees/recommended` and `curl -6 -v https://mempool.space/api/v1/fees/recommended` — if `-6` hangs but `-4` works instantly, that confirms the IPv6 routing problem and the fix above addresses it.
