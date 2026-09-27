import { describe, expect, it } from "vitest";
import { Engine } from "../src/strategy/engine";
import { PaperExecutor, costsFromConfig } from "../src/executor/PaperExecutor";
import { RiskManager } from "../src/risk/manager";
import { SimDb } from "../src/db/db";
import { ReplayFeed } from "../src/feed/replay";
import { SyntheticFeed } from "../src/feed/synthetic";
import { testConfig } from "./helpers";
import { MiniMarket, newTokenMsg } from "./helpers";

function build(cfgOver: Parameters<typeof testConfig>[0] = {}) {
  const cfg = testConfig(cfgOver);
  const db = new SimDb(":memory:");
  const feed = new ReplayFeed();
  const risk = new RiskManager(cfg, () => 100, 1, 0);
  const executor = new PaperExecutor((m) => engine.curveState(m), costsFromConfig(cfg));
  const engine: Engine = new Engine({ cfg: () => cfg, feed, db, executor, risk, jev: null, solUsd: () => 100 }, { replay: true });
  return { cfg, db, feed, risk, engine, executor };
}

describe("Engine (determinístico)", () => {
  it("entra quando os filtros passam, respeita a latência e sai no alvo", () => {
    const { engine, db, risk } = build({ entry: { minAgeSec: 5, minUniqueBuyers60s: 5, minCurvePct: 0.5, maxTop10Pct: 100 }, exit: { takeProfitPct: 10, stopLossPct: 8, maxHoldSec: 600 } });
    const t0 = 1_000_000;
    const { msg, state } = newTokenMsg("M", "DEV", 0.2, t0);
    engine.onNewToken(msg, t0);
    const mk = new MiniMarket(state);
    let t = t0 + 6000;
    for (let i = 0; i < 12; i++) { engine.onTrade(mk.buy("B" + i, 0.3), t); t += 700; }
    expect(engine.getStats().entriesSubmitted).toBe(1);
    engine.tick(t + 1500);
    expect(engine.positions.size).toBe(1);
    const p = [...engine.positions.values()][0]!;
    // executou só depois da latência configurada (1500 ms)
    expect(p.openedAt - p.decidedAt).toBeGreaterThanOrEqual(1500);
    expect(p.solSpent).toBeCloseTo(0.08 + 0.0005, 9);
    expect(risk.bankrollSol).toBeCloseTo(1 - p.solSpent, 9);
    expect(db.positions({ status: "open" })).toHaveLength(1);
    // o preço sobe bem => alvo
    t += 2000;
    for (let i = 0; i < 20; i++) { engine.onTrade(mk.buy("C" + i, 0.5), t); t += 500; }
    engine.tick(t + 2000);
    const closed = db.positions({ status: "closed" });
    expect(closed.length).toBeGreaterThanOrEqual(1);
    const first = closed[closed.length - 1]!;
    expect(first.exit_reason).toBe("take_profit");
    expect(first.pnl_net_pct!).toBeGreaterThanOrEqual(10);
    // depois de fechar, a moeda pode ser reentrada se os filtros continuarem passando
    engine.closeAll(t + 3000);
    const all = db.positions({ status: "closed" });
    const sum = all.reduce((a, r) => a + (r.pnl_net_sol ?? 0), 0);
    expect(risk.bankrollSol).toBeCloseTo(1 + sum, 9);
    expect(sum).toBeGreaterThan(0);
    expect(engine.getStats().rejections["unique_buyers_60s"]).toBeGreaterThan(0);
  });

  it("stop loss e saída por criador vendendo", () => {
    const { engine, db } = build({ entry: { minAgeSec: 1, minUniqueBuyers60s: 3, minCurvePct: 0.5, maxTop10Pct: 100 }, exit: { takeProfitPct: 50, stopLossPct: 8, maxHoldSec: 600 } });
    const t0 = 0;
    const { msg, state } = newTokenMsg("M", "DEV", 1, t0);
    engine.onNewToken(msg, t0);
    const mk = new MiniMarket(state); mk.balances.set("DEV", msg.initialBuy!);
    let t = 2000;
    for (let i = 0; i < 6; i++) { engine.onTrade(mk.buy("B" + i, 0.5), t); t += 500; }
    engine.tick(t + 1500);
    expect(engine.positions.size).toBe(1);
    engine.onTrade(mk.sell("DEV", msg.initialBuy!), t + 2000);
    engine.tick(t + 4000);
    const closed = db.positions({ status: "closed" });
    expect(closed).toHaveLength(1);
    expect(["creator_sold", "stop_loss"]).toContain(closed[0]!.exit_reason);
    expect(closed[0]!.pnl_net_sol!).toBeLessThan(0);
  });

  it("tempo máximo, migração com penalidade e encerramento gracioso", () => {
    const { engine, db } = build({ entry: { minAgeSec: 1, minUniqueBuyers60s: 3, minCurvePct: 0.5, maxTop10Pct: 100, maxOpenPositions: 4 }, exit: { takeProfitPct: 50, stopLossPct: 50, maxHoldSec: 30 } });
    const { msg, state } = newTokenMsg("M", "DEV", 0.1, 0);
    engine.onNewToken(msg, 0);
    const mk = new MiniMarket(state);
    let t = 2000;
    for (let i = 0; i < 5; i++) { engine.onTrade(mk.buy("B" + i, 0.3), t); t += 500; }
    engine.tick(t + 1500);
    expect(engine.positions.size).toBe(1);
    engine.tick(t + 1500 + 31_000);          // decide sair por tempo
    engine.tick(t + 1500 + 31_000 + 1500);   // executa
    expect(db.positions({ status: "closed" })[0]!.exit_reason).toBe("max_hold");
    // segunda moeda: migra com posição aberta
    const { msg: m2, state: s2 } = newTokenMsg("N", "DEV2", 0.1, t);
    engine.onNewToken(m2, t);
    const mk2 = new MiniMarket(s2);
    let u = t + 2000;
    for (let i = 0; i < 5; i++) { engine.onTrade(mk2.buy("Z" + i, 0.3, "N"), u); u += 500; }
    engine.tick(u + 1500);
    expect(engine.positions.size).toBe(1);
    engine.onMigration({ mint: "N", txType: "migrate" }, u + 2000);
    const mig = db.positions({ status: "closed" }).find((r) => r.mint === "N")!;
    expect(mig.exit_reason).toBe("migration");
    expect(mig.cost_penalty).toBeGreaterThan(0);
    // terceira: fica aberta e o encerramento fecha
    const { msg: m3, state: s3 } = newTokenMsg("O", "DEV3", 0.1, u);
    engine.onNewToken(m3, u);
    const mk3 = new MiniMarket(s3);
    let v = u + 2000;
    for (let i = 0; i < 5; i++) { engine.onTrade(mk3.buy("Q" + i, 0.3, "O"), v); v += 500; }
    engine.tick(v + 1500);
    expect(engine.positions.size).toBe(1);
    engine.closeAll(v + 2000);
    expect(engine.positions.size).toBe(0);
    expect(db.positions({ status: "closed" }).find((r) => r.mint === "O")!.exit_reason).toBe("shutdown");
    expect(db.equityCurve().length).toBeGreaterThan(0);
  });

  it("filtros rejeitam: bundle forte, criador vendeu, top-10 concentrado", () => {
    const { engine } = build({ entry: { minAgeSec: 1, minUniqueBuyers60s: 3, minCurvePct: 0.5 } });
    const { msg, state } = newTokenMsg("M", "DEV", 0.1, 0);
    engine.onNewToken(msg, 0);
    const mk = new MiniMarket(state);
    for (let i = 0; i < 7; i++) engine.onTrade(mk.buy("BOT" + i, 0.5), 100 + i * 50);
    engine.onTrade(mk.buy("X", 0.1), 3000);
    engine.tick(5000);
    const s = engine.getStats();
    expect(s.rejections["bundle_strong"]).toBeGreaterThan(0);
    expect(s.entriesSubmitted).toBe(0);
  });

  it("maxWatched descarta as mais antigas/inativas", () => {
    const { engine, feed } = build({ feed: { maxWatched: 3 } });
    for (let i = 0; i < 5; i++) engine.onNewToken(newTokenMsg("T" + i, "D", 0, i).msg, i * 1000);
    expect(engine.tokens.size).toBe(3);
    expect(engine.tokens.has("T0")).toBe(false);
    expect(engine.tokens.has("T4")).toBe(true);
    expect(feed.status().subscribedMints).toBe(3);
  });
});

describe("Engine + SyntheticFeed (ponta a ponta com tempo virtual)", () => {
  it("abre e fecha operações a partir do gerador sintético", async () => {
    const cfg = testConfig({ entry: { minAgeSec: 10, minUniqueBuyers60s: 6, minCurvePct: 2, maxTop10Pct: 80 }, exit: { maxHoldSec: 120 }, feed: { maxWatched: 50 } });
    const db = new SimDb(":memory:");
    const feed = new SyntheticFeed({ seed: 7, newTokenEveryMs: 2000, speed: 1 });
    const risk = new RiskManager(cfg, () => 100, 1, 0);
    const executor = new PaperExecutor((m) => engine.curveState(m), costsFromConfig(cfg));
    const engine: Engine = new Engine({ cfg: () => cfg, feed, db, executor, risk, jev: null, solUsd: () => 100 }, { replay: true });
    let now = 0;
    feed.on("newToken", (m, _r) => engine.onNewToken(m, now));
    feed.on("trade", (m, _r) => engine.onTrade(m, now));
    feed.on("migration", (m, _r) => engine.onMigration(m, now));
    (feed as any).running = true; (feed as any).simNow = 0; (feed as any).nextTokenAt = 500;
    // 20 minutos virtuais em passos de 250ms
    for (now = 0; now < 20 * 60_000; now += 250) { feed.step(now); engine.tick(now); }
    engine.closeAll(now);
    const s = engine.getStats();
    expect(s.tokensSeen).toBeGreaterThan(50);
    expect(s.tradesSeen).toBeGreaterThan(500);
    const closed = db.positions({ status: "closed" });
    expect(closed.length).toBeGreaterThan(3);
    const reasons = new Set(closed.map((r) => r.exit_reason));
    expect(reasons.size).toBeGreaterThan(1);
    // contabilidade: banca final = inicial + soma dos PnL líquidos
    const sum = closed.reduce((a, r) => a + (r.pnl_net_sol ?? 0), 0);
    expect(risk.bankrollSol).toBeCloseTo(1 + sum, 9);
    db.close();
  });
});
