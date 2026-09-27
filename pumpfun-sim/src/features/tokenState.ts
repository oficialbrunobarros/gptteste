/**
 * Estado por moeda: reconstrói detentores, comportamento do criador, janelas de volume,
 * velocidade de preço e sinais de bundle a partir dos trades observados.
 */
import { curveFillPct, spotPrice, type CurveParams, type CurveState } from "../curve";
import type { NewTokenMsg, TradeMsg } from "../feed/schemas";
import { SlidingWindow } from "./windows";

export interface ObservedTrade {
  ts: number;
  side: "buy" | "sell";
  sol: number;
  tokens: number;
  trader: string;
  vSol: number;
  vTokens: number;
}

export interface WindowStats {
  buyVolSol: number;
  sellVolSol: number;
  uniqueBuyers: number;
  uniqueSellers: number;
  buys: number;
  sells: number;
  /** compra/venda em volume SOL; sem vendas => buyVol / 0.0001 (limitado a 999) */
  buySellRatio: number;
}

export type BundleSignal = "none" | "weak" | "strong";

export interface FeatureSnapshot {
  ts: number;
  mint: string;
  ageSec: number;
  curvePct: number;
  priceSol: number;
  marketCapSol: number;
  vSol: number;
  vTokens: number;
  w10: WindowStats;
  w30: WindowStats;
  w60: WindowStats;
  w180: WindowStats;
  top1Pct: number;
  top5Pct: number;
  top10Pct: number;
  holders: number;
  creatorBoughtSol: number;
  creatorHoldsPct: number;
  creatorSold: boolean;
  priceChg10sPct: number;
  priceChg60sPct: number;
  maxDrawdown60sPct: number;
  bundleSignal: BundleSignal;
  bundleBuys: number;
  totalTrades: number;
}

const WINDOWS = [10_000, 30_000, 60_000, 180_000] as const;

export class TokenState {
  readonly mint: string;
  readonly creator: string;
  readonly createdAt: number;
  readonly name: string;
  readonly symbol: string;
  readonly uri: string;
  state: CurveState;
  lastTradeAt: number;
  migrated = false;
  totalTrades = 0;
  creatorBoughtSol = 0;
  creatorSold = false;
  private creatorBalance = 0;
  private balances = new Map<string, number>();
  private trades = new SlidingWindow<ObservedTrade>(180_000);
  private prices = new SlidingWindow<{ ts: number; p: number }>(65_000);
  private bundleBuys: ObservedTrade[] = [];  // compras nos primeiros 2s após a criação
  private lastPrune = 0;

  constructor(msg: NewTokenMsg, receivedAt: number, private readonly curve: CurveParams) {
    this.mint = msg.mint;
    this.creator = msg.traderPublicKey;
    this.createdAt = receivedAt;
    this.name = msg.name ?? "";
    this.symbol = msg.symbol ?? "";
    this.uri = msg.uri ?? "";
    this.state = { vSol: msg.vSolInBondingCurve, vTokens: msg.vTokensInBondingCurve };
    this.lastTradeAt = receivedAt;
    if ((msg.initialBuy ?? 0) > 0) {
      this.creatorBoughtSol = msg.solAmount ?? 0;
      this.creatorBalance = msg.initialBuy ?? 0;
      this.balances.set(this.creator, this.creatorBalance);
    }
    this.prices.push({ ts: receivedAt, p: spotPrice(this.state) });
  }

  /** Reconstrói um TokenState a partir de uma linha do banco (usado no replay). */
  static fromRecord(rec: { mint: string; creator: string; createdAt: number; name: string; symbol: string; uri: string; vSol: number; vTokens: number; initialBuy: number; creatorSol: number }, curve: CurveParams): TokenState {
    return new TokenState({
      mint: rec.mint, traderPublicKey: rec.creator, txType: "create", initialBuy: rec.initialBuy, solAmount: rec.creatorSol,
      vSolInBondingCurve: rec.vSol, vTokensInBondingCurve: rec.vTokens, name: rec.name, symbol: rec.symbol, uri: rec.uri,
    }, rec.createdAt, curve);
  }

  onTrade(msg: TradeMsg, ts: number): ObservedTrade {
    const t: ObservedTrade = { ts, side: msg.txType, sol: msg.solAmount, tokens: msg.tokenAmount, trader: msg.traderPublicKey, vSol: msg.vSolInBondingCurve, vTokens: msg.vTokensInBondingCurve };
    this.state = { vSol: t.vSol, vTokens: t.vTokens };
    this.lastTradeAt = ts;
    this.totalTrades++;
    this.trades.push(t);
    this.prices.push({ ts, p: spotPrice(this.state) });
    // saldo: usa newTokenBalance quando existir (exato), senão acumula
    const prev = this.balances.get(t.trader) ?? 0;
    const bal = msg.newTokenBalance !== undefined ? msg.newTokenBalance : Math.max(0, prev + (t.side === "buy" ? t.tokens : -t.tokens));
    this.balances.set(t.trader, bal);
    if (t.trader === this.creator) {
      if (t.side === "buy") this.creatorBoughtSol += t.sol;
      else this.creatorSold = true;
      this.creatorBalance = bal;
    }
    if (t.side === "buy" && ts - this.createdAt <= 2000 && t.trader !== this.creator) this.bundleBuys.push(t);
    if (ts - this.lastPrune > 5000) { this.trades.prune(ts); this.prices.prune(ts); this.lastPrune = ts; }
    return t;
  }

  price(): number { return spotPrice(this.state); }
  ageSec(now: number): number { return (now - this.createdAt) / 1000; }
  curvePct(): number { return curveFillPct(this.state, this.curve); }

  private windowStats(now: number, spanMs: number): WindowStats {
    const items = this.trades.since(now, spanMs);
    let buyVol = 0, sellVol = 0, buys = 0, sells = 0;
    const buyers = new Set<string>(), sellers = new Set<string>();
    for (const t of items) {
      if (t.side === "buy") { buyVol += t.sol; buys++; buyers.add(t.trader); }
      else { sellVol += t.sol; sells++; sellers.add(t.trader); }
    }
    const ratio = sellVol > 0 ? buyVol / sellVol : buyVol > 0 ? 999 : 0;
    return { buyVolSol: buyVol, sellVolSol: sellVol, uniqueBuyers: buyers.size, uniqueSellers: sellers.size, buys, sells, buySellRatio: Math.min(999, ratio) };
  }

  /** Concentração: % do circulante (soma dos saldos reconstruídos) nas N maiores carteiras. */
  private concentration(): { top1: number; top5: number; top10: number; holders: number; creatorPct: number } {
    const vals = [...this.balances.values()].filter((v) => v > 0).sort((a, b) => b - a);
    const total = vals.reduce((a, b) => a + b, 0);
    if (total <= 0) return { top1: 0, top5: 0, top10: 0, holders: 0, creatorPct: 0 };
    const sum = (n: number) => vals.slice(0, n).reduce((a, b) => a + b, 0) / total * 100;
    return { top1: sum(1), top5: sum(5), top10: sum(10), holders: vals.length, creatorPct: (this.creatorBalance / total) * 100 };
  }

  private priceChangePct(now: number, spanMs: number): number {
    const pts = this.prices.all();
    if (pts.length === 0) return 0;
    const target = now - spanMs;
    // preço mais recente em ou antes de `target`; se não houver, o mais antigo
    let ref = pts[0]!.p;
    for (const pt of pts) { if (pt.ts <= target) ref = pt.p; else break; }
    const cur = this.price();
    return ref > 0 ? ((cur - ref) / ref) * 100 : 0;
  }

  private maxDrawdownPct(now: number, spanMs: number): number {
    const pts = this.prices.since(now, spanMs);
    let peak = -Infinity, mdd = 0;
    for (const pt of pts) { peak = Math.max(peak, pt.p); if (peak > 0) mdd = Math.max(mdd, ((peak - pt.p) / peak) * 100); }
    return mdd;
  }

  /**
   * Sinal de bundle: muitas compras de carteiras distintas, de valor parecido, nos 2s após a criação.
   * forte: >= 5 compras com coeficiente de variação < 25%; fraco: >= 3 compras.
   */
  bundle(): { signal: BundleSignal; count: number } {
    const b = this.bundleBuys;
    const n = new Set(b.map((t) => t.trader)).size;
    if (n < 3) return { signal: "none", count: n };
    const mean = b.reduce((a, t) => a + t.sol, 0) / b.length;
    const sd = Math.sqrt(b.reduce((a, t) => a + (t.sol - mean) ** 2, 0) / b.length);
    const cv = mean > 0 ? sd / mean : 1;
    return { signal: n >= 5 && cv < 0.25 ? "strong" : "weak", count: n };
  }

  snapshot(now: number): FeatureSnapshot {
    const c = this.concentration();
    const b = this.bundle();
    const [w10, w30, w60, w180] = WINDOWS.map((w) => this.windowStats(now, w)) as [WindowStats, WindowStats, WindowStats, WindowStats];
    return {
      ts: now, mint: this.mint, ageSec: this.ageSec(now), curvePct: this.curvePct(), priceSol: this.price(),
      marketCapSol: this.price() * this.curve.totalSupply, vSol: this.state.vSol, vTokens: this.state.vTokens,
      w10, w30, w60, w180,
      top1Pct: c.top1, top5Pct: c.top5, top10Pct: c.top10, holders: c.holders,
      creatorBoughtSol: this.creatorBoughtSol, creatorHoldsPct: c.creatorPct, creatorSold: this.creatorSold,
      priceChg10sPct: this.priceChangePct(now, 10_000), priceChg60sPct: this.priceChangePct(now, 60_000),
      maxDrawdown60sPct: this.maxDrawdownPct(now, 60_000),
      bundleSignal: b.signal, bundleBuys: b.count, totalTrades: this.totalTrades,
    };
  }
}
