# Bitcoin Ticker Kiosk

A fullscreen Bitcoin dashboard designed for always-on displays — Surface Pros, wall-mounted monitors, Raspberry Pis, or any device with a browser. Shows live BTC price, the 5 most recently mined blocks with miner/pool attribution, hourly candlestick chart, and transaction fee recommendations — all with zero API keys required.

---

## Features

- **Live BTC price** — updates every 5 seconds via Coinbase
- **Last 5 mined blocks** — height, miner pool name and icon, animated entrance
- **Fee priority panel** — No Priority / Low / Medium / High in sat/vB and USD
- **24-hour candlestick chart** — hourly candles from Coinbase Exchange
- **IPv6 safe** — forces IPv4 for all outbound requests; no more mempool.space timeouts
- **Anti-regression block guard** — rejects stale mirror responses that lag behind cache
- **Blockstream Esplora fallback** — kicks in when all mempool.space mirrors are rate-limited
- **Miner pool name preserver** — merges Esplora fallback data with cached pool names
- **Server-side caching** — one backend fetches on a schedule; all browser clients read from cache
- **Kiosk-ready** — systemd services + Chromium kiosk script for unattended boot-to-display

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript + Vite |
| Styling | Tailwind CSS v4 |
| Animations | Framer Motion (motion/react) |
| Icons | Lucide React |
| Backend | Express.js + Node.js |
| Price API | Coinbase REST API (public, no key) |
| Mempool API | mempool.space + emzy.de mirror |
| Fallback API | Blockstream Esplora |
| IPv4 forcing | undici `Agent({ connect: { family: 4 } })` |

---

## Quick Start (local development)

**Prerequisites:** Node.js 18+

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/bitcoin-ticker-kiosk.git
cd bitcoin-ticker-kiosk
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The server polls all APIs on a background schedule and serves cached data to the React frontend.

---

## Production Build

```bash
npm run build
NODE_ENV=production npm start
```

This bundles the frontend into `dist/` and compiles `server.ts` into `dist/server.cjs`.

---

## Kiosk Deployment (Linux / Surface Pro)

See [scripts/README-deploy.md](scripts/README-deploy.md) for the full step-by-step guide, including:

- Copying the project via `scp` or `git clone`
- Installing Node.js 20
- Installing and enabling the systemd auto-start services
- Launching Chromium in `--kiosk` fullscreen mode
- Windows deployment via Edge kiosk mode

**Quick reference — Linux:**

```bash
# 1. Clone and build on the target machine
git clone https://github.com/YOUR_GITHUB_USERNAME/bitcoin-ticker-kiosk.git ~/bitcoin-ticker
cd ~/bitcoin-ticker && npm install && npm run build

# 2. Edit service files — replace YOUR_USERNAME with your Linux username
sed -i "s/YOUR_USERNAME/$USER/g" scripts/bitcoin-ticker.service
sed -i "s/YOUR_USERNAME/$USER/g" scripts/bitcoin-ticker-kiosk.service

# 3. Install services
sudo cp scripts/bitcoin-ticker.service /etc/systemd/system/
sudo cp scripts/bitcoin-ticker-kiosk.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bitcoin-ticker.service
sudo systemctl enable --now bitcoin-ticker-kiosk.service
```

---

## Project Structure

```
bitcoin-ticker-kiosk/
├── src/
│   ├── App.tsx          # Main React component — all UI
│   ├── main.tsx         # React entry point
│   └── index.css        # Tailwind v4 + custom glow utilities
├── server.ts            # Express backend + background poller
├── scripts/
│   ├── bitcoin-ticker.service         # systemd: Node server
│   ├── bitcoin-ticker-kiosk.service   # systemd: Chromium kiosk
│   ├── bitcoin-ticker-kiosk.desktop   # GNOME autostart entry
│   ├── start-kiosk-linux.sh           # Chromium launch script
│   ├── start-kiosk-windows.bat        # Edge kiosk launch (Windows)
│   └── README-deploy.md               # Full deployment guide
├── index.html
├── vite.config.ts
├── tsconfig.json
└── .env.example         # PORT=3000 (only configurable value)
```

---

## API Endpoints

The Express server exposes one endpoint consumed by the React frontend:

```
GET /api/ticker-data
```

Response shape:

```json
{
  "priceUSD": "105432.00",
  "recommendedFees": {
    "fastestFee": 12,
    "halfHourFee": 8,
    "hourFee": 5,
    "economyFee": 3,
    "minimumFee": 1
  },
  "recentBlocks": [],
  "candles": [],
  "lastUpdated": 1718000000000,
  "serverTime": 1718000000000
}
```

---

## Configuration

Copy `.env.example` to `.env` and adjust:

```env
PORT=3000   # Port the server listens on (default: 3000)
```

No API keys are needed — all data sources are public.

---

## Troubleshooting

**mempool.space data not loading**

Run on the kiosk machine:
```bash
curl -4 -v https://mempool.space/api/v1/fees/recommended
curl -6 -v https://mempool.space/api/v1/fees/recommended
```
If `-6` hangs but `-4` works, IPv6 routing is broken on your network. The server already forces IPv4 via `undici`; confirm by checking the service logs:
```bash
journalctl -u bitcoin-ticker -f
```

**Chromium kiosk won't start**

Make sure `chromium-browser` or `chromium` is installed, then kill and relaunch:
```bash
sudo apt-get install -y chromium-browser
kill $(pgrep -o -f chromium)
DISPLAY=:0 chromium-browser --kiosk http://localhost:3000 &
```

**Force a UI refresh over SSH (no physical access needed)**
```bash
sudo systemctl restart bitcoin-ticker
kill $(pgrep -o -f chromium)
DISPLAY=:0 XAUTHORITY=/home/YOUR_USERNAME/.Xauthority \
  chromium-browser --kiosk --noerrdialogs --disable-infobars http://localhost:3000 \
  > /dev/null 2>&1 &
```

---

## License

MIT
