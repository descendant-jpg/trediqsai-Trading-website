import { Router, type IRouter } from "express";
import Anthropic from "@anthropic-ai/sdk";
import {
  SendOracleChatBody,
  SendOracleChatResponse,
  SendStrategyBriefBody,
  SendStrategyBriefResponse,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { rateLimit } from "../middlewares/rateLimit";
import { identity, requestUserId, ANONYMOUS_USER } from "../middlewares/identity";
import { hasProAccess } from "../lib/entitlement";
import { reserveAiQuota } from "../lib/aiQuota";
import { z } from "zod";

const router: IRouter = Router();
const STRATEGY_BRIEF_CACHE_TTL_MS = 15 * 60_000;
const SUPABASE_URL =
  process.env["SUPABASE_URL"] ?? process.env["EXPO_PUBLIC_SUPABASE_URL"] ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";

const oracleRateLimit = rateLimit({
  max: 20,
  windowMs: 60_000,
  message:
    "The Oracle needs a breather — you've sent a lot of messages. Try again in a minute.",
});
const chartAnalysisRateLimit = rateLimit({
  max: 5,
  windowMs: 60_000,
  message:
    "Chart analysis is limited to 5 uploads per minute to keep the AI service available. Please try again shortly.",
  key: (_req, res) => requestUserId(res),
});
const SYSTEM_PROMPT = [
  "You are the TradiQs Oracle, the in-app market AI assistant for the TradiQs trading app.",
  "You help traders think about markets: asset analysis, sentiment, notable movers, risk framing, and trading concepts.",
  "Style: concise, confident, trader-friendly. Prefer 2-5 short sentences. No markdown headings or bullet walls — plain conversational text suits the chat bubbles.",
  "Never claim to have live market data; when asked for current prices or real-time numbers, explain you don't have a live feed and reason from general market structure instead.",
  "Always remind users that nothing you say is financial advice when giving anything resembling a trade idea.",
].join(" ");
const chartRequestSchema = z.object({
  imageBase64: z.string().min(100).max(8_000_000),
  mode: z.enum(["analysis", "signal"]),
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
});
const generatedSignalSchema = z.object({
  asset: z.string().trim().min(2).max(20),
  direction: z.enum(["BUY", "SELL"]),
  entry: z.number().positive(),
  takeProfit: z.number().positive(),
  stopLoss: z.number().positive(),
  confidence: z.number().min(0).max(100),
  reasoning: z.string().trim().min(3).max(1_000),
});
const visionFallback = {
  asset: "UNSPECIFIED",
  direction: "NEUTRAL",
  entry: 0,
  takeProfit: 0,
  stopLoss: 0,
  confidence: 0,
  reasoning: "The AI Vision engine could not identify clear candlestick patterns or price action in this screenshot. Please ensure your chart includes visible timeframes, price axes, and clear candles.",
};
const chartDataUrlPattern =
  /^data:(image\/(?:jpeg|png|webp|gif));base64,([a-z0-9+/=\s]+)$/i;

function normalizeChartImage(imageBase64: string, fallbackMediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif") {
  const dataUrl = imageBase64.match(chartDataUrlPattern);
  if (!dataUrl) return { mediaType: fallbackMediaType, data: imageBase64.replace(/\s/g, "") };
  return {
    mediaType: dataUrl[1]!.toLowerCase() as typeof fallbackMediaType,
    data: dataUrl[2]!.replace(/\s/g, ""),
  };
}

type TradingContext = NonNullable<
  ReturnType<typeof SendOracleChatBody.parse>["tradingContext"]
>;
function getClient(): Anthropic | null {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (apiKey) return new Anthropic({ apiKey });
  return null;
}

type CachedStrategyBrief = { brief?: unknown };

/**
 * Strategy briefs are operational output rather than entitlement data, so a
 * short cache reduces duplicate Anthropic charges without introducing an
 * authorization/revocation window. Caching is deliberately fail-open: an
 * unavailable cache must never prevent a successfully entitled trader from
 * deploying their bot.
 */
function strategyBriefCacheEnabled(): boolean {
  return (
    process.env["SUPABASE_STRATEGY_BRIEF_CACHE_ENABLED"] !== "false" &&
    !!SUPABASE_URL &&
    !!SUPABASE_SERVICE_ROLE_KEY
  );
}

function cacheHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  });
}

async function readCachedStrategyBrief(
  botName: string,
  capitalPercent: number,
): Promise<string | null> {
  if (!strategyBriefCacheEnabled()) return null;
  try {
    const params = new URLSearchParams({
      bot_name: `eq.${botName}`,
      capital_percent: `eq.${capitalPercent}`,
      created_at: `gte.${new Date(Date.now() - STRATEGY_BRIEF_CACHE_TTL_MS).toISOString()}`,
      select: "brief",
      order: "created_at.desc",
      limit: "1",
    });
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/autopilot_strategy_brief_cache?${params}`,
      { headers: cacheHeaders() },
    );
    if (!response.ok) {
      logger.warn(
        { status: response.status },
        "Strategy brief cache read failed; falling back to Anthropic",
      );
      return null;
    }
    const rows = (await response.json()) as CachedStrategyBrief[];
    const brief = rows[0]?.brief;
    return typeof brief === "string" && brief.trim() ? brief.trim() : null;
  } catch (err) {
    logger.warn({ err }, "Strategy brief cache read failed; falling back to Anthropic");
    return null;
  }
}

async function writeCachedStrategyBrief(
  botName: string,
  capitalPercent: number,
  brief: string,
): Promise<void> {
  if (!strategyBriefCacheEnabled()) return;
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/autopilot_strategy_brief_cache`,
      {
        method: "POST",
        headers: cacheHeaders({
          "content-type": "application/json",
          prefer: "return=minimal",
        }),
        body: JSON.stringify({
          bot_name: botName,
          capital_percent: capitalPercent,
          brief,
        }),
      },
    );
    if (!response.ok) {
      logger.warn(
        { status: response.status },
        "Strategy brief cache write failed; continuing without persistence",
      );
    }
  } catch (err) {
    logger.warn({ err }, "Strategy brief cache write failed; continuing without persistence");
  }
}

type ChatTurn = { role: "user" | "assistant"; content: string };

/**
 * Anthropic requires strictly alternating user/assistant turns starting with
 * "user". Keep the most recent turns to bound token usage, merge adjacent
 * same-role messages, and drop a leading assistant turn.
 */
function normalizeMessages(
  messages: Array<{ role: string; content: string }>,
): ChatTurn[] {
  const recent = messages.slice(-20);
  const out: ChatTurn[] = [];
  for (const m of recent) {
    const role = m.role === "assistant" ? ("assistant" as const) : ("user" as const);
    const prev = out[out.length - 1];
    if (prev && prev.role === role) {
      prev.content = `${prev.content}\n\n${m.content}`;
    } else {
      out.push({ role, content: m.content });
    }
  }
  while (out.length > 0 && out[0]!.role === "assistant") out.shift();
  return out;
}

router.post("/oracle/chat", identity(), oracleRateLimit, async (req, res) => {
  const userId = requestUserId(res);
  if (userId === ANONYMOUS_USER) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }
  const parsed = SendOracleChatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const client = getClient();

  if (!client) {
    res.status(503).json({
      error:
        "The Oracle's AI backend isn't configured yet (missing ANTHROPIC_API_KEY).",
    });
    return;
  }

  const chatMessages = normalizeMessages(parsed.data.messages);
  if (chatMessages.length === 0) {
    res.status(400).json({ error: "No user message to respond to." });
    return;
  }
  try {
    const quota = await reserveAiQuota(userId, "oracle_chat", 1_200);
    if (!quota.allowed) {
      res.status(429).json({ error: "Daily AI request quota reached. Please try again tomorrow." });
      return;
    }
  } catch (err) {
    logger.error({ err, userId }, "Oracle chat quota check unavailable");
    res.status(503).json({ error: "AI quota verification is temporarily unavailable." });
    return;
  }

  try {
    const message = await client.messages.create({
      model: process.env["ORACLE_MODEL"] ?? "claude-sonnet-5",
      max_tokens: 1200,
      system: parsed.data.tradingContext
        ? `${SYSTEM_PROMPT}\n\n${buildContextPrompt(parsed.data.tradingContext)}`
        : SYSTEM_PROMPT,
      messages: chatMessages,
    });

    const reply = message.content
      .filter(
        (block): block is Anthropic.TextBlock => block.type === "text",
      )
      .map((block) => block.text)
      .join("")
      .trim();
    if (!reply) {
      res.status(502).json({ error: "The Oracle returned an empty response." });
      return;
    }

    res.json(SendOracleChatResponse.parse({ reply }));
  } catch (err) {
    logger.error({ err }, "Oracle chat completion failed");
    res.status(502).json({ error: "The Oracle couldn't reach its AI model." });
  }
});

router.post("/oracle/chart-analysis", identity(), chartAnalysisRateLimit, async (req, res) => {
  const userId = requestUserId(res);
  if (userId === ANONYMOUS_USER) return res.status(401).json({ error: "Sign in required." });
  if (!(await hasProAccess(userId))) return res.status(403).json({ error: "Pro subscription required.", code: "pro_subscription_required" });
  const parsed = chartRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A valid chart image is required." });
  const client = getClient();
  if (!client) return res.status(503).json({ error: "Chart analysis is not configured yet." });
  const chartImage = normalizeChartImage(parsed.data.imageBase64, parsed.data.mediaType);
  const signalPrompt = parsed.data.mode === "signal"
    ? "Return only valid JSON, no markdown or code fences, matching exactly: {\"asset\":\"EURUSD\",\"direction\":\"BUY\",\"entry\":1.105,\"takeProfit\":1.11,\"stopLoss\":1.102,\"confidence\":85,\"reasoning\":\"brief technical rationale\"}. Use a real asset label, BUY or SELL, positive numbers, confidence 0-100, and include that it is not financial advice in reasoning."
    : "Return concise sections for BIAS, KEY LEVELS, and ANALYSIS. Do not guarantee outcomes and include that this is not financial advice.";
  try {
    const message = await client.messages.create({
      model: process.env["CHART_ANALYSIS_MODEL"] ?? "claude-haiku-4-5-20251001",
      max_tokens: 600,
      system: `You are a cautious institutional chart analyst. ${signalPrompt}`,
      messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: chartImage.mediaType, data: chartImage.data } }, { type: "text", text: "Analyze this uploaded trading chart." }] }],
    });
    const analysis = message.content.filter((block): block is Anthropic.TextBlock => block.type === "text").map((block) => block.text).join("").trim();
    if (!analysis) return res.json({ analysis: visionFallback.reasoning, signal: visionFallback, fallback: true });
    if (parsed.data.mode === "signal") {
      const json = analysis.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      let candidate: unknown;
      try { candidate = JSON.parse(json); } catch { return res.json({ analysis: visionFallback.reasoning, signal: visionFallback, fallback: true }); }
      const signal = generatedSignalSchema.safeParse(candidate);
      if (!signal.success) return res.json({ analysis: visionFallback.reasoning, signal: visionFallback, fallback: true });
      if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
        const saved = await fetch(`${SUPABASE_URL}/rest/v1/trading_signals`, {
          method: "POST",
          headers: cacheHeaders({ "content-type": "application/json", prefer: "return=minimal" }),
          body: JSON.stringify({ user_id: userId, asset: signal.data.asset, direction: signal.data.direction, entry_price: signal.data.entry, take_profit: signal.data.takeProfit, stop_loss: signal.data.stopLoss, confidence: signal.data.confidence }),
        });
        if (!saved.ok) return res.status(503).json({ error: "Signal storage is not ready. Apply the latest Supabase migration." });
      }
      return res.json({ signal: signal.data });
    }
    return res.json({ analysis });
  } catch (err) {
    logger.error({ err, userId }, "Chart analysis failed");
    return res.status(502).json({ error: "Chart analysis is temporarily unavailable." });
  }
});

/**
 * One-sentence "what am I watching" brief shown in the AutoPilot deployment
 * terminal. Runs server-side for the same reason as /oracle/chat: the
 * Anthropic key must never ship inside the Expo bundle, where anything
 * EXPO_PUBLIC_* is readable by anyone who downloads the app.
 *
 * A failure here is cosmetic — the caller falls back to a static line — so
 * errors return a plain message rather than blocking a deployment.
 */
router.post("/oracle/strategy-brief", identity(), oracleRateLimit, async (req, res) => {
  const userId = requestUserId(res);
  if (userId === ANONYMOUS_USER) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }
  const parsed = SendStrategyBriefBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const client = getClient();
  if (!client) {
    res.status(503).json({
      error: "The strategy engine isn't configured yet (missing ANTHROPIC_API_KEY).",
    });
    return;
  }
  try {
    const quota = await reserveAiQuota(userId, "strategy_brief", 300, { requiresPro: true });
    if (!quota.allowed) {
      const status = quota.reason === "pro_required" ? 403 : 429;
      res.status(status).json({
        error:
          quota.reason === "pro_required"
            ? "Pro subscription required."
            : "Daily AI request quota reached. Please try again tomorrow.",
      });
      return;
    }
  } catch (err) {
    logger.error({ err, userId }, "Strategy brief quota check unavailable");
    res.status(503).json({ error: "AI quota verification is temporarily unavailable." });
    return;
  }

  const { botName, capitalPercent } = parsed.data;
  try {
    const cachedBrief = await readCachedStrategyBrief(botName, capitalPercent);
    if (cachedBrief) {
      res.json(SendStrategyBriefResponse.parse({ brief: cachedBrief }));
      return;
    }

    const message = await client.messages.create({
      // This is intentionally separate from ORACLE_MODEL: a one-line
      // deployment status does not warrant the larger conversational model.
      // claude-3-haiku / claude-3-5-haiku are not available on this account
      // (verified against the models API), so this is the cheapest
      // Haiku-class model it can actually reach.
      model:
        process.env["STRATEGY_BRIEF_MODEL"] ?? "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system:
        "You write terse, technical one-line status output for an algorithmic trading terminal. Reply with a single sentence, no preamble, no markdown, no quotes.",
      messages: [
        {
          role: "user",
          content: `You are an institutional trading bot named ${botName}. Generate 1 sentence of highly technical trading parameters you are currently monitoring based on a ${capitalPercent}% allocation.`,
        },
      ],
    });

    const brief = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    if (!brief) {
      res.status(502).json({ error: "The strategy engine returned an empty response." });
      return;
    }

    // Best-effort and intentionally awaited: the next deployment can reuse
    // this value immediately, but a cache failure still returns the valid
    // Anthropic response instead of failing the bot UI.
    await writeCachedStrategyBrief(botName, capitalPercent, brief);
    res.json(SendStrategyBriefResponse.parse({ brief }));
  } catch (err) {
    logger.error({ err }, "Strategy brief generation failed");
    res.status(502).json({ error: "The strategy engine couldn't reach its AI model." });
  }
});

export default router;

/**
 * Renders the caller's account snapshot into a system-prompt block so the
 * Oracle can give trade-specific advice (e.g. flagging that a suggested
 * trade conflicts with an open position).
 */
function buildContextPrompt(ctx: TradingContext): string {
  const money = (n: number) =>
    `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const lines = [
    "Trader account snapshot (simulated funded-account challenge, USD):",
    `- Balance: ${money(ctx.balance)}; Equity: ${money(ctx.equity)}.`,
  ];
  const pos = ctx.openPosition;
  if (pos) {
    const pnlSign = pos.unrealizedPnl >= 0 ? "+" : "-";
    lines.push(
      `- Open position: ${pos.side} ${pos.size} ${pos.symbol} from ${money(pos.entryPrice)}, unrealized P&L ${pnlSign}${money(Math.abs(pos.unrealizedPnl))}.`,
    );
  } else {
    lines.push("- Open position: none (flat).");
  }
  const ddPct = Math.round(Math.min(Math.max(ctx.drawdownUsed, 0), 1) * 100);
  const riskMode =
    ddPct >= 80 ? "critical" : ddPct >= 50 ? "elevated" : "normal";
  lines.push(
    `- Daily drawdown used: ${ddPct}% of the limit (risk mode: ${riskMode}).`,
    `- Profit still needed to reach payout: ${money(Math.max(ctx.distanceToPayout, 0))}.`,
    "Use this context to personalise answers: reference the trader's open position and risk state when relevant, and warn when an idea would add exposure to an existing position or endanger the drawdown limit. Do not repeat the whole snapshot back unless asked.",
  );
  return lines.join("\n");
}
