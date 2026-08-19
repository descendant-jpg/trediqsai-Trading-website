import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { SendOracleChatResponse } from "@workspace/api-zod";

let server: Server;
let baseUrl: string;

// Captures the arguments the route passes to the Anthropic SDK so tests can
// assert on system prompts and normalized message turns.
const createMock = vi.fn();

async function startFreshApp(): Promise<void> {
  // The oracle router builds its rate-limit bucket at module scope; re-import
  // a fresh copy per test so cases don't leak state into each other.
  vi.resetModules();
  vi.doMock("@anthropic-ai/sdk", () => ({
    default: class MockAnthropic {
      messages = { create: createMock };
    },
  }));
  vi.doMock("../middlewares/identity", () => {
    const ANONYMOUS_USER = "anonymous";
    return {
      ANONYMOUS_USER,
      identity: () => (req: express.Request, res: express.Response, next: express.NextFunction) => {
        res.locals.userId =
          req.header("authorization") === "Bearer test-pro" ? "test-pro-user" : ANONYMOUS_USER;
        next();
      },
      requestUserId: (res: express.Response) => res.locals.userId ?? ANONYMOUS_USER,
    };
  });
  vi.doMock("../lib/aiQuota", () => ({
    reserveAiQuota: vi.fn().mockResolvedValue({ allowed: true, tier: "pro" }),
  }));
  const { default: oracleRouter } = await import("./oracle");
  const app: Express = express();
  app.use(express.json());
  app.use(oracleRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const { address, port } = server.address() as AddressInfo;
  baseUrl = `http://${address}:${port}`;
}

async function request(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: "Bearer test-pro",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

function textReply(text: string) {
  return { content: [{ type: "text", text }] };
}

const USER_MESSAGE = { role: "user", content: "What do you think of gold?" };

beforeEach(async () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("EXPO_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  // Oracle tests exercise Anthropic behavior, not a real Supabase project.
  // The cache has dedicated integration coverage once its migration is live.
  vi.stubEnv("SUPABASE_STRATEGY_BRIEF_CACHE_ENABLED", "false");
  createMock.mockReset();
  await startFreshApp();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.doUnmock("@anthropic-ai/sdk");
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

describe("POST /oracle/chat", () => {
  it("rejects unauthenticated AI requests before they reach the provider", async () => {
    const res = await fetch(`${baseUrl}/oracle/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [USER_MESSAGE] }),
    });
    expect(res.status).toBe(401);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("returns the model's reply for a valid request", async () => {
    createMock.mockResolvedValue(textReply("Gold looks constructive. Not financial advice."));
    const { status, body } = await request("POST", "/oracle/chat", {
      messages: [USER_MESSAGE],
    });
    expect(status).toBe(200);
    expect(() => SendOracleChatResponse.parse(body)).not.toThrow();
    expect(body.reply).toBe("Gold looks constructive. Not financial advice.");
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("joins multiple text blocks and trims whitespace in the reply", async () => {
    createMock.mockResolvedValue({
      content: [
        { type: "text", text: "  Part one." },
        { type: "tool_use", id: "x", name: "noop", input: {} },
        { type: "text", text: " Part two.  " },
      ],
    });
    const { status, body } = await request("POST", "/oracle/chat", {
      messages: [USER_MESSAGE],
    });
    expect(status).toBe(200);
    expect(body.reply).toBe("Part one. Part two.");
  });

  it("rejects invalid bodies with 400", async () => {
    for (const bad of [
      {},
      { messages: [] },
      { messages: [{ role: "system", content: "hi" }] },
      { messages: [{ role: "user" }] },
      { messages: [USER_MESSAGE], tradingContext: { balance: 1 } },
    ]) {
      const { status, body } = await request("POST", "/oracle/chat", bad);
      expect(status).toBe(400);
      expect(body).toEqual({ error: "Invalid request body" });
    }
    expect(createMock).not.toHaveBeenCalled();
  });

  it("returns 400 when there is no user turn to respond to", async () => {
    const { status, body } = await request("POST", "/oracle/chat", {
      messages: [{ role: "assistant", content: "Hello, trader." }],
    });
    expect(status).toBe(400);
    expect(body).toEqual({ error: "No user message to respond to." });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("merges adjacent same-role turns and drops a leading assistant turn", async () => {
    createMock.mockResolvedValue(textReply("ok"));
    await request("POST", "/oracle/chat", {
      messages: [
        { role: "assistant", content: "Welcome back." },
        { role: "user", content: "First." },
        { role: "user", content: "Second." },
        { role: "assistant", content: "Reply." },
        { role: "user", content: "Third." },
      ],
    });
    const call = createMock.mock.calls[0]![0];
    expect(call.messages).toEqual([
      { role: "user", content: "First.\n\nSecond." },
      { role: "assistant", content: "Reply." },
      { role: "user", content: "Third." },
    ]);
  });

  it("injects the trading context into the system prompt", async () => {
    createMock.mockResolvedValue(textReply("ok"));
    await request("POST", "/oracle/chat", {
      messages: [USER_MESSAGE],
      tradingContext: {
        balance: 100000,
        equity: 100250.5,
        openPosition: {
          side: "LONG",
          symbol: "XAUUSD",
          entryPrice: 2412.5,
          size: 1,
          unrealizedPnl: -125.25,
        },
        drawdownUsed: 0.85,
        distanceToPayout: 4300,
      },
    });
    const call = createMock.mock.calls[0]![0];
    expect(call.system).toContain("Balance: $100,000.00");
    expect(call.system).toContain("LONG 1 XAUUSD from $2,412.50");
    expect(call.system).toContain("unrealized P&L -$125.25");
    expect(call.system).toContain("85% of the limit (risk mode: critical)");
    expect(call.system).toContain("Profit still needed to reach payout: $4,300.00");
  });

  it("omits the trading-context block when none is supplied", async () => {
    createMock.mockResolvedValue(textReply("ok"));
    await request("POST", "/oracle/chat", { messages: [USER_MESSAGE] });
    const call = createMock.mock.calls[0]![0];
    expect(call.system).not.toContain("Trader account snapshot");
  });

  it("returns 503 when ANTHROPIC_API_KEY is not configured", async () => {
    // Restart the app without the key.
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    await startFreshApp();

    const { status, body } = await request("POST", "/oracle/chat", {
      messages: [USER_MESSAGE],
    });
    expect(status).toBe(503);
    expect(body.error).toContain("missing ANTHROPIC_API_KEY");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("returns 502 when the model returns an empty reply", async () => {
    createMock.mockResolvedValue({ content: [{ type: "text", text: "   " }] });
    const { status, body } = await request("POST", "/oracle/chat", {
      messages: [USER_MESSAGE],
    });
    expect(status).toBe(502);
    expect(body).toEqual({ error: "The Oracle returned an empty response." });
  });

  it("returns 502 when the model call throws", async () => {
    createMock.mockRejectedValue(new Error("upstream boom"));
    const { status, body } = await request("POST", "/oracle/chat", {
      messages: [USER_MESSAGE],
    });
    expect(status).toBe(502);
    expect(body).toEqual({ error: "The Oracle couldn't reach its AI model." });
  });

  it("rate-limits after 20 requests in a minute with a Retry-After header", async () => {
    createMock.mockResolvedValue(textReply("ok"));
    for (let i = 0; i < 20; i++) {
      const { status } = await request("POST", "/oracle/chat", {
        messages: [USER_MESSAGE],
      });
      expect(status).toBe(200);
    }
    const res = await fetch(`${baseUrl}/oracle/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-pro" },
      body: JSON.stringify({ messages: [USER_MESSAGE] }),
    });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("The Oracle needs a breather");
  });
});

describe("POST /oracle/strategy-brief", () => {
  it("uses the lightweight model and returns the terminal-safe brief", async () => {
    createMock.mockResolvedValue(
      textReply("Watching 2.1 ATR stops against VWAP deviation and order-flow skew."),
    );

    const { status, body } = await request("POST", "/oracle/strategy-brief", {
      botName: "Swing Master",
      capitalPercent: 40,
    });

    expect(status).toBe(200);
    expect(body).toEqual({
      brief: "Watching 2.1 ATR stops against VWAP deviation and order-flow skew.",
    });
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
      }),
    );
    expect(createMock.mock.calls[0]![0].messages[0].content).toContain(
      "Swing Master",
    );
    expect(createMock.mock.calls[0]![0].messages[0].content).toContain("40%");
  });

  it("rejects malformed strategy brief input before it reaches Anthropic", async () => {
    const { status, body } = await request("POST", "/oracle/strategy-brief", {
      botName: "",
      capitalPercent: 101,
    });

    expect(status).toBe(400);
    expect(body).toEqual({ error: "Invalid request body" });
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("POST /oracle/chart-analysis", () => {
  /**
   * A base64 payload that satisfies the ≥100-char minimum without being a
   * real image — we only need to reach the Anthropic mock, not decode pixels.
   */
  const VALID_IMAGE = "A".repeat(120);
  const VALID_BODY = {
    imageBase64: VALID_IMAGE,
    mode: "analysis" as const,
    mediaType: "image/jpeg" as const,
  };

  /**
   * Boots a fresh app instance with the identity middleware and entitlement
   * lookup replaced by in-memory stubs so tests run without Supabase.
   */
  async function startAppAs(
    userId: string,
    hasPro: boolean,
    apiKey = "test-key",
  ): Promise<void> {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    vi.resetModules();
    vi.stubEnv("ANTHROPIC_API_KEY", apiKey);
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = { create: createMock };
      },
    }));
    vi.doMock("../middlewares/identity", () => ({
      ANONYMOUS_USER: "anonymous",
      identity: () => (_req: unknown, res: any, next: () => void) => {
        res.locals["userId"] = userId;
        next();
      },
      requestUserId: (res: any) => res.locals["userId"] ?? "anonymous",
    }));
    vi.doMock("../lib/entitlement", () => ({
      hasProAccess: vi.fn().mockResolvedValue(hasPro),
    }));
    const { default: oracleRouter } = await import("./oracle");
    const app: Express = express();
    app.use(express.json({ limit: "12mb" }));
    app.use(oracleRouter);
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    const { address, port } = server.address() as AddressInfo;
    baseUrl = `http://${address}:${port}`;
  }

  afterEach(() => {
    vi.doUnmock("../middlewares/identity");
    vi.doUnmock("../lib/entitlement");
  });

  it("rejects anonymous callers with 401", async () => {
    await startAppAs("anonymous", false);
    const { status, body } = await request("POST", "/oracle/chart-analysis", VALID_BODY);
    expect(status).toBe(401);
    expect(body.error).toMatch(/sign in/i);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects free-tier users with 403 and the pro_subscription_required code", async () => {
    await startAppAs("user-free-123", false);
    const { status, body } = await request("POST", "/oracle/chart-analysis", VALID_BODY);
    expect(status).toBe(403);
    expect(body.code).toBe("pro_subscription_required");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("returns a structured analysis object for a valid paid request", async () => {
    await startAppAs("user-pro-123", true);
    createMock.mockResolvedValue(
      textReply("BIAS: Bullish. KEY LEVELS: 2400, 2380. ANALYSIS: Strong uptrend."),
    );
    const { status, body } = await request("POST", "/oracle/chart-analysis", VALID_BODY);
    expect(status).toBe(200);
    expect(typeof body.analysis).toBe("string");
    expect(body.analysis).toContain("BIAS");
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("returns the validated structured signal format in signal mode", async () => {
    await startAppAs("user-pro-123", true);
    createMock.mockResolvedValue(
      textReply(
        '{"asset":"XAUUSD","direction":"BUY","entry":2405,"takeProfit":2460,"stopLoss":2375,"confidence":82,"reasoning":"Bullish structure; not financial advice."}',
      ),
    );
    const { status, body } = await request("POST", "/oracle/chart-analysis", {
      ...VALID_BODY,
      mode: "signal",
    });
    expect(status).toBe(200);
    expect(body.signal).toMatchObject({
      asset: "XAUUSD",
      direction: "BUY",
      entry: 2405,
      takeProfit: 2460,
      stopLoss: 2375,
    });

    // The system prompt must require the current machine-readable contract.
    const systemPrompt: string = createMock.mock.calls[0]![0].system;
    expect(systemPrompt).toContain("valid JSON");
    expect(systemPrompt).toContain("takeProfit");
    expect(systemPrompt).toContain("stopLoss");
  });

  it("returns 503 when the AI provider key is not configured", async () => {
    await startAppAs("user-pro-123", true, "");
    const { status, body } = await request("POST", "/oracle/chart-analysis", VALID_BODY);
    expect(status).toBe(503);
    expect(body.error).toContain("not configured");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("returns a recoverable 502 when the AI provider throws during analysis", async () => {
    await startAppAs("user-pro-123", true);
    createMock.mockRejectedValue(new Error("upstream provider unavailable"));
    const { status, body } = await request("POST", "/oracle/chart-analysis", VALID_BODY);
    expect(status).toBe(502);
    expect(body.error).toContain("unavailable");
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a body missing imageBase64 with 400 before reaching the AI", async () => {
    await startAppAs("user-pro-123", true);
    const { status, body } = await request("POST", "/oracle/chart-analysis", {
      mode: "analysis",
      mediaType: "image/jpeg",
    });
    expect(status).toBe(400);
    expect(body.error).toContain("valid chart image");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("limits each paid user to five chart uploads per minute without changing chat limits", async () => {
    await startAppAs("user-pro-123", true);
    createMock.mockResolvedValue(textReply("BIAS: Neutral."));
    for (let i = 0; i < 5; i++) {
      const { status } = await request("POST", "/oracle/chart-analysis", VALID_BODY);
      expect(status).toBe(200);
    }
    const response = await fetch(`${baseUrl}/oracle/chart-analysis`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(VALID_BODY),
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBeTruthy();
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("5 uploads per minute");
  });
});

describe("POST /oracle/strategy-brief — Supabase cache", () => {
  const SUPABASE = "https://cache-test.supabase.co";
  /** Supabase calls the route makes, in order, as [method, url] pairs. */
  let supabaseCalls: Array<[string, string]>;
  /** Queued responses for cache reads; each entry is one PostgREST result. */
  let cacheReads: Array<{ ok: boolean; rows: unknown }>;
  let cacheWriteOk: boolean;

  /**
   * Intercepts only Supabase traffic so the test's own requests to the local
   * express server still hit the real network stack.
   */
  async function startAppWithCache(): Promise<void> {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    vi.stubEnv("SUPABASE_STRATEGY_BRIEF_CACHE_ENABLED", "true");
    vi.stubEnv("SUPABASE_URL", SUPABASE);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key");

    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: any, init?: any) => {
        const url = typeof input === "string" ? input : input.url;
        if (!url.startsWith(SUPABASE)) return realFetch(input, init);

        const method = init?.method ?? "GET";
        supabaseCalls.push([method, url]);

        if (method === "GET") {
          const next = cacheReads.shift() ?? { ok: true, rows: [] };
          return new Response(JSON.stringify(next.rows), {
            status: next.ok ? 200 : 500,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(null, { status: cacheWriteOk ? 201 : 500 });
      },
    );

    await startFreshApp();
  }

  beforeEach(() => {
    supabaseCalls = [];
    cacheReads = [];
    cacheWriteOk = true;
  });

  afterEach(() => {
    vi.mocked(globalThis.fetch).mockRestore?.();
  });

  it("serves a cached brief without calling Anthropic", async () => {
    cacheReads.push({ ok: true, rows: [{ brief: "Cached: monitoring VWAP bands." }] });
    await startAppWithCache();

    const { status, body } = await request("POST", "/oracle/strategy-brief", {
      botName: "Pulse Scalper",
      capitalPercent: 25,
    });

    expect(status).toBe(200);
    expect(body).toEqual({ brief: "Cached: monitoring VWAP bands." });
    // The whole point of the cache: no Anthropic call, so no repeat billing.
    expect(createMock).not.toHaveBeenCalled();
    expect(supabaseCalls).toHaveLength(1);
    expect(supabaseCalls[0]![0]).toBe("GET");
  });

  it("scopes the cache lookup to the bot, allocation and a 15-minute window", async () => {
    cacheReads.push({ ok: true, rows: [] });
    await startAppWithCache();
    createMock.mockResolvedValue(textReply("Fresh brief."));

    const before = Date.now();
    await request("POST", "/oracle/strategy-brief", {
      botName: "Swing Master",
      capitalPercent: 40,
    });

    const readUrl = new URL(supabaseCalls[0]![1]);
    expect(readUrl.pathname).toBe("/rest/v1/autopilot_strategy_brief_cache");
    expect(readUrl.searchParams.get("bot_name")).toBe("eq.Swing Master");
    expect(readUrl.searchParams.get("capital_percent")).toBe("eq.40");

    // A stale brief must not be reused: the floor is ~15 minutes back.
    const floor = Date.parse(readUrl.searchParams.get("created_at")!.replace("gte.", ""));
    const age = before - floor;
    expect(age).toBeGreaterThan(14 * 60_000);
    expect(age).toBeLessThanOrEqual(15 * 60_000 + 5_000);
  });

  it("stores a freshly generated brief so the next deployment reuses it", async () => {
    cacheReads.push({ ok: true, rows: [] });
    await startAppWithCache();
    createMock.mockResolvedValue(textReply("Newly generated brief."));

    const { status, body } = await request("POST", "/oracle/strategy-brief", {
      botName: "News Sniper",
      capitalPercent: 60,
    });

    expect(status).toBe(200);
    expect(body).toEqual({ brief: "Newly generated brief." });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(supabaseCalls.map(([method]) => method)).toEqual(["GET", "POST"]);
  });

  it("still returns a brief when the cache is unavailable", async () => {
    // Read fails (e.g. migration not applied) and the write fails too.
    cacheReads.push({ ok: false, rows: { message: "relation does not exist" } });
    cacheWriteOk = false;
    await startAppWithCache();
    createMock.mockResolvedValue(textReply("Brief despite a broken cache."));

    const { status, body } = await request("POST", "/oracle/strategy-brief", {
      botName: "Pulse Scalper",
      capitalPercent: 25,
    });

    // Fail-open: a caching problem must never block a bot deployment.
    expect(status).toBe(200);
    expect(body).toEqual({ brief: "Brief despite a broken cache." });
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("does not reuse a cached row that is blank", async () => {
    cacheReads.push({ ok: true, rows: [{ brief: "   " }] });
    await startAppWithCache();
    createMock.mockResolvedValue(textReply("Real brief."));

    const { body } = await request("POST", "/oracle/strategy-brief", {
      botName: "Pulse Scalper",
      capitalPercent: 25,
    });

    expect(body).toEqual({ brief: "Real brief." });
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});
