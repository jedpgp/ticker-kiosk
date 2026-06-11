import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Flame, 
  Cpu, 
  Layers, 
  Clock, 
  Activity, 
  Maximize2, 
  Minimize2, 
  TrendingUp, 
  DollarSign, 
  RefreshCw,
  AlertTriangle
} from "lucide-react";

interface RecommendedFees {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
  minimumFee: number;
}

interface TickerData {
  priceUSD: string;
  recommendedFees: RecommendedFees;
  recentBlocks: any[];
  candles: any[];
  lastUpdated: number;
  serverTime: number;
}

export default function App() {
  const [data, setData] = useState<TickerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const [localTimezone, setLocalTimezone] = useState<string>("UTC");
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Poll server cached ticker data, falling back to direct browser calls if Node server is loading/offline
  const fetchData = async (silent = false) => {
    if (!silent) setIsRefreshing(true);
    try {
      const res = await fetch("/api/ticker-data");
      if (!res.ok) throw new Error("Could not fetch ticker details from server.");
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err: any) {
      console.warn("Express endpoint '/api/ticker-data' unavailable. Attempting direct browser fallback:", err);
      try {
        // Direct browser-level API requests with fallbacks
        const [priceRes, feesRes, blocksRes, candlesRes] = await Promise.allSettled([
          fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot"),
          fetch("https://mempool.space/api/v1/fees/recommended"),
          fetch("https://mempool.space/api/v1/blocks"),
          fetch("https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=3600")
        ]);

        let fallbackData: Partial<TickerData> = {
          priceUSD: data?.priceUSD || "0.00",
          recommendedFees: data?.recommendedFees || {
            fastestFee: 1,
            halfHourFee: 1,
            hourFee: 1,
            economyFee: 1,
            minimumFee: 1,
          },
          recentBlocks: data?.recentBlocks || [],
          candles: data?.candles || [],
          lastUpdated: Date.now(),
          serverTime: Date.now(),
        };

        let loadedSomething = false;

        if (priceRes.status === "fulfilled" && priceRes.value.ok) {
          const pJ = await priceRes.value.json();
          if (pJ?.data?.amount) {
            fallbackData.priceUSD = parseFloat(pJ.data.amount).toFixed(2);
            loadedSomething = true;
          }
        }

        if (feesRes.status === "fulfilled" && feesRes.value.ok) {
          const fJ = await feesRes.value.json();
          if (fJ && typeof fJ === "object") {
            fallbackData.recommendedFees = {
              fastestFee: fJ.fastestFee || 1,
              halfHourFee: fJ.halfHourFee || 1,
              hourFee: fJ.hourFee || 1,
              economyFee: fJ.economyFee || 1,
              minimumFee: fJ.minimumFee || 1,
            };
            loadedSomething = true;
          }
        }

        if (blocksRes.status === "fulfilled" && blocksRes.value.ok) {
          const bJ = await blocksRes.value.json();
          if (Array.isArray(bJ)) {
            fallbackData.recentBlocks = bJ.slice(0, 5);
            loadedSomething = true;
          }
        }

        if (candlesRes.status === "fulfilled" && candlesRes.value.ok) {
          const cJ = await candlesRes.value.json();
          if (Array.isArray(cJ)) {
            fallbackData.candles = cJ.slice(0, 24);
            loadedSomething = true;
          }
        }

        if (loadedSomething && fallbackData.priceUSD !== "0.00") {
          setData(fallbackData as TickerData);
          setError(null);
        } else {
          throw new Error("Local cache and public fallbacks are currently loading.");
        }
      } catch (fallbackErr: any) {
        console.error("Direct browser metrics fallback also failed:", fallbackErr.message || fallbackErr);
        setError("Waiting for server cached data or internet connection...");
      }
    } finally {
      if (!silent) setIsRefreshing(false);
    }
  };

  useEffect(() => {
    // Initial fetch
    fetchData();

    // Snappy client poll every 3 seconds
    const interval = setInterval(() => {
      fetchData(true);
    }, 3000);

    // Dynamic real-time clock updating every second
    const clockInterval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    // Detect timezone
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      // Convert typical long naming into standard abbreviations or extract last part
      if (tz) {
        const parts = tz.split("/");
        setLocalTimezone(parts[parts.length - 1].replace("_", " "));
      }
    } catch {
      setLocalTimezone("Local");
    }

    // Monitor fullscreen state
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      clearInterval(interval);
      clearInterval(clockInterval);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.error("Error enabling fullscreen:", err);
      });
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // Check if block has OCEAN miner info in pool name or coinbase tag list
  const isOceanMined = (block: any) => {
    const poolName = block.extras?.pool?.name || "";
    const coinbaseAscii = block.extras?.coinbaseSignatureAscii || "";
    return (
      poolName.toUpperCase().includes("OCEAN") ||
      coinbaseAscii.toUpperCase().includes("OCEAN.XYZ")
    );
  };

  // Get median fee in sat/vB using block.extras medianFee or estimating it
  const getMedianFee = (block: any) => {
    if (block.extras?.medianFee !== undefined) {
      return Math.round(block.extras.medianFee);
    }
    if (block.extras?.feeRange && block.extras.feeRange.length > 0) {
      const midIdx = Math.floor(block.extras.feeRange.length / 2);
      return Math.round(block.extras.feeRange[midIdx]);
    }
    return 1;
  };

  // Convert total fees inside block (in satoshis) into M sats format
  const formatFeesSats = (block: any) => {
    const totalFees = block.extras?.totalFees;
    if (totalFees === undefined) {
      // Fallback: estimate from tx_count if missing or return a typical value
      return "1.5M sats";
    }
    const millions = totalFees / 1_000_000;
    // Format to 1 decimal place and strip .0 to output "2M sats" instead of "2.0M sats"
    const formatted = millions.toFixed(1).replace(/\.0$/, "");
    return `${formatted}M sats`;
  };

  // Render pool icons matching the screenshot layout exactly
  const renderPoolIcon = (poolName: string) => {
    const n = (poolName || "Unknown").toUpperCase();
    
    // 1. F2Pool: Circular blue badge with white stylized dual circles
    if (n.includes("F2POOL")) {
      return (
        <svg className="w-12 h-12 mr-2 select-none flex-shrink-0" viewBox="0 0 28 28" fill="none">
          <circle cx="14" cy="14" r="13" fill="#1e40af" stroke="#3b82f6" strokeWidth="1.5" />
          <circle cx="11" cy="14" r="3.5" fill="white" />
          <circle cx="18" cy="14" r="2" fill="white" />
          <circle cx="18" cy="10" r="1" fill="white" opacity="0.6" />
        </svg>
      );
    }

    // 2. SECPOOL: Violet circle with stylized 'S' symbol
    if (n.includes("SECPOOL") || n.includes("SEC ")) {
      return (
        <svg className="w-12 h-12 mr-2 select-none flex-shrink-0" viewBox="0 0 28 28" fill="none">
          <circle cx="14" cy="14" r="13" fill="#581c87" stroke="#8b5cf6" strokeWidth="1.5" />
          <path d="M10 18c0-2 2-3.5 4-3.5s4 1.5 4 3.5M14 6l5 1.8v4.5c0 3-2.1 5.7-5 6.3-2.9-.6-5-3.3-5-6.3V7.8L14 6Z" fill="white" opacity="0.9" />
        </svg>
      );
    }

    // 3. AntPool: Green arrowhead/triangle pointing up
    if (n.includes("ANTPOOL") || n.includes("ANT_POOL")) {
      return (
        <svg className="w-12 h-12 mr-2 select-none flex-shrink-0" viewBox="0 0 28 28" fill="none">
          <path d="M14 3l10 18H4L14 3Z" fill="#10b981" />
          <path d="M14 8l6.5 11.5H7.5L14 8Z" fill="white" opacity="0.25" />
        </svg>
      );
    }

    // 4. MARA Pool: Dark grey/black square with gold letter M
    if (n.includes("MARA")) {
      return (
        <svg className="w-12 h-12 mr-2 select-none flex-shrink-0 rounded bg-[#111] border border-amber-500/60 p-0.5" viewBox="0 0 24 24" fill="none">
          <path d="M4 18V6l8 6.5L20 6v12h-3V9l-5 4-5-4v9H4Z" fill="#f59e0b" />
        </svg>
      );
    }

    // 5. Foundry USA: Orange circle with stylized letter F inside
    if (n.includes("FOUNDRY")) {
      return (
        <svg className="w-12 h-12 mr-2 select-none flex-shrink-0" viewBox="0 0 28 28" fill="none">
          <circle cx="14" cy="14" r="13" fill="#ea580c" stroke="#f97316" strokeWidth="1.5" />
          <path d="M9 7h10v2.5H12.5V12h6v2.5h-6V21H9.5V7Z" fill="white" />
        </svg>
      );
    }

    // 6. ViaBTC: Cyan/Teal circle with central white star/polygon
    if (n.includes("VIABTC")) {
      return (
        <svg className="w-12 h-12 mr-2 select-none flex-shrink-0" viewBox="0 0 28 28" fill="none">
          <circle cx="14" cy="14" r="13" fill="#0891b2" stroke="#06b6d4" strokeWidth="1.5" />
          <path d="M9 14l5-5 5 5-5 5-5-5Z" fill="white" />
          <circle cx="14" cy="14" r="2.5" fill="#0891b2" />
        </svg>
      );
    }

    // 7. Ocean: Golden-amber circle with three ocean waves Inside
    if (n.includes("OCEAN")) {
      return (
        <svg className="w-12 h-12 mr-2 select-none flex-shrink-0 animate-pulse" viewBox="0 0 28 28" fill="none">
          <circle cx="14" cy="14" r="13" fill="#b45309" stroke="#f59e0b" strokeWidth="1.5" />
          <path d="M6 10c1.5 0 2-1 3.5-1s2 1 3.5 1 2-1 3.5-1 2 1 3.5 1M6 14c1.5 0 2-1 3.5-1s2 1 3.5 1 2-1 3.5-1 2 1 3.5 1M6 18c1.5 0 2-1 3.5-1s2 1 3.5 1 2-1 3.5-1 2 1 3.5 1" stroke="white" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    }

    // Default fallback miner logo: Slate/Gray circle containing a standard white hammer icon
    return (
      <svg className="w-12 h-12 mr-2 select-none flex-shrink-0" viewBox="0 0 28 28" fill="none">
        <circle cx="14" cy="14" r="13" fill="#4b5563" stroke="#6b7280" strokeWidth="1.5" />
        <rect x="9" y="11" width="10" height="6" rx="1" fill="white" opacity="0.8" />
        <rect x="13" y="17" width="2" height="4" rx="0.5" fill="white" opacity="0.8" />
      </svg>
    );
  };

  // Convert block timestamp to elapsed readable tag
  const formatBlockTime = (timestamp: number, serverTimeMs: number) => {
    const nowSec = serverTimeMs ? Math.floor(serverTimeMs / 1000) : Math.floor(Date.now() / 1000);
    const delta = Math.max(0, nowSec - timestamp);
    if (delta < 60) return `${delta} seconds ago`;
    if (delta < 3600) {
      const mins = Math.floor(delta / 60);
      return `${mins} ${mins === 1 ? "minute" : "minutes"} ago`;
    }
    if (delta < 86400) {
      const hrs = Math.floor(delta / 3600);
      return `${hrs} ${hrs === 1 ? "hour" : "hours"} ago`;
    }
    const days = Math.floor(delta / 86400);
    return `${days} ${days === 1 ? "day" : "days"} ago`;
  };

  // Calculate local time display
  const padZero = (n: number) => n.toString().padStart(2, "0");
  const formatTimeStr = (date: Date) => {
    const mm = padZero(date.getMonth() + 1);
    const dd = padZero(date.getDate());
    const yyyy = date.getFullYear();
    const hh = padZero(date.getHours());
    const min = padZero(date.getMinutes());
    const sec = padZero(date.getSeconds());
    return `${mm}/${dd}/${yyyy} ${hh}:${min}:${sec} ${localTimezone}`;
  };

  // Extract variables safely
  const priceUSD = data ? parseFloat(data.priceUSD) : 0;
  const recommendedFees = data?.recommendedFees;
  const recentBlocks = data?.recentBlocks?.slice(0, 5) || [];
  const rawCandles = data?.candles || [];

  // Recommended fee items helper
  const feeOptions = recommendedFees ? [
    { label: "No Priority", key: "minimumFee", color: "bg-[#10b981]", val: recommendedFees.minimumFee },
    { label: "Low Priority", key: "economyFee", color: "bg-[#22c55e]", val: recommendedFees.economyFee },
    { label: "Medium Priority", key: "hourFee", color: "bg-[#f59e0b]", val: recommendedFees.halfHourFee },
    { label: "High Priority", key: "fastestFee", color: "bg-[#ef4444]", val: recommendedFees.fastestFee }
  ] : [];

  // Draw chart metrics
  const sortedCandles = [...rawCandles].reverse(); // reverse to chronological order left-to-right
  const candleCount = sortedCandles.length;

  let minPrice = 0;
  let maxPrice = 0;
  let chartLines: { y: number; price: number }[] = [];

  if (candleCount > 0) {
    // Indexes: 0 = time, 1 = low, 2 = high, 3 = open, 4 = close
    const lows = sortedCandles.map(c => c[1]);
    const highs = sortedCandles.map(c => c[2]);
    minPrice = Math.min(...lows);
    maxPrice = Math.max(...highs);
  }

  const priceRange = maxPrice - minPrice || 1;
  // Pad the chart range slightly by 10% on top/bottom
  const chartMin = minPrice - priceRange * 0.1;
  const chartMax = maxPrice + priceRange * 0.1;
  const chartRange = chartMax - chartMin;

  // Coordinate mapping (SVG height=220px, drawable area = 15px to 185px)
  const getCandleY = (price: number) => {
    return 15 + (1.0 - (price - chartMin) / chartRange) * 170;
  };

  // Generate ticks for bottom time axis
  const getTickLabel = (time: number) => {
    const d = new Date(time * 1000);
    const h = d.getHours();
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}${ampm}`;
  };

  return (
    <div className="h-screen bg-black text-slate-100 flex flex-col justify-between overflow-hidden relative font-sans selection:bg-[#ff3c00] selection:text-white pb-3">
      {/* Dark mesh background design */}
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(to_right,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />

      {/* Header bar */}
      <header className="w-full px-6 py-3 flex justify-between items-center z-10 relative flex-shrink-0">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-[#ff4500] animate-pulse" />
          <span className="text-[#ff4500] font-black tracking-[0.2em] text-xs uppercase">Always-On Billboard</span>
        </div>
        <button
          onClick={toggleFullscreen}
          className="flex items-center gap-2 border border-neutral-700 rounded px-3 py-1.5 text-slate-300 hover:text-white hover:border-neutral-500 transition-colors text-xs font-bold tracking-wider uppercase"
        >
          {isFullscreen ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
          {isFullscreen ? "Exit" : "Fullscreen"}
        </button>
      </header>

      {/* Main Dashboard Screen Area */}
      <main className="flex-1 min-h-0 w-full max-w-[2000px] mx-auto px-6 flex flex-col gap-2 mt-1 relative z-10">
        
        {/* Error Notification banner */}
        {error && (
          <div className="w-full py-2.5 px-4 bg-orange-950/40 border border-orange-500/30 rounded flex items-center gap-2 text-orange-400 text-sm animate-pulse">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* 1. Mined Blocks Row */}
        {!data && !error ? (
          /* Sleek custom glowing skeleton loader adjusted for new block spacing */
          <div className="flex flex-row overflow-x-auto md:grid md:grid-cols-5 gap-4 md:gap-3 lg:gap-6 justify-start md:justify-items-center pb-4 md:pb-0 scrollbar-none snap-x">
            {[1, 2, 3, 4, 5].map((idx) => (
              <div key={idx} className="flex flex-col items-center animate-pulse snap-center flex-shrink-0">
                <div className="h-7 w-28 bg-neutral-900/80 rounded mb-4" />
                <div className="bg-neutral-900/60 rounded-md border border-neutral-800/50" style={{ width: "180px", height: "215px" }} />
              </div>
            ))}
          </div>
        ) : (
          <div id="mined-blocks-row" className="flex flex-row overflow-x-auto md:grid md:grid-cols-5 gap-4 md:gap-3 lg:gap-6 justify-start md:justify-items-center pb-4 md:pb-0 scrollbar-none snap-x">
            <AnimatePresence mode="popLayout">
              {recentBlocks.map((block: any, index: number) => {
                const isOcean = isOceanMined(block);
                
                // Extract fee ranges carefully matching mempool.space decimal rules
                const firstFeeVal = block.extras?.feeRange?.[0];
                const lastFeeVal = block.extras?.feeRange?.[block.extras.feeRange?.length - 1];
                
                const minFee = firstFeeVal !== undefined 
                  ? parseFloat(firstFeeVal).toFixed(2) 
                  : "1.00";
                
                const maxFee = lastFeeVal !== undefined
                  ? (parseFloat(lastFeeVal) % 1 === 0 
                     ? parseFloat(lastFeeVal).toFixed(0) 
                     : parseFloat(lastFeeVal).toFixed(1))
                  : "70";
 
                return (
                  <motion.div 
                    key={block.id || block.height}
                    initial={{ opacity: 0, y: -15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.08, duration: 0.4 }}
                    className="flex flex-col items-center snap-center flex-shrink-0 w-full"
                  >
                    {/* Block Height Title */}
                    <div className={`font-sans text-[20px] font-semibold mb-1 tracking-tight transition-colors duration-300 ${isOcean ? "text-amber-400 text-glow-gold" : "text-[#00ffd0] text-glow"}`}>
                      {block.height}
                    </div>

                    {/* 3D Isometric Block Container */}
                    <div
                      className={`relative flex justify-center items-center group transition-transform duration-300 w-full ${isOcean ? "scale-105" : "hover:scale-[1.03]"}`}
                      style={{ height: "20vh" }}
                    >
                      
                      {/* Precise mempool.space oblique 3D SVG block (depth is on top & left, front face on right) */}
                      <svg 
                        className={`absolute inset-0 w-full h-full pointer-events-none transition-all duration-300 ${
                          isOcean ? "drop-shadow-[0_0_25px_rgba(245,158,11,0.65)]" : "drop-shadow-[0_8px_20px_rgba(37,99,235,0.25)]"
                        }`} 
                        viewBox="0 0 180 160"
                        fill="none"
                      >
                        <defs>
                          {/* Rich vivid horizontal/diagonal gradients for the front face */}
                          <linearGradient id="front-grad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#a855f7" />
                            <stop offset="100%" stopColor="#2563eb" />
                          </linearGradient>
 
                          <linearGradient id="gold-front" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#fbbf24" />
                            <stop offset="100%" stopColor="#b45309" />
                          </linearGradient>
                        </defs>
 
                        {/* Top Facet (Slanted Isometric Lid) - Deep charcoal/slate, matches mempool */}
                        <polygon 
                          points="0,0 160,0 180,20 20,20" 
                          fill={isOcean ? "#451a03" : "#222533"} 
                        />
                        
                        {/* Left Facet (Slanted Isometric Side Column) - Slightly darker shaded charcoal/slate */}
                        <polygon 
                          points="0,140 20,160 20,20 0,0"
                          fill={isOcean ? "#270e00" : "#141622"} 
                        />
                        
                        {/* Front Facet - Main vibrant glowing face */}
                        <polygon 
                          points="20,20 180,20 180,160 20,160"
                          fill={isOcean ? "url(#gold-front)" : "url(#front-grad)"} 
                        />
                      </svg>
 
                      {/* Text Content Overlay on Front Face - Perfectly aligned on front 160x195px rectangle */}
                      <div 
                        className="absolute flex flex-col justify-center gap-1 py-3 px-2 text-center select-none z-10 font-sans text-white"
                        style={{
                          left: "11.11%",
                          top: "12.5%",
                          width: "88.89%",
                          height: "87.5%"
                        }}
                      >
                        {/* 1. Top Line: Median sat/vB rate */}
                        <div className="text-sm sm:text-base font-semibold tracking-wide text-white">
                          ~{getMedianFee(block)} sat/vB
                        </div>

                        {/* 2. Second Line: Range of sat/vB (amber color matching screenshot) */}
                        <div className="text-xs sm:text-sm font-bold text-[#fbbf24] font-mono tracking-tight -mt-0.5">
                          {minFee} - {maxFee} sat/vB
                        </div>

                        {/* 3. Middle Line: Total block fees in M sats (large prominent text with text shadow) */}
                        <div
                          className="text-2xl sm:text-3xl font-black tracking-tight"
                          style={{
                            textShadow: isOcean
                              ? "0 2px 10px rgba(245,158,11,0.85)"
                              : "0 2px 10px rgba(168,85,247,0.85)"
                          }}
                        >
                          {formatFeesSats(block)}
                        </div>

                        {/* 4. Fourth Line: Total transactions count (full word typed out) */}
                        <div className="text-sm sm:text-base font-bold text-white/95">
                          {block.tx_count.toLocaleString()} transactions
                        </div>

                        {/* 5. Bottom Line: Exact elapsed mining duration (e.g. "9 minutes ago") */}
                        <div className={`text-sm sm:text-base font-extrabold tracking-normal ${isOcean ? "text-amber-100" : "text-cyan-100"}`}>
                          {formatBlockTime(block.timestamp, data?.serverTime || Date.now())}
                        </div>
                      </div>
                    </div>

                    {/* Pool icon + miner name — below the 3D block */}
                    <div className="mt-2 flex items-center justify-center gap-2 w-full">
                      {renderPoolIcon(block.extras?.pool?.name)}
                      <span className={`truncate capitalize text-3xl font-black tracking-tight ${isOcean ? "text-amber-400 text-glow-gold" : "text-white"}`}>
                        {block.extras?.pool?.name || "Unknown"}
                      </span>
                    </div>

                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )/* End Mined Blocks Row */}

        {/* 2. Monumental Price Ticker */}
        <div className="flex-1 flex flex-col items-center justify-center select-none">

          {/* Monumental Price display with supreme glowing effect */}
          <div className="relative text-center flex flex-col items-center">
            {priceUSD ? (
              <motion.div
                key={priceUSD}
                initial={{ scale: 0.98, opacity: 0.9 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.15 }}
                className="text-[24vh] font-black text-[#ff4500] tracking-tighter leading-none text-glow font-display"
              >
                ${priceUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </motion.div>
            ) : (
              <div className="h-36 w-[450px] bg-neutral-900/40 rounded-full animate-pulse flex items-center justify-center border border-neutral-800">
                <span className="font-mono text-slate-600 text-base tracking-[0.25em] animate-pulse">CONNECTING PRICE FEED...</span>
              </div>
            )}

            <div className="text-[#ff4500] font-mono font-black text-sm sm:text-base md:text-lg tracking-[0.45em] mt-2">
              BITCOIN SPOT PRICE
            </div>
          </div>

        </div>

        {/* 3. Candlestick Chart Stage */}
        <div className="w-full h-[22vh] flex-shrink-0 bg-neutral-950/40 border border-neutral-900/60 rounded-xl p-3 md:p-4 flex flex-col gap-2 relative">
          
          {/* Chart header metrics */}
          <div className="flex justify-between items-center text-xs text-slate-400 select-none px-1">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-emerald-500" />
              <span className="font-mono font-semibold tracking-wide">24H MARKET DEPTH (COINBASE API)</span>
            </div>
            {priceRange > 0 && (
              <div className="font-mono text-slate-500 text-[11px] flex gap-4">
                <span>HIGH: <span className="text-slate-300 font-bold">${Math.round(maxPrice).toLocaleString()}</span></span>
                <span>LOW: <span className="text-slate-300 font-bold">${Math.round(minPrice).toLocaleString()}</span></span>
              </div>
            )}
          </div>

          {!data && !error ? (
            /* Loading placeholder for chart */
            <div className="w-full h-full bg-neutral-900/20 border border-neutral-900 rounded flex items-center justify-center">
              <div className="flex flex-col items-center gap-2">
                <RefreshCw className="w-5 h-5 text-slate-600 animate-spin" />
                <span className="font-mono text-xs text-slate-600 tracking-wider">RETRIEVING DEPTH HISTORY...</span>
              </div>
            </div>
          ) : candleCount === 0 ? (
            <div className="w-full h-full bg-neutral-900/20 border border-neutral-900 rounded flex items-center justify-center">
              <span className="font-mono text-xs text-slate-600">Chart data temporarily unavailable.</span>
            </div>
          ) : (
            /* Premium Responsive SVG Candlestick Engine */
            <div className="w-full flex-1 min-h-0">
              <svg 
                className="w-full h-full" 
                viewBox="0 0 1300 230"
                preserveAspectRatio="none"
              >
                {/* Horizontal dotted grid lines */}
                {/* Max High line */}
                <line 
                  x1="50" 
                  y1={getCandleY(maxPrice)} 
                  x2="1130" 
                  y2={getCandleY(maxPrice)} 
                  stroke="rgba(255,255,255,0.06)" 
                  strokeDasharray="4"
                  strokeWidth="1"
                />
                {/* Mid price line */}
                <line 
                  x1="50" 
                  y1={getCandleY(minPrice + priceRange/2)} 
                  x2="1130" 
                  y2={getCandleY(minPrice + priceRange/2)} 
                  stroke="rgba(255,255,255,0.06)" 
                  strokeDasharray="4"
                  strokeWidth="1"
                />
                {/* Min Low line */}
                <line 
                  x1="50" 
                  y1={getCandleY(minPrice)} 
                  x2="1130" 
                  y2={getCandleY(minPrice)} 
                  stroke="rgba(255,255,255,0.06)" 
                  strokeDasharray="4"
                  strokeWidth="1"
                />

                {/* Draw Candles */}
                {sortedCandles.map((c, i) => {
                  const [time, low, high, open, close] = c;
                  const isGreen = close >= open;
                  
                  // Total slots starting at X=50, ending at X=1135
                  // Space slots evenly across 1085px width
                  const stepX = 1085 / candleCount;
                  const xCenter = 50 + i * stepX + (stepX / 2);
                  
                  const yHigh = getCandleY(high);
                  const yLow = getCandleY(low);
                  const yOpen = getCandleY(open);
                  const yClose = getCandleY(close);

                  const bodyTop = Math.min(yOpen, yClose);
                  const bodyBottom = Math.max(yOpen, yClose);
                  // Ensure minimum 2px height so non-volatile candles are visible
                  const bodyHeight = Math.max(2.5, bodyBottom - bodyTop);
                  const bodyWidth = Math.min(18, stepX * 0.55);

                  const rectX = xCenter - bodyWidth / 2;
                  const strokeColor = isGreen ? "#10b981" : "#f43f5e";
                  const fillColor = isGreen ? "#10b981" : "#f43f5e";

                  return (
                    <g key={time} className="transition-opacity duration-300 hover:opacity-80">
                      {/* Wick Line */}
                      <line 
                        x1={xCenter} 
                        y1={yHigh} 
                        x2={xCenter} 
                        y2={yLow} 
                        stroke={strokeColor} 
                        strokeWidth="1.5"
                      />
                      
                      {/* Candle Body Rect */}
                      <rect 
                        x={rectX} 
                        y={bodyTop} 
                        width={bodyWidth} 
                        height={bodyHeight} 
                        fill={fillColor} 
                        rx="1"
                      />
                    </g>
                  );
                })}

                {/* Y-Axis Labels at the Right */}
                <text 
                  x="1295" 
                  y={getCandleY(maxPrice) + 4} 
                  fill="#94a3b8"
                  fontSize="17"
                  fontFamily="var(--font-mono)"
                  fontWeight="bold"
                  textAnchor="end"
                >
                  ${Math.round(maxPrice).toLocaleString()}
                </text>
                <text 
                  x="1295" 
                  y={getCandleY(minPrice + priceRange/2) + 4} 
                  fill="#94a3b8"
                  fontSize="17"
                  fontFamily="var(--font-mono)"
                  fontWeight="bold"
                  textAnchor="end"
                >
                  ${Math.round(minPrice + priceRange/2).toLocaleString()}
                </text>
                <text 
                  x="1295" 
                  y={getCandleY(minPrice) + 4} 
                  fill="#94a3b8"
                  fontSize="17"
                  fontFamily="var(--font-mono)"
                  fontWeight="bold"
                  textAnchor="end"
                >
                  ${Math.round(minPrice).toLocaleString()}
                </text>

                {/* Hour ticks at the bottom axis timeline (every 4 slots starting at i=0) */}
                {sortedCandles.map((c, i) => {
                  const [time] = c;
                  const stepX = 1085 / candleCount;
                  const xCenter = 50 + i * stepX + (stepX / 2);

                  // Print hour markings: index 0, 4, 8, 12, 16, 20, 23 (approx boundaries)
                  if (i % 8 === 0 || i === candleCount - 1) {
                    return (
                      <g key={`lbl-${time}`}>
                        {/* Dot on the timeline */}
                        <circle 
                          cx={xCenter} 
                          cy="200" 
                          r="2" 
                          fill="rgba(255,255,255,0.15)"
                        />
                        <text 
                          x={xCenter} 
                          y="222" 
                          fill="#94a3b8"
                          fontSize="17"
                          fontFamily="var(--font-mono)"
                          fontWeight="bold"
                          textAnchor="middle"
                        >
                          {getTickLabel(time)}
                        </text>
                      </g>
                    );
                  }
                  return null;
                })}
              </svg>
            </div>
          )}
        </div>

      </main>

      {/* Fee Priority Cards — fixed at bottom above footer, never overlaps blocks */}
      {recommendedFees && (
        <div className="w-full px-4 pb-2 flex-shrink-0 select-none">
          <div className="bg-neutral-950 border border-neutral-800 rounded-2xl p-3">
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: "NO PRIORITY",     val: recommendedFees.minimumFee,  bg: "bg-emerald-500" },
                { label: "LOW PRIORITY",    val: recommendedFees.economyFee,  bg: "bg-green-500"   },
                { label: "MEDIUM PRIORITY", val: recommendedFees.halfHourFee, bg: "bg-amber-400"   },
                { label: "HIGH PRIORITY",   val: recommendedFees.fastestFee,  bg: "bg-red-500"     },
              ].map(f => {
                const feeUSD = priceUSD ? ((f.val * 140 * priceUSD) / 100_000_000).toFixed(2) : "0.00";
                return (
                  <div key={f.label} className="flex flex-col items-center gap-1.5">
                    <div className={`w-full py-2 px-3 ${f.bg} rounded-xl text-center`}>
                      <span className="text-white font-black text-base tracking-wide uppercase">{f.label}</span>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-white font-black text-4xl">{f.val}</span>
                      <span className="text-slate-400 font-bold text-lg">sat/vB</span>
                    </div>
                    <div className="text-[#22ff88] font-bold text-xl">${feeUSD}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Footer bar — mainnet status | clock + kiosk label */}
      <footer className="w-full px-4 py-2 flex items-center justify-between text-[10px] font-mono text-slate-500 z-10 select-none border-t border-neutral-900 bg-black/60 relative">

        {/* Left: pulsing status + clock */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-slate-400 uppercase tracking-wider font-bold">MAINNET: COINBASE & MEMPOOL APIS</span>
          </div>
          <span className="text-slate-600">|</span>
          <span className="text-slate-400 font-bold select-all tracking-wider">{formatTimeStr(currentTime)}</span>
        </div>

        {/* Right: kiosk label */}
        <div className="tracking-widest uppercase text-slate-500 font-bold flex-shrink-0">
          SURFACE PRO KIOSK
        </div>
      </footer>
    </div>
  );
}
