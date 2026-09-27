import type { EquityRow, PositionRow } from "../db/db";
import type { FeatureSnapshot } from "../features/tokenState";

export interface Summary {
  n: number; wins: number; losses: number; winRate: number;
  netSol: number; netUsd: number; grossProfitSol: number; grossLossSol: number; profitFactor: number;
  avgWinPct: number; avgLossPct: number; expectancyPct: number; avgDurationSec: number;
  tradesPerHour: number; pnlPerHourUsd: number; spanHours: number; totalCostsSol: number; maxDrawdownPct: number;
}

export function summarize(rows: PositionRow[], equity: EquityRow[] = []): Summary {
  const closed = rows.filter((r) => r.status === "closed" && r.pnl_net_sol !== null);
  const n = closed.length;
  const wins = closed.filter((r) => (r.pnl_net_sol ?? 0) > 0);
  const losses = closed.filter((r) => (r.pnl_net_sol ?? 0) <= 0);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const gp = sum(wins.map((r) => r.pnl_net_sol!));
  const gl = -sum(losses.map((r) => r.pnl_net_sol!));
  const first = n ? Math.min(...closed.map((r) => r.opened_at)) : 0;
  const last = n ? Math.max(...closed.map((r) => r.closed_at!)) : 0;
  const spanHours = n ? Math.max((last - first) / 3_600_000, 1 / 60) : 0;
  const netUsd = sum(closed.map((r) => r.pnl_net_usd ?? 0));
  return {
    n, wins: wins.length, losses: losses.length, winRate: n ? wins.length / n : 0,
    netSol: gp - gl, netUsd, grossProfitSol: gp, grossLossSol: gl, profitFactor: gl > 0 ? gp / gl : gp > 0 ? Infinity : 0,
    avgWinPct: wins.length ? sum(wins.map((r) => r.pnl_net_pct!)) / wins.length : 0,
    avgLossPct: losses.length ? sum(losses.map((r) => r.pnl_net_pct!)) / losses.length : 0,
    expectancyPct: n ? sum(closed.map((r) => r.pnl_net_pct!)) / n : 0,
    avgDurationSec: n ? sum(closed.map((r) => r.duration_sec ?? 0)) / n : 0,
    tradesPerHour: spanHours ? n / spanHours : 0, pnlPerHourUsd: spanHours ? netUsd / spanHours : 0, spanHours,
    totalCostsSol: sum(closed.map((r) => r.cost_curve_fee + r.cost_exec_fee + r.cost_network_fee + r.cost_penalty)),
    maxDrawdownPct: equity.length ? maxDrawdownFromEquity(equity) : maxDrawdownFromPnl(closed),
  };
}

export function maxDrawdownFromEquity(eq: EquityRow[]): number {
  let peak = -Infinity, mdd = 0;
  for (const e of eq) { peak = Math.max(peak, e.equity_sol); if (peak > 0) mdd = Math.max(mdd, ((peak - e.equity_sol) / peak) * 100); }
  return mdd;
}

/** Drawdown sobre a curva de PnL acumulado (quando não há curva de patrimônio). */
export function maxDrawdownFromPnl(closed: PositionRow[], startEquitySol = 1): number {
  const sorted = [...closed].sort((a, b) => (a.closed_at ?? 0) - (b.closed_at ?? 0));
  let eq = startEquitySol, peak = eq, mdd = 0;
  for (const r of sorted) { eq += r.pnl_net_sol ?? 0; peak = Math.max(peak, eq); mdd = Math.max(mdd, ((peak - eq) / peak) * 100); }
  return mdd;
}

export interface Bucket { key: string; n: number; winRate: number; netSol: number; avgPct: number }

export function groupBy(rows: PositionRow[], keyFn: (r: PositionRow, f: FeatureSnapshot) => string): Bucket[] {
  const m = new Map<string, PositionRow[]>();
  for (const r of rows) {
    if (r.status !== "closed") continue;
    const f = parseFeatures(r);
    const k = keyFn(r, f);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  return [...m.entries()].map(([key, rs]) => {
    const s = summarize(rs);
    return { key, n: s.n, winRate: s.winRate, netSol: s.netSol, avgPct: s.expectancyPct };
  }).sort((a, b) => a.key.localeCompare(b.key));
}

export function parseFeatures(r: PositionRow): FeatureSnapshot {
  try { return JSON.parse(r.features) as FeatureSnapshot; } catch { return {} as FeatureSnapshot; }
}

export const ageBucket = (f: FeatureSnapshot): string => {
  const a = f.ageSec ?? 0;
  return a < 60 ? "0-60s" : a < 180 ? "60-180s" : a < 300 ? "180-300s" : a < 600 ? "300-600s" : ">600s";
};
export const curveBucket = (f: FeatureSnapshot): string => {
  const c = f.curvePct ?? 0;
  return c < 10 ? "<10%" : c < 20 ? "10-20%" : c < 35 ? "20-35%" : c < 60 ? "35-60%" : ">60%";
};

/** Médias das features em ganhadoras × perdedoras, para ver quais filtros separam. */
export function featureComparison(rows: PositionRow[]): Array<{ feature: string; winners: number; losers: number; diffPct: number }> {
  const closed = rows.filter((r) => r.status === "closed");
  const pick: Array<[string, (f: FeatureSnapshot) => number]> = [
    ["idade (s)", (f) => f.ageSec], ["% curva", (f) => f.curvePct], ["compradores únicos 60s", (f) => f.w60?.uniqueBuyers],
    ["razão compra/venda 60s", (f) => Math.min(f.w60?.buySellRatio ?? 0, 50)], ["volume compra 60s (SOL)", (f) => f.w60?.buyVolSol],
    ["top-10 %", (f) => f.top10Pct], ["top-1 %", (f) => f.top1Pct], ["detentores", (f) => f.holders],
    ["criador comprou (SOL)", (f) => f.creatorBoughtSol], ["criador detém %", (f) => f.creatorHoldsPct],
    ["var. preço 10s %", (f) => f.priceChg10sPct], ["var. preço 60s %", (f) => f.priceChg60sPct], ["maior queda 60s %", (f) => f.maxDrawdown60sPct],
    ["compras de bundle", (f) => f.bundleBuys], ["trades totais", (f) => f.totalTrades],
  ];
  const w = closed.filter((r) => (r.pnl_net_sol ?? 0) > 0).map(parseFeatures);
  const l = closed.filter((r) => (r.pnl_net_sol ?? 0) <= 0).map(parseFeatures);
  const avg = (fs: FeatureSnapshot[], fn: (f: FeatureSnapshot) => number) => { const v = fs.map(fn).filter((x) => Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };
  return pick.map(([feature, fn]) => { const a = avg(w, fn), b = avg(l, fn); return { feature, winners: a, losers: b, diffPct: b !== 0 ? ((a - b) / Math.abs(b)) * 100 : a !== 0 ? 100 : 0 }; });
}

export function jevBreakdown(real: PositionRow[], shadow: PositionRow[]): Array<{ group: string; s: Summary }> {
  const closedReal = real.filter((r) => r.status === "closed");
  return [
    { group: "sem Jev (filtro desligado)", s: summarize(closedReal.filter((r) => r.jev === null)) },
    { group: "com Jev (aprovadas)", s: summarize(closedReal.filter((r) => r.jev !== null)) },
    { group: "sombra (vetadas pelo Jev, não operadas)", s: summarize(shadow.filter((r) => r.status === "closed")) },
  ];
}
