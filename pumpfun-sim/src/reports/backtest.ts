/**
 * Replay dos dados gravados (tokens + trades_observed) com uma grade de parâmetros.
 * Uso: npm run backtest-params [-- --days 7 --top 10]
 * AVISO: escolher os melhores parâmetros no mesmo período em que foram medidos SOBREAJUSTA.
 */
import "dotenv/config";
import { loadConfig, type Config } from "../config";
import { SimDb, type TokenRow, type TradeRow } from "../db/db";
import { Engine } from "../strategy/engine";
import { PaperExecutor, costsFromConfig } from "../executor/PaperExecutor";
import { RiskManager } from "../risk/manager";
import { ReplayFeed } from "../feed/replay";
import { summarize, type Summary } from "./metrics";
import type { NewTokenMsg, TradeMsg } from "../feed/schemas";
import { logger } from "../logger";

type Ev = { ts: number; kind: "create"; t: TokenRow } | { ts: number; kind: "trade"; t: TradeRow };

export function loadEvents(db: SimDb, sinceTs: number): Ev[] {
  const tokens = db.tokens(sinceTs);
  const trades = db.tradesFor(null, sinceTs);
  const evs: Ev[] = [];
  for (const t of tokens) evs.push({ ts: t.created_at, kind: "create", t });
  for (const t of trades) evs.push({ ts: t.ts, kind: "trade", t });
  evs.sort((a, b) => a.ts - b.ts || (a.kind === "create" ? -1 : 1));
  return evs;
}

export interface ParamSet { takeProfitPct: number; stopLossPct: number; maxHoldSec: number; minUniqueBuyers60s: number; minCurvePct: number }

export function runReplay(base: Config, params: Partial<ParamSet>, evs: Ev[], solUsd: number): { s: Summary; params: Partial<ParamSet> } {
  const cfg: Config = structuredClone(base);
  cfg.exit = { ...cfg.exit, ...pickKeys(params, ["takeProfitPct", "stopLossPct", "maxHoldSec"]) };
  cfg.entry = { ...cfg.entry, ...pickKeys(params, ["minUniqueBuyers60s", "minCurvePct"]) };
  cfg.feed.maxWatched = 100000; // no replay observamos tudo o que foi gravado
  const db = new SimDb(":memory:");
  const feed = new ReplayFeed();
  const startTs = evs[0]?.ts ?? Date.now();
  const risk = new RiskManager(cfg, () => solUsd, cfg.risk.bankrollUsd / solUsd, startTs);
  const executor = new PaperExecutor((m) => engine.curveState(m), costsFromConfig(cfg));
  const engine: Engine = new Engine({ cfg: () => cfg, feed, db, executor, risk, jev: null, solUsd: () => solUsd }, { replay: true });
  // relógio virtual: reproduz o timer de 250 ms do modo real (execuções e saídas por tempo)
  let lastTick = (evs[0]?.ts ?? 0) - 250;
  for (const e of evs) {
    while (lastTick + 250 <= e.ts) { lastTick += 250; engine.tick(lastTick); }
    if (e.kind === "create") {
      const m: NewTokenMsg = { mint: e.t.mint, traderPublicKey: e.t.creator, txType: "create", initialBuy: e.t.initial_buy, solAmount: e.t.creator_sol, vSolInBondingCurve: e.t.v_sol0, vTokensInBondingCurve: e.t.v_tokens0, name: e.t.name, symbol: e.t.symbol, uri: e.t.uri };
      engine.onNewToken(m, e.ts);
    } else {
      const m: TradeMsg = { mint: e.t.mint, traderPublicKey: e.t.trader, txType: e.t.side, tokenAmount: e.t.tokens, solAmount: e.t.sol, vSolInBondingCurve: e.t.v_sol, vTokensInBondingCurve: e.t.v_tokens, ...(e.t.new_balance !== null ? { newTokenBalance: e.t.new_balance } : {}) };
      engine.onTrade(m, e.ts);
    }
  }
  const end = (evs[evs.length - 1]?.ts ?? startTs) + 1;
  engine.tick(end);
  engine.closeAll(end);
  const s = summarize(db.positions({ status: "closed" }), db.equityCurve());
  db.close();
  return { s, params };
}

function pickKeys<T extends object>(o: Partial<T>, keys: (keyof T)[]): Partial<T> {
  const r: Partial<T> = {};
  for (const k of keys) if (o[k] !== undefined) r[k] = o[k];
  return r;
}

export function* grid(g: Config["backtest"]["grid"]): Generator<ParamSet> {
  for (const takeProfitPct of g.takeProfitPct) for (const stopLossPct of g.stopLossPct) for (const maxHoldSec of g.maxHoldSec)
    for (const minUniqueBuyers60s of g.minUniqueBuyers60s) for (const minCurvePct of g.minCurvePct)
      yield { takeProfitPct, stopLossPct, maxHoldSec, minUniqueBuyers60s, minCurvePct };
}

const isMain = process.argv[1]?.endsWith("backtest.ts");
if (isMain) {
  logger.level = process.env.LOG_LEVEL ?? "warn"; // silencia os logs do motor durante o replay
  const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] ?? d : d; };
  const cfg = loadConfig();
  const db = new SimDb(cfg.db.path);
  const days = Number(arg("days", String(cfg.db.tradesRetentionDays)));
  const top = Number(arg("top", "10"));
  const evs = loadEvents(db, Date.now() - days * 86_400_000);
  const nTokens = evs.filter((e) => e.kind === "create").length;
  console.log(`replay de ${nTokens} moedas e ${evs.length - nTokens} trades dos últimos ${days} dias`);
  if (evs.length === 0) { console.log("sem dados gravados; rode o simulador primeiro (npm start)"); process.exit(0); }
  const solUsd = Number(db.kvGet("sol_usd") ?? cfg.risk.solPriceFallbackUsd);
  const baseline = runReplay(cfg, {}, evs, solUsd);
  console.log(`\nBASELINE (config.yaml atual): n=${baseline.s.n} acerto=${(baseline.s.winRate * 100).toFixed(1)}% PnL=${baseline.s.netSol.toFixed(5)} SOL PF=${baseline.s.profitFactor.toFixed(2)} DD=${baseline.s.maxDrawdownPct.toFixed(1)}%`);
  const results: Array<{ s: Summary; params: Partial<ParamSet> }> = [];
  let i = 0; const combos = [...grid(cfg.backtest.grid)];
  const t0 = Date.now();
  for (const p of combos) {
    results.push(runReplay(cfg, p, evs, solUsd));
    if (++i % 20 === 0) process.stdout.write(`  ${i}/${combos.length} combinações (${((Date.now() - t0) / 1000).toFixed(0)}s)\r`);
  }
  results.sort((a, b) => b.s.netSol - a.s.netSol);
  console.log(`\n\nTOP ${top} de ${combos.length} combinações (ordenado por PnL líquido em SOL):\n`);
  console.log("| TP% | SL% | Hold s | Buyers60 | Curva mín % | N | Acerto | PnL SOL | PF | DD% |");
  console.log("|---|---|---|---|---|---|---|---|---|---|");
  for (const r of results.slice(0, top)) {
    const p = r.params as ParamSet;
    console.log(`| ${p.takeProfitPct} | ${p.stopLossPct} | ${p.maxHoldSec} | ${p.minUniqueBuyers60s} | ${p.minCurvePct} | ${r.s.n} | ${(r.s.winRate * 100).toFixed(1)}% | ${r.s.netSol.toFixed(5)} | ${Number.isFinite(r.s.profitFactor) ? r.s.profitFactor.toFixed(2) : "∞"} | ${r.s.maxDrawdownPct.toFixed(1)} |`);
  }
  console.log(`
⚠️  RISCO DE SOBREAJUSTE: estes parâmetros foram escolhidos olhando para o MESMO período em que foram avaliados.
   Com poucas operações (N pequeno) a melhor combinação é em grande parte sorte. Antes de adotar:
   - exija N ≥ 100 operações e melhora consistente em dias diferentes (valide em dados que o ajuste não viu);
   - prefira combinações vizinhas também boas (planalto), não picos isolados;
   - lembre-se de que o replay usa só os trades das moedas que ENTRARAM em observação (viés de seleção).`);
  db.close();
}
