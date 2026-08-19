import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

let server: Server;
let baseUrl: string;

async function startFreshApp(): Promise<void> {
  // Follow the autopilot test pattern: fresh module import per test.
  vi.resetModules();
  vi.doMock("@supabase/supabase-js", () => ({
    createClient: () => ({
      from: () => ({
        select: () => ({
          order: async () => ({
            data: [
              {
                id: "s1",
                pair: "XAUUSD",
                asset_class: "Metals",
                action: "BUY",
                status: "Active",
                risk_reward: 3.2,
                entry: 2412.5,
                stop_loss: 2402.5,
                take_profits: [{ price: 2422.5, hit: false }],
                timestamp: "2026-08-19T10:00:00.000Z",
                pips: 100,
              },
            ],
            error: null,
          }),
        }),
      }),
    }),
  }));
  const { createSignalsRouter } = await import("./signals");
  const app: Express = express();
  app.use(express.json());
  app.use(
    createSignalsRouter(
      async (token) => {
        if (token === "test-pro") return "paid-user";
        if (token === "test-starter") return "starter-user";
        return null;
      },
      async (userId) => (userId === "paid-user" ? "pro" : "starter"),
    ),
  );
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const { address, port } = server.address() as AddressInfo;
  baseUrl = `http://${address}:${port}`;
}

async function request(
  method: string,
  path: string,
  token = "test-pro",
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

beforeEach(async () => {
  vi.stubEnv("SUPABASE_URL", "https://example.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role");
  await startFreshApp();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.doUnmock("@supabase/supabase-js");
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

describe("GET /signals", () => {
  it("rejects callers without an authenticated session", async () => {
    const { status, body } = await request("GET", "/signals", "");
    expect(status).toBe(401);
    expect(body).toEqual({ error: "Sign in required." });
  });

  it("returns a schema-valid list of signals", async () => {
    const { status, body } = await request("GET", "/signals");
    expect(status).toBe(200);
    expect(body).toEqual([
      expect.objectContaining({
        id: "s1",
        pair: "XAUUSD",
        entry: 2412.5,
        stopLoss: 2402.5,
      }),
    ]);
  });

  it("includes the expected seeded signals with unique ids", async () => {
    const { body } = await request("GET", "/signals");
    const ids = body.map((s: any) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("s1");
    const gold = body.find((s: any) => s.id === "s1");
    expect(gold.pair).toBe("XAUUSD");
    expect(gold.action).toBe("BUY");
    expect(gold.takeProfits).toHaveLength(1);
  });

  it("is stable across repeated requests", async () => {
    const first = await request("GET", "/signals");
    const second = await request("GET", "/signals");
    expect(second.body).toEqual(first.body);
  });

  it("redacts exact price and risk data for Starter users", async () => {
    const { status, body } = await request("GET", "/signals", "test-starter");
    expect(status).toBe(200);
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]).toMatchObject({
      entry: "LOCKED",
      stopLoss: "LOCKED",
      riskReward: "LOCKED",
      takeProfits: [],
      pips: "LOCKED",
      redacted: true,
    });
  });

  it("returns 404 for unknown paths and methods without handlers", async () => {
    expect((await request("GET", "/signals/s1")).status).toBe(404);
    expect((await request("POST", "/signals")).status).toBe(404);
  });
});
