import { Router, type IRouter } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { logger } from "../lib/logger";
import { rateLimit } from "../middlewares/rateLimit";
import { identity, requestUserId, ANONYMOUS_USER } from "../middlewares/identity";
import { reserveAiQuota } from "../lib/aiQuota";

const router: IRouter = Router();
const cache = new Map<string, { expiresAt: number; value: Analysis }>();
const CACHE_TTL_MS = 5 * 60_000;
const symbols: Record<string, string> = {
  "EUR/USD": "EURUSD=X",
  "GBP/USD": "GBPUSD=X",
  "BTC/USD": "BTC-USD",
};
const requestSchema = z.object({ symbol: z.string().trim().min(1).max(20) });
const analysisRateLimit = rateLimit({ max: 12, windowMs: 60_000, message: "Analysis is refreshing. Please try again shortly." });

type Direction = "BULLISH" | "BEARISH" | "NEUTRAL";
type Frame = { timeframe: "15M" | "1H" | "4H" | "1D"; label: string; direction: Direction; changePercent: number };
type Analysis = {
  symbol: string; price: number; change24h: number; confluence: number; direction: Direction;
  timeframes: Frame[]; levels: { support: number; resistance: number; liquidity: number }; narrative: string;
};

function resolveTicker(symbol: string) {
  const normalized = symbol.toUpperCase().replace(/\s/g, "");
  const display = normalized === "EUR/USD" || normalized === "GBP/USD" || normalized === "BTC/USD"
    ? normalized : symbol.trim().toUpperCase();
  return { display, ticker: symbols[display] ?? display.replace(/^NASDAQ:/, "") };
}
function direction(change: number): Direction {
  return change > 0.15 ? "BULLISH" : change < -0.15 ? "BEARISH" : "NEUTRAL";
}
function percent(now: number, then: number) {
  return then > 0 ? Number((((now - then) / then) * 100).toFixed(2)) : 0;
}
function price(n: number) { return Number(n.toFixed(n >= 100 ? 2 : 5)); }

async function getCandles(ticker: string): Promise<number[]> {
  const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=5d&interval=15m`, {
    headers: { "user-agent": "TradiQsAI/1.0 market-analysis" },
  });
  if (!response.ok) throw new Error(`Market data provider returned ${response.status}`);
  const payload = await response.json() as { chart?: { result?: Array<{ indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> } };
  const closes = payload.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter((value): value is number => typeof value === "number" && Number.isFinite(value)) ?? [];
  if (closes.length < 20) throw new Error("Market data provider returned insufficient candles");
  return closes;
}

async function narrativeFor(analysis: Omit<Analysis, "narrative">): Promise<string> {
  const client = process.env["ANTHROPIC_API_KEY"] ? new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] }) : null;
  const computed = `${analysis.symbol} is ${analysis.direction.toLowerCase()} with ${analysis.confluence}% multi-timeframe confluence. Support is near ${analysis.levels.support}, resistance is near ${analysis.levels.resistance}, and risk should be managed around the liquidity pool at ${analysis.levels.liquidity}.`;
  if (!client) return computed;
  try {
    const result = await client.messages.create({
      model: process.env["MULTI_TIMEFRAME_MODEL"] ?? "claude-haiku-4-5-20251001",
      max_tokens: 180,
      system: "You are a market-structure analyst. Give exactly two concise sentences, no markdown, no trade guarantees, and include that this is not financial advice.",
      messages: [{ role: "user", content: `Write a two-sentence technical narrative from this computed market snapshot: ${JSON.stringify(analysis)}` }],
    });
    const text = result.content.filter((block): block is Anthropic.TextBlock => block.type === "text").map((block) => block.text).join("").trim();
    return text || computed;
  } catch (err) {
    logger.warn({ err, symbol: analysis.symbol }, "Multi-timeframe narrative unavailable; returning computed analysis");
    return computed;
  }
}

router.post("/analysis/multi-timeframe", identity(), analysisRateLimit, async (req, res) => {
  const userId = requestUserId(res);
  if (userId === ANONYMOUS_USER) {
    return res.status(401).json({ error: "Sign in required." });
  }
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A valid market symbol is required." });
  try {
    const quota = await reserveAiQuota(userId, "multi_timeframe", 180);
    if (!quota.allowed) {
      return res.status(429).json({ error: "Daily AI request quota reached. Please try again tomorrow." });
    }
  } catch (err) {
    logger.error({ err, userId }, "Multi-timeframe quota check unavailable");
    return res.status(503).json({ error: "AI quota verification is temporarily unavailable." });
  }
  const { display, ticker } = resolveTicker(parsed.data.symbol);
  const cached = cache.get(display);
  if (cached && cached.expiresAt > Date.now()) return res.json(cached.value);
  try {
    const closes = await getCandles(ticker);
    const latest = closes.at(-1)!;
    const frameConfig: Array<[Frame["timeframe"], Frame["label"], number]> = [["15M", "Scalp Momentum", 1], ["1H", "Intraday Structure", 4], ["4H", "Swing Liquidity", 16], ["1D", "Macro Trend", 64]];
    const timeframes = frameConfig.map(([timeframe, label, lookback]) => ({
      timeframe, label, changePercent: percent(latest, closes[Math.max(0, closes.length - 1 - lookback)]!), direction: direction(percent(latest, closes[Math.max(0, closes.length - 1 - lookback)]!)),
    }));
    const bullish = timeframes.filter((frame) => frame.direction === "BULLISH").length;
    const bearish = timeframes.filter((frame) => frame.direction === "BEARISH").length;
    const overall = bullish === bearish ? "NEUTRAL" : bullish > bearish ? "BULLISH" : "BEARISH";
    const recent = closes.slice(-64);
    const change24h = percent(latest, closes[Math.max(0, closes.length - 97)]!);
    const core = {
      symbol: display, price: price(latest), change24h, direction: overall as Direction,
      confluence: Math.max(50, Math.min(95, 50 + Math.abs(bullish - bearish) * 12 + Math.round(Math.abs(change24h) * 3))),
      timeframes,
      levels: { support: price(Math.min(...recent)), resistance: price(Math.max(...recent)), liquidity: price((Math.min(...recent) + Math.max(...recent)) / 2) },
    };
    const value: Analysis = { ...core, narrative: await narrativeFor(core) };
    cache.set(display, { expiresAt: Date.now() + CACHE_TTL_MS, value });
    return res.json(value);
  } catch (err) {
    logger.warn({ err, symbol: display }, "Multi-timeframe market analysis failed");
    return res.status(502).json({ error: "Market analysis is temporarily unavailable." });
  }
});

export default router;