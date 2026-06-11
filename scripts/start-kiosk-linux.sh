#!/bin/bash
# Launches a fullscreen Chromium kiosk pointed at the local ticker server.
# Used by the bitcoin-ticker-kiosk.service systemd unit (see scripts/README-deploy.md).

set -e

URL="http://localhost:3000"

# Wait for the server to come up before launching the browser
for i in $(seq 1 30); do
  if curl -s -o /dev/null "$URL"; then
    break
  fi
  sleep 1
done

# Disable screen blanking / power management
xset s off
xset s noblank
xset -dpms

CHROME_BIN=$(command -v chromium-browser || command -v chromium || command -v google-chrome || echo /usr/lib/chromium/chromium)

exec "$CHROME_BIN" \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --no-first-run \
  --disable-translate \
  --disable-session-crashed-bubble \
  --autoplay-policy=no-user-gesture-required \
  --overscroll-history-navigation=0 \
  --check-for-update-interval=31536000 \
  "$URL"
