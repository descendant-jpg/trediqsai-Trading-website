import { hasEliteAccess, hasProAccess, type TierLookup } from "./entitlement";
import { logger } from "./logger";

const SUPABASE_URL =
  process.env["SUPABASE_URL"] ?? process.env["EXPO_PUBLIC_SUPABASE_URL"] ?? "";
const SERVICE_ROLE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";

export type AiQuotaTier = "starter" | "pro" | "elite";

type DailyBudget = {
  requests: number;
  outputTokens: number;
};

const DAILY_BUDGETS: Record<AiQuotaTier, DailyBudget> = {
  starter: { requests: 12, outputTokens: 4_000 },
  pro: { requests: 100, outputTokens: 75_000 },
  elite: { requests: 300, outputTokens: 225_000 },
};

export type AiQuotaResult =
  | { allowed: true; tier: AiQuotaTier }
  | { allowed: false; tier: AiQuotaTier; reason: "quota_exhausted" | "pro_required" };

function isQuotaConfigured(): boolean {
  return Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);
}

async function resolveTier(userId: string, lookup?: TierLookup): Promise<AiQuotaTier> {
  if (await hasEliteAccess(userId, lookup)) return "elite";
  if (await hasProAccess(userId, lookup)) return "pro";
  return "starter";
}

/**
 * Atomically reserve an upper bound of output tokens before an LLM call.
 *
 * Reservations intentionally charge the route's maximum output size instead
 * of reconciling after completion. This is conservative, but it prevents a
 * provider timeout or a crashed process from becoming an unmetered response
 * and guarantees the configured daily ceiling is never exceeded.
 */
export async function reserveAiQuota(
  userId: string,
  scope: string,
  reservedOutputTokens: number,
  options: { tierLookup?: TierLookup; requiresPro?: boolean } = {},
): Promise<AiQuotaResult> {
  const tier = await resolveTier(userId, options.tierLookup);
  if (options.requiresPro && tier === "starter") {
    return { allowed: false, tier, reason: "pro_required" };
  }

  if (!isQuotaConfigured()) {
    throw new Error("AI quota service is not configured.");
  }

  const budget = DAILY_BUDGETS[tier];
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/consume_ai_daily_quota`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      p_user_id: userId,
      p_scope: scope,
      p_request_limit: budget.requests,
      p_output_token_limit: budget.outputTokens,
      p_reserved_output_tokens: reservedOutputTokens,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    logger.error(
      { userId, scope, status: response.status, detail },
      "AI quota reservation failed",
    );
    throw new Error("AI quota reservation failed.");
  }

  const result = (await response.json()) as { allowed?: unknown };
  if (result.allowed !== true) {
    return { allowed: false, tier, reason: "quota_exhausted" };
  }

  return { allowed: true, tier };
}