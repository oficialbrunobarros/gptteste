import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Engine } from "../strategy/engine";
import type { SimDb } from "../db/db";
import type { Feed } from "../feed/types";
import type { RiskManager } from "../risk/manager";
import type { LiveConfig } from "../config";
import { ageBucket, curveBucket, groupBy, jevBreakdown, summarize } from "../reports/metrics";
import { localDateStr } from "../risk/time";
import { logger } from "../logger";

export interface DashboardDeps { engine: Engine; db: SimDb; feed: Feed; risk: RiskManager; cfg: LiveConfig; solUsd: () => number; solSource: () => string }

export function buildState(d: DashboardDeps) {
  const now = Date.now();
  const cfg = d.cfg.current;
  const dayStart = new Date(localDateStr(now, cfg.risk.timezone) + "T00:00:00").getTime(); // aproximação local
  const all = d.db.positions({ status: "closed" });
  const today = all.filter((r) => (r.closed_at ?? 0) >= now - 86_400_000 && (r.closed_at ?? 0) >= dayStart - 86_400_000);
  const shadow = d.db.positions({ shadow: true, status: "closed" });
  const equity = d.db.equityCurve(now - 48 * 3_600_000, 3000);
  const solUsd = d.solUsd();
  const open = [...d.engine.positions.values()].map((p) => ({ id: p.id, mint: p.mint, symbol: p.symbol, name: p.name, shadow: p.shadow, solSpent: p.solSpent, tokens: p.tokens, heldSec: (now - p.openedAt) / 1000, netPct: p.lastNetPct, peakNetPct: Number.isFinite(p.peakNetPct) ? p.peakNetPct : null, exitPending: p.exitPending }));
  return {
    now, solUsd, solSource: d.solSource(), risk: d.risk.snapshot(), feed: d.feed.status(), engine: d.engine.getStats(),
    total: summarize(all, equity), today: summarize(today),
    open, recent: all.slice(0, 50).map((r) => ({ id: r.id, symbol: r.symbol, mint: r.mint, opened_at: r.opened_at, closed_at: r.closed_at, exit_reason: r.exit_reason, pnl_net_sol: r.pnl_net_sol, pnl_net_usd: r.pnl_net_usd, pnl_net_pct: r.pnl_net_pct, duration_sec: r.duration_sec, jev: r.jev ? JSON.parse(r.jev) : null })),
    byReason: groupBy(all, (r) => r.exit_reason ?? "?"), byAge: groupBy(all, (_r, f) => ageBucket(f)), byCurve: groupBy(all, (_r, f) => curveBucket(f)),
    jev: jevBreakdown(all, shadow), equity, events: d.db.events(30),
    config: { entry: cfg.entry, exit: cfg.exit, costs: cfg.costs, risk: { positionUsd: cfg.risk.positionUsd, dailyLossLimitUsd: cfg.risk.dailyLossLimitUsd }, jevEnabled: d.engine.jevEnabled },
    pending: d.engine.pendingOrders().map((o) => ({ mint: o.mint, side: "solIn" in o ? "buy" : "sell", decidedAt: o.decidedAt, shadow: o.shadow })),
  };
}

export function startDashboard(d: DashboardDeps, port: number): { close: () => Promise<void> } {
  const app = express();
  const here = path.dirname(fileURLToPath(import.meta.url));
  const htmlPath = path.join(here, "index.html");
  app.get("/", (_req, res) => { res.type("html").send(fs.readFileSync(htmlPath, "utf8")); });
  app.get("/favicon.ico", (_req, res) => { res.status(204).end(); });
  app.get("/api/state", (_req, res) => {
    try { res.json(buildState(d)); } catch (err) { logger.error({ err }, "erro ao montar estado do painel"); res.status(500).json({ error: String(err) }); }
  });
  app.get("/api/health", (_req, res) => { res.json({ ok: true, feed: d.feed.status() }); });
  const server = app.listen(port, () => logger.info({ url: `http://localhost:${port}` }, "painel disponível"));
  return { close: () => new Promise((r) => server.close(() => r())) };
}
