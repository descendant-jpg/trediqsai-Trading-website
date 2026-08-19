import { Router, type IRouter, type RequestHandler } from "express";
import {
  GetAutopilotResponse,
  GetAutopilotHistoryResponse,
  SetAutopilotAssetBody,
  SetAutopilotMasterBody,
  UpdateAutopilotBotBody,
} from "@workspace/api-zod";
import {
  db,
  autopilotBotsTable,
  autopilotStateTable,
  autopilotPnlHistoryTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { identity, requestUserId, type TokenVerifier } from "../middlewares/identity";
import { requireAal2IfMfaEnrolledSoft, requireAal2IfMfaEnrolledWrite } from "../middlewares/aal2";
import { hasEliteAccess, hasProAccess, type TierLookup } from "../lib/entitlement";

type BotState = {
  id: string;
  name: string;
  tags: string;
  risk: "Low" | "Medium" | "High";
  winRate: string;
  return30d: string;
  totalTrades: number;
  proOnly: boolean;
  running: boolean;
  capital: number;
  drawdown: number;
};

type LogLine = { id: string; time: string; text: string };

const LOG_TEMPLATES = [
  "[SCAN] BTCUSD 5m — sweeping liquidity below 96,180…",
  "[EXEC] Limit order placed: XAUUSD BUY @ 2,411.80",
  "[RISK] Trailing stop adjusted +12p on EURUSD short",
  "[SCAN] Market structure shift detected on US30 M15",
  "[EXEC] Partial close 50% @ TP1 — GBPJPY +100p",
  "[GRID] Rebalancing grid levels: 27.20 → 27.85 (12 nodes)",
  "[RISK] Exposure check passed — 3.2% of allocated capital at risk",
  "[SCAN] Momentum spike on NAS100 — awaiting retest confirmation",
  "[EXEC] Stop moved to breakeven on ETHUSD long",
  "[NET] Latency 14ms — co-located feed stable",
];

const TICK_MS = 2_600;
const MAX_LOGS = 80;
/** Cap the number of per-user states kept in memory (LRU-evicted). */
const MAX_USERS = 500;
/** Minimum interval between background state saves per user. */
const PERSIST_INTERVAL_MS = 10_000;
/** Max finished days of P&L history kept and served per user. */
const HISTORY_LIMIT = 30;

/** Identity for unauthenticated callers (kept in sync with middleware). */
const ANONYMOUS = "anonymous";

const DEFAULT_BOTS: readonly BotState[] = [
  {
    id: "scalp-oracle",
    name: "Scalp Oracle AI",
    tags: "Crypto / 5m Scalper",
    risk: "Low",
    winRate: "78.4%",
    return30d: "+12.6%",
    totalTrades: 1842,
    proOnly: false,
    running: true,
    capital: 10000,
    drawdown: 10,
  },
  {
    id: "breakout-engine",
    name: "Breakout Engine Pro",
    tags: "Forex & Stocks / Momentum",
    risk: "Medium",
    winRate: "71.2%",
    return30d: "+9.1%",
    totalTrades: 967,
    proOnly: false,
    running: true,
    capital: 15000,
    drawdown: 15,
  },
  {
    id: "grid-matrix",
    name: "Grid Matrix AI",
    tags: "Range Trading",
    risk: "Low",
    winRate: "82.1%",
    return30d: "+7.4%",
    totalTrades: 2210,
    proOnly: false,
    running: false,
    capital: 10000,
    drawdown: 10,
  },
  {
    id: "quantum-inst",
    name: "Quantum Institutional AI",
    tags: "Multi-Asset / Order Flow",
    risk: "High",
    winRate: "88.7%",
    return30d: "+21.3%",
    totalTrades: 3405,
    proOnly: true,
    running: false,
    capital: 10000,
    drawdown: 10,
  },
];

function nowClock(atMs: number): string {
  const d = new Date(atMs);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** `Date.toDateString()` day → ISO date (YYYY-MM-DD), in local time. */
function toIsoDay(dateString: string): string {
  const d = new Date(dateString);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** One finished day of P&L (day = YYYY-MM-DD), most recent first. */
type HistoryEntry = { day: string; pnl: number };

type UserAutopilot = {
  bots: BotState[];
  masterActive: boolean;
  selectedAsset: "Forex" | "Crypto" | "Stocks";
  todayPnl: number;
  pnlDay: string;
  logs: LogLine[];
  lastTickAt: number;
  logSeq: number;
  templateIndex: number;
  lastPersistAt: number;
  /** Recent finished-day P&L results, most recent first. */
  history: HistoryEntry[];
  /** Last fire-and-forget history write; awaited by the history endpoint. */
  historyWrite: Promise<void>;
};

function pushLog(state: UserAutopilot, text: string, atMs = Date.now()) {
  state.logSeq += 1;
  state.logs.push({ id: `l${state.logSeq}`, time: nowClock(atMs), text });
  if (state.logs.length > MAX_LOGS) {
    state.logs.splice(0, state.logs.length - MAX_LOGS);
  }
}

function defaultUserState(bootAt: number): UserAutopilot {
  return {
    bots: DEFAULT_BOTS.map((b) => ({ ...b })),
    masterActive: true,
    selectedAsset: "Forex",
    todayPnl: 0,
    pnlDay: new Date(bootAt).toDateString(),
    logs: [],
    lastTickAt: bootAt,
    logSeq: 0,
    templateIndex: 0,
    lastPersistAt: 0,
    history: [],
    historyWrite: Promise.resolve(),
  };
}

// ---- Persistence (per user) ----------------------------------------------

async function persistBot(userId: string, bot: BotState): Promise<void> {
  await db
    .insert(autopilotBotsTable)
    .values({
      userId,
      botId: bot.id,
      running: bot.running,
      capital: bot.capital,
      drawdown: bot.drawdown,
    })
    .onConflictDoUpdate({
      target: [autopilotBotsTable.userId, autopilotBotsTable.botId],
      set: { running: bot.running, capital: bot.capital, drawdown: bot.drawdown },
    });
}

async function persistState(userId: string, state: UserAutopilot): Promise<void> {
  const values = {
    userId,
    masterActive: state.masterActive,
    selectedAsset: state.selectedAsset,
    todayPnl: state.todayPnl,
    pnlDay: state.pnlDay,
    logs: state.logs,
    lastTickAt: state.lastTickAt,
    logSeq: state.logSeq,
    templateIndex: state.templateIndex,
  };
  await db
    .insert(autopilotStateTable)
    .values(values)
    .onConflictDoUpdate({
      target: autopilotStateTable.userId,
      set: values,
    });
  state.lastPersistAt = Date.now();
}

/** Throttled background save so simulated P&L survives restarts too. */
function persistStateThrottled(userId: string, state: UserAutopilot): void {
  if (Date.now() - state.lastPersistAt < PERSIST_INTERVAL_MS) return;
  state.lastPersistAt = Date.now();
  persistState(userId, state).catch((err) => {
    logger.error({ err, userId }, "Failed to persist autopilot state");
  });
}

/**
 * Save a finished day's P&L into the user's in-memory history (most recent
 * first) and persist it. Called from the day-rollover in advanceSimulation,
 * which is synchronous, so the DB write is fire-and-forget with error
 * logging; the history endpoint awaits `state.historyWrite` before reading.
 */
function recordFinishedDay(
  userId: string,
  state: UserAutopilot,
  pnlDay: string,
  pnl: number,
): void {
  const dayIso = toIsoDay(pnlDay);
  const rounded = Math.round(pnl * 100) / 100;
  state.history = [
    { day: dayIso, pnl: rounded },
    ...state.history.filter((e) => e.day !== dayIso),
  ].slice(0, HISTORY_LIMIT);
  state.historyWrite = db
    .insert(autopilotPnlHistoryTable)
    .values({ userId, day: pnlDay, dayIso, pnl: rounded })
    .onConflictDoUpdate({
      target: [autopilotPnlHistoryTable.userId, autopilotPnlHistoryTable.dayIso],
      set: { day: pnlDay, pnl: rounded },
    })
    .then(
      () => undefined,
      (err: unknown) => {
        logger.error({ err, userId }, "Failed to persist autopilot P&L history");
      },
    );
}

/**
 * Load a user's persisted AutoPilot state, or seed (and persist) defaults
 * for a first-time user. Unknown bot rows are ignored; failure to load
 * surfaces as a request error instead of silently resetting state.
 */
async function loadUserState(userId: string): Promise<UserAutopilot> {
  // Captured synchronously so the simulation clock starts when the load
  // begins (e.g. at server boot for the anonymous seed), not when the DB
  // round-trip completes.
  const bootAt = Date.now();
  const [botRows, stateRows, historyRows] = await Promise.all([
    db
      .select()
      .from(autopilotBotsTable)
      .where(eq(autopilotBotsTable.userId, userId)),
    db
      .select()
      .from(autopilotStateTable)
      .where(eq(autopilotStateTable.userId, userId)),
    db
      .select()
      .from(autopilotPnlHistoryTable)
      .where(eq(autopilotPnlHistoryTable.userId, userId)),
  ]);
  const state = defaultUserState(bootAt);
  state.history = historyRows
    .map((row) => ({ day: row.dayIso, pnl: row.pnl }))
    .sort((a, b) => (a.day < b.day ? 1 : -1))
    .slice(0, HISTORY_LIMIT);
  for (const row of botRows) {
    const bot = state.bots.find((b) => b.id === row.botId);
    if (!bot) continue;
    bot.running = row.running;
    bot.capital = row.capital;
    bot.drawdown = row.drawdown;
  }
  const saved = stateRows[0];
  if (saved) {
    state.masterActive = saved.masterActive;
    state.selectedAsset =
      saved.selectedAsset === "Crypto" || saved.selectedAsset === "Stocks"
        ? saved.selectedAsset
        : "Forex";
    state.todayPnl = saved.todayPnl;
    state.pnlDay = saved.pnlDay;
    state.logs = saved.logs;
    state.lastTickAt = Math.max(saved.lastTickAt, Date.now() - 60_000);
    state.logSeq = saved.logSeq;
    state.templateIndex = saved.templateIndex;
    pushLog(state, "[SYS] AutoPilot state restored — resuming operations");
  } else {
    pushLog(state, "[SYS] TradiQs AutoPilot core initialized");
    pushLog(state, "[SYS] 2 algorithms deployed — monitoring 14 markets");
    await persistState(userId, state);
  }
  return state;
}

/**
 * Per-user AutoPilot state, keyed by the caller's auth identity. Values are
 * promises so concurrent first requests from one user share a single load.
 */
const users = new Map<string, Promise<UserAutopilot>>();

/**
 * Fetch (or lazily load) the caller's AutoPilot state. Re-inserting on
 * every access keeps the Map in most-recently-used order so eviction under
 * MAX_USERS pressure drops the least recently active user (their state is
 * persisted and reloads on next access).
 */
function stateFor(userId: string): Promise<UserAutopilot> {
  let entry = users.get(userId);
  if (entry) {
    users.delete(userId);
  } else {
    entry = loadUserState(userId);
    // A failed load must not be cached, or the user is stuck with the error.
    entry.catch(() => users.delete(userId));
    if (users.size >= MAX_USERS) {
      const oldest = users.keys().next().value;
      if (oldest !== undefined) users.delete(oldest);
    }
  }
  users.set(userId, entry);
  return entry;
}

// Seed the anonymous state at boot so its simulation clock starts with the
// server (matching pre-scoping behavior for signed-out callers). Errors are
// swallowed here; the first request will retry and surface them.
stateFor(ANONYMOUS).catch(() => {});

// ---- Simulation -----------------------------------------------------------

/**
 * Advance a user's simulation lazily: while the system is active and at
 * least one bot runs, every elapsed tick produces a log line and a P&L
 * increment that scales with deployed capital. P&L resets each day; the
 * finished day's result is recorded to the user's history.
 */
function advanceSimulation(userId: string, state: UserAutopilot): void {
  const now = Date.now();
  const today = new Date(now).toDateString();
  if (today !== state.pnlDay) {
    recordFinishedDay(userId, state, state.pnlDay, state.todayPnl);
    state.pnlDay = today;
    state.todayPnl = 0;
  }

  const runningBots = state.bots.filter((b) => b.running);
  if (!state.masterActive || runningBots.length === 0) {
    state.lastTickAt = now;
    return;
  }

  const deployed = runningBots.reduce((sum, b) => sum + b.capital, 0);
  const ticks = Math.min(
    Math.floor((now - state.lastTickAt) / TICK_MS),
    // Cap catch-up work after long idle periods.
    200,
  );
  for (let i = 0; i < ticks; i++) {
    const tickAt = state.lastTickAt + (i + 1) * TICK_MS;
    pushLog(
      state,
      LOG_TEMPLATES[state.templateIndex % LOG_TEMPLATES.length]!,
      tickAt,
    );
    state.templateIndex += 1;
    // Simulated per-tick P&L: mostly wins, occasional losses, sized to capital.
    const magnitude = deployed * 0.00012;
    const sign = state.templateIndex % 4 === 3 ? -0.6 : 1;
    const jitter = 0.5 + ((state.templateIndex * 7919) % 100) / 100;
    state.todayPnl += sign * magnitude * jitter;
  }
  if (ticks > 0) state.lastTickAt += ticks * TICK_MS;
}

function snapshot(userId: string, state: UserAutopilot) {
  advanceSimulation(userId, state);
  persistStateThrottled(userId, state);
  return GetAutopilotResponse.parse({
    masterActive: state.masterActive,
    selectedAsset: state.selectedAsset,
    todayPnl: Math.round(state.todayPnl * 100) / 100,
    bots: state.bots,
    logs: state.logs,
  });
}

/**
 * Stop any running Pro-only bot the caller is no longer entitled to.
 *
 * Checking entitlement only when a bot is started leaves a hole: a user who
 * subscribes, starts the Pro bot, then lapses would keep it running (and
 * accruing P&L) indefinitely, because nothing re-examines it afterwards.
 * This runs on every read and state change, so losing entitlement stops the
 * bot at the next interaction rather than never.
 *
 * Returns true when something was stopped, so callers can persist.
 */
async function enforceProEntitlement(
  userId: string,
  state: UserAutopilot,
  tierLookup?: TierLookup,
): Promise<boolean> {
  const runningPro = state.bots.filter((b) => b.proOnly && b.running);
  if (runningPro.length === 0) return false;
  if (await hasProAccess(userId, tierLookup)) return false;

  // Settle P&L earned while still entitled before switching the bot off.
  advanceSimulation(userId, state);
  for (const bot of runningPro) {
    bot.running = false;
    pushLog(
      state,
      `[SYS] ${bot.name} stopped — Elite subscription required to keep it running`,
    );
    logger.warn(
      { userId, botId: bot.id },
      "Stopped Pro-only bot after entitlement loss",
    );
  }
  return true;
}

/**
 * Revoke an Elite-only market preference as soon as the user loses Elite
 * access. The asset is persisted execution configuration, so merely hiding it
 * in the app would leave a replayed or restored Stocks selection in effect.
 */
async function enforceSelectedAssetEntitlement(
  userId: string,
  state: UserAutopilot,
  tierLookup?: TierLookup,
): Promise<boolean> {
  if (state.selectedAsset !== "Stocks") return false;
  if (await hasEliteAccess(userId, tierLookup)) return false;

  state.selectedAsset = "Forex";
  pushLog(
    state,
    "[SYS] Stocks execution market removed — Elite subscription required",
  );
  logger.warn(
    { userId },
    "Reset Elite-only AutoPilot asset after entitlement loss",
  );
  return true;
}

/** Persist the bots stopped by an entitlement revocation. */
async function persistStoppedPro(
  userId: string,
  state: UserAutopilot,
): Promise<void> {
  await Promise.all(
    state.bots.filter((b) => b.proOnly).map((bot) => persistBot(userId, bot)),
  );
  await persistState(userId, state);
}

// ---- Routes ----------------------------------------------------------------

/**
 * Build the AutoPilot router. The token verifier is injectable for tests;
 * production uses the default Supabase-backed verifier.
 *
 * @param assurance     - MFA assurance for write/mutation endpoints. Defaults
 *                        to `requireAal2IfMfaEnrolledWrite` in production
 *                        (definitive MFA rejections are enforced, but an AAL
 *                        service outage degrades to pass-through instead of
 *                        503 — see the middleware's policy doc), or a no-op
 *                        when a custom verifier is injected (tests).
 * @param readAssurance - Soft MFA assurance for read-only polling endpoints
 *                        (history). Passes through when AAL service is
 *                        unavailable so ordinary signed-in sessions are never
 *                        blocked by transient infrastructure issues.
 *                        Defaults to `requireAal2IfMfaEnrolledSoft` in
 *                        production, or a no-op in test mode.
 */
export function createAutopilotRouter(
  verifier?: TokenVerifier,
  tierLookup?: TierLookup,
  assurance?: RequestHandler,
  readAssurance?: RequestHandler,
): IRouter {
  const router: IRouter = Router();
  const testPassthrough: RequestHandler = (_req, _res, next) => next();
  const requireAssurance: RequestHandler =
    assurance ?? (verifier ? testPassthrough : requireAal2IfMfaEnrolledWrite);
  const requireReadAssurance: RequestHandler =
    readAssurance ?? (verifier ? testPassthrough : requireAal2IfMfaEnrolledSoft);
  router.use("/autopilot", identity(verifier));

  router.get("/autopilot", async (_req, res, next) => {
    try {
      const userId = requestUserId(res);
      if (userId === ANONYMOUS) {
        res.status(401).json({ error: "Sign in required." });
        return;
      }
      if (!(await hasProAccess(userId, tierLookup))) {
        res.status(403).json({ error: "AutoPilot requires a Pro or Elite subscription" });
        return;
      }
      const state = await stateFor(userId);
      const proRevoked = await enforceProEntitlement(userId, state, tierLookup);
      const assetRevoked = await enforceSelectedAssetEntitlement(userId, state, tierLookup);
      if (proRevoked) {
        await persistStoppedPro(userId, state);
      } else if (assetRevoked) {
        await persistState(userId, state);
      }
      res.json(snapshot(userId, state));
    } catch (err) {
      next(err);
    }
  });

  router.get("/autopilot/history", requireReadAssurance, async (_req, res, next) => {
    try {
      const userId = requestUserId(res);
      if (userId === ANONYMOUS) {
        res.status(401).json({ error: "Sign in required." });
        return;
      }
      if (!(await hasProAccess(userId, tierLookup))) {
        res.status(403).json({ error: "AutoPilot requires a Pro or Elite subscription" });
        return;
      }
      const state = await stateFor(userId);
      // This endpoint advances the simulation, so a lapsed user could keep
      // accruing Pro P&L here alone. Revoke before any time passes.
      const proRevoked = await enforceProEntitlement(userId, state, tierLookup);
      const assetRevoked = await enforceSelectedAssetEntitlement(userId, state, tierLookup);
      if (proRevoked) {
        await persistStoppedPro(userId, state);
      } else if (assetRevoked) {
        await persistState(userId, state);
      }
      advanceSimulation(userId, state);
      persistStateThrottled(userId, state);
      // Ensure a rollover triggered by this request has been persisted
      // before responding (write errors are already caught and logged).
      await state.historyWrite;
      res.json(GetAutopilotHistoryResponse.parse({ days: state.history }));
    } catch (err) {
      next(err);
    }
  });

  router.put("/autopilot/master", requireAssurance, async (req, res, next) => {
    const parsed = SetAutopilotMasterBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    try {
      const userId = requestUserId(res);
      const state = await stateFor(userId);
      // The anonymous state is a shared unauthenticated demo only; it never
      // represents a user's persisted execution engine. Authenticated users
      // must prove current Pro access before they can re-arm AutoPilot.
      if (
        parsed.data.active &&
        userId !== ANONYMOUS &&
        !(await hasProAccess(userId, tierLookup))
      ) {
        res.status(403).json({ error: "AutoPilot requires a Pro or Elite subscription" });
        return;
      }
      // Re-arming must not resurrect a Pro bot the user no longer pays for.
      await enforceProEntitlement(userId, state, tierLookup);
      await enforceSelectedAssetEntitlement(userId, state, tierLookup);
      advanceSimulation(userId, state);
      state.masterActive = parsed.data.active;
      state.lastTickAt = Date.now();
      pushLog(
        state,
        parsed.data.active
          ? "[SYS] AutoPilot resumed — all bots re-armed"
          : "[SYS] AutoPilot paused — halting new entries",
      );
      await persistState(userId, state);
      res.json(snapshot(userId, state));
    } catch (err) {
      next(err);
    }
  });

  router.put("/autopilot/asset", requireAssurance, async (req, res, next) => {
    const parsed = SetAutopilotAssetBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    try {
      const userId = requestUserId(res);
      const state = await stateFor(userId);
      if (await enforceSelectedAssetEntitlement(userId, state, tierLookup)) {
        await persistState(userId, state);
      }
      const canUseAsset =
        parsed.data.asset === "Stocks"
          ? await hasEliteAccess(userId, tierLookup)
          : await hasProAccess(userId, tierLookup);
      if (!canUseAsset) {
        res.status(403).json({
          error:
            parsed.data.asset === "Stocks"
              ? "Equities and Indices algorithm unlocked at Elite tier. Upgrade to Elite."
              : "AutoPilot requires a Pro or Elite subscription",
        });
        return;
      }
      state.selectedAsset = parsed.data.asset;
      pushLog(state, `[CFG] AutoPilot execution market set to ${state.selectedAsset}`);
      await persistState(userId, state);
      res.json(snapshot(userId, state));
    } catch (err) {
      next(err);
    }
  });

  router.put("/autopilot/bots/:botId", requireAssurance, async (req, res, next) => {
    const parsed = UpdateAutopilotBotBody.safeParse(req.body);
    try {
      const userId = requestUserId(res);
      const state = await stateFor(userId);
      const bot = state.bots.find((b) => b.id === req.params["botId"]);
      if (!bot) {
        res.status(404).json({ error: "Unknown bot" });
        return;
      }
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid request body" });
        return;
      }

      // Revoke first, for EVERY bot update. Gating only on `bot.proOnly`
      // would let a lapsed user tick a still-running Pro bot forward simply
      // by touching a free bot, and would 403 out of a request to stop the
      // Pro bot before revocation ever ran.
      const revoked = await enforceProEntitlement(userId, state, tierLookup);
      const assetRevoked = await enforceSelectedAssetEntitlement(userId, state, tierLookup);

      // Pro-only bots are gated on the server, not just hidden in the UI:
      // the client's tier is never trusted, and the check runs before any
      // state is mutated so a rejected request changes nothing. Stopping a
      // bot is always allowed — a user must be able to switch off something
      // they can no longer afford.
      const wantsToStart = parsed.data.running !== false;
      if (bot.proOnly && wantsToStart && !(await hasProAccess(userId, tierLookup))) {
        if (revoked) await persistStoppedPro(userId, state);
        else if (assetRevoked) await persistState(userId, state);
        logger.warn(
          { userId, botId: bot.id },
          "Blocked Pro-only bot update for a non-Pro user",
        );
        res.status(403).json({
          error: "This bot requires an Elite subscription",
          code: "pro_subscription_required",
        });
        return;
      }
      advanceSimulation(userId, state);
      const { running, capital, drawdown } = parsed.data;
      if (capital !== undefined || drawdown !== undefined) {
        if (capital !== undefined) bot.capital = capital;
        if (drawdown !== undefined) bot.drawdown = drawdown;
        pushLog(
          state,
          `[CFG] ${bot.name} reconfigured — $${bot.capital.toLocaleString()} capital, ${bot.drawdown}% max drawdown`,
        );
      }
      if (running !== undefined && running !== bot.running) {
        bot.running = running;
        pushLog(
          state,
          running
            ? `[BOT] ${bot.name} initialized with $${bot.capital.toLocaleString()} capital allocation`
            : `[BOT] ${bot.name} stopped — open positions managed to close`,
        );
      }
      await persistBot(userId, bot);
      await persistState(userId, state);
      res.json(snapshot(userId, state));
    } catch (err) {
      next(err);
    }
  });

  router.delete("/autopilot/logs", requireAssurance, async (_req, res, next) => {
    try {
      const userId = requestUserId(res);
      const state = await stateFor(userId);
      // Also advances the simulation; revoke first so clearing logs cannot be
      // used as a way to keep a lapsed Pro bot ticking.
      const proRevoked = await enforceProEntitlement(userId, state, tierLookup);
      const assetRevoked = await enforceSelectedAssetEntitlement(userId, state, tierLookup);
      if (proRevoked) await persistStoppedPro(userId, state);
      else if (assetRevoked) await persistState(userId, state);
      advanceSimulation(userId, state);
      state.logs = [];
      await persistState(userId, state);
      res.json(snapshot(userId, state));
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export default createAutopilotRouter();
