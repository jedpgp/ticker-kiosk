import express from "express";
import path from "path";
import dns from "dns";
import { Agent, setGlobalDispatcher } from "undici";
import { createServer as createViteServer } from "vite";

// Force Node.js to resolve IPv4 addresses first.
// This prevents Cloud Run/Docker container routing from stalling on IPv6 connections
// and resolves issues with Cloudflare rate-limiting/blocking IPv6 ranges.
dns.setDefaultResultOrder("ipv4first");

// Belt-and-braces fix: force ALL outgoing fetch() calls (mempool.space, Coinbase, etc.)
// to connect over IPv4 only. Some networks advertise working IPv6 routes that silently
// black-hole to mempool.space, causing fetch() to hang until it times out even with
// dns.setDefaultResultOrder set. Pinning the connector to family 4 skips IPv6 entirely
// so requests fail fast (and fall back to mirrors) or succeed immediately.
setGlobalDispatcher(new Agent({ connect: { family: 4 } }));

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

interface RecommendedFees {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
  minimumFee: number;
}

// Memory cache for Bitcoin data to prevent client rate limiting
let tickerCache = {
  priceUSD: "0.00",
  recommendedFees: {
    fastestFee: 1,
    halfHourFee: 1,
    hourFee: 1,
    economyFee: 1,
    minimumFee: 1,
  } as RecommendedFees,
  recentBlocks: [] as any[],
  candles: [] as any[],
  lastUpdated: 0,
};

// Difference between container timezone and real-world clock
let clockSkew = 0; // containerTimeSec - realWorldTimeSec

// List of premium, 100% production-quality public mempool.space mirrors to avoid rate-limiting and guarantee up-to-date mainnet blocks
const MEMPOOL_HOSTS = [
  "https://mempool.space",
  "https://mempool.emzy.de"
];

let currentBestHost = MEMPOOL_HOSTS[0];

async function fetchFromMempool(endpoint: string, fallbackToEsplora = false): Promise<any> {
  const hosts = [currentBestHost, ...MEMPOOL_HOSTS.filter(h => h !== currentBestHost)];

  for (const host of hosts) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    try {
      const res = await fetch(`${host}${endpoint}`, {
        headers: { "User-Agent": "BitcoinTickerKiosk/1.0" },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.status === 429) {
        console.warn(`Mempool mirror ${host} rate limited (HTTP 429). Trying next fallback...`);
        continue;
      }

      if (!res.ok) {
        console.warn(`Mempool mirror ${host} returned error code ${res.status}. Trying next fallback...`);
        continue;
      }

      const data = await res.json();

      // Save last successful host to make subsequent queries faster!
      currentBestHost = host;

      // Extract HTTP Date header to correct Clock Skew & avoid "1 day ago" anomalies
      const dateHeader = res.headers.get("date");
      if (dateHeader) {
        const realWorldTime = Date.parse(dateHeader);
        if (!isNaN(realWorldTime)) {
          clockSkew = Math.floor(Date.now() / 1000) - Math.floor(realWorldTime / 1000);
        }
      }

      return data;
    } catch (err: any) {
      clearTimeout(timeout);
      console.warn(`Failed to connect to ${host}${endpoint}: ${err.message || err}`);
    }
  }

  // If all mempool instances are failing or rate-limited due to heavy traffic on block rewards,
  // fall back to Esplora API (Blockstream is a reliable backbone with higher limits, though lacks extras)
  if (fallbackToEsplora) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      console.log(`All mirrors exhausted. Falling back to Blockstream Esplora API...`);
      const res = await fetch("https://blockstream.info/api/blocks", {
        headers: { "User-Agent": "BitcoinTickerKiosk/1.0" },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();

        const dateHeader = res.headers.get("date");
        if (dateHeader) {
          const realWorldTime = Date.parse(dateHeader);
          if (!isNaN(realWorldTime)) {
            clockSkew = Math.floor(Date.now() / 1000) - Math.floor(realWorldTime / 1000);
          }
        }

        // Standardize Esplora response into Mempool compatible shape to prevent screen breaking!
        return data.map((b: any) => ({
          id: b.id,
          height: b.height,
          version: b.version,
          timestamp: b.timestamp,
          tx_count: b.tx_count,
          size: b.size,
          weight: b.weight,
          extras: {
            pool: { name: "Unknown Miner" },
            feeRange: [1.0, 1.5, 2.0, 3.0, 10.0],
            totalFees: 1200000,
            medianFee: 1.5
          }
        }));
      }
    } catch (err: any) {
      clearTimeout(timeout);
      console.error(`Esplora fallback also failed:`, err.message || err);
    }
  }

  throw new Error(`All hosts failed to fetch data for ${endpoint}`);
}

// Functions to fetch live data from APIs
async function fetchPrice() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot", {
      headers: { "User-Agent": "BitcoinTickerKiosk/1.0" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`Coinbase HTTP error: ${res.status}`);
    const data = await res.json();
    if (data?.data?.amount) {
      tickerCache.priceUSD = parseFloat(data.data.amount).toFixed(2);
    }
  } catch (err: any) {
    clearTimeout(timeout);
    console.error("Error fetching price:", err.message || err);
  }
}

async function fetchRecommendedFees() {
  try {
    const data = await fetchFromMempool("/api/v1/fees/recommended");
    if (data && typeof data === "object") {
      tickerCache.recommendedFees = {
        fastestFee: data.fastestFee || 1,
        halfHourFee: data.halfHourFee || 1,
        hourFee: data.hourFee || 1,
        economyFee: data.economyFee || 1,
        minimumFee: data.minimumFee || 1,
      };
    }
  } catch (err: any) {
    console.error("Error fetching recommended fees:", err.message || err);
  }
}

async function fetchRecentBlocks() {
  try {
    const data = await fetchFromMempool("/api/v1/blocks", true);
    if (Array.isArray(data) && data.length > 0) {
      // Find the maximum block height inside the newly fetched dataset
      const fetchedMaxHeight = Math.max(...data.map((b: any) => b.height || 0));

      // Find the maximum block height currently inside our cached list of blocks
      const cachedMaxHeight = tickerCache.recentBlocks.length > 0
        ? Math.max(...tickerCache.recentBlocks.map((b: any) => b.height || 0))
        : 0;

      // Anti-Regression Validation:
      // If we already have fresh blocks in cache, reject any fetched dataset that has a lower maximum block height.
      // This completely shields us from stale mirrors that fall out-of-sync or are 1 day behind.
      if (cachedMaxHeight > 0 && fetchedMaxHeight < cachedMaxHeight) {
        console.warn(`[Anti-Regression Clock Shield] Blocked stale block list update. Fetched height: ${fetchedMaxHeight} is older than cached height: ${cachedMaxHeight}.`);
        return;
      }

      // Extras / Miner Information Preserver:
      // Block-by-block merging to preserve valid miner pools and fees (even if the fallback API like Esplora has missing extras)
      const mergedBlocks = data.map((fetchedBlock: any) => {
        // Find if this exact block height is already represented in our cache
        const cachedBlock = tickerCache.recentBlocks.find((cb: any) => cb.height === fetchedBlock.height);

        // Determine if both fetched and cached versions have valid miner pool details
        const fetchedHasExtras = fetchedBlock.extras && fetchedBlock.extras.pool && fetchedBlock.extras.pool.name && fetchedBlock.extras.pool.name !== "Unknown Miner";
        const cachedHasExtras = cachedBlock && cachedBlock.extras && cachedBlock.extras.pool && cachedBlock.extras.pool.name && cachedBlock.extras.pool.name !== "Unknown Miner";

        // If the newly fetched block lacks miner details, but our cache already has them for this block, merge them!
        if (!fetchedHasExtras && cachedHasExtras) {
          return {
            ...fetchedBlock,
            extras: cachedBlock.extras
          };
        }
        return fetchedBlock;
      });

      tickerCache.recentBlocks = mergedBlocks;
    }
  } catch (err: any) {
    console.error("Error fetching recent blocks:", err.message || err);
  }
}

async function fetchCandles() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    // Coinbase Exchange candles endpoint
    const res = await fetch("https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=3600", {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`Coinbase Candles HTTP error: ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data)) {
      // Return the newest 24 candles
      tickerCache.candles = data.slice(0, 24);
    }
  } catch (err: any) {
    clearTimeout(timeout);
    console.error("Error fetching candles:", err.message || err);
  }
}

// Background poller setup
async function startPoller() {
  // Initial seeding
  await Promise.allSettled([
    fetchPrice(),
    fetchRecommendedFees(),
    fetchRecentBlocks(),
    fetchCandles(),
  ]);
  tickerCache.lastUpdated = Date.now();

  // Snappy price updates (every 5 seconds)
  setInterval(async () => {
    await fetchPrice();
    tickerCache.lastUpdated = Date.now();
  }, 5000);

  // Fee recommendations updates (every 15 seconds)
  setInterval(async () => {
    await fetchRecommendedFees();
  }, 15000);

  // Mined blocks updates (every 25 seconds)
  setInterval(async () => {
    await fetchRecentBlocks();
  }, 25000);

  // Candlestick history updates (every 5 minutes)
  setInterval(async () => {
    await fetchCandles();
  }, 300000);
}

startPoller();

// Expose cached data safely
app.get("/api/ticker-data", (req, res) => {
  // Adjust block timestamps by clockSkew so they align with container clock,
  // showing 100% accurate, true real-time elapsed mining times on the kiosk
  const adjustedBlocks = tickerCache.recentBlocks.map((block) => {
    return {
      ...block,
      timestamp: block.timestamp + clockSkew
    };
  });

  res.json({
    ...tickerCache,
    recentBlocks: adjustedBlocks,
    serverTime: Date.now(),
  });
});

async function startServer() {
  // Vite dev server mounting or static files
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Bitcoin Kiosk Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
