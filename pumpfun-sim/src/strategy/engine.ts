/**
 * Motor da simulação: recebe eventos do feed, mantém o estado por moeda, aplica filtros de
 * entrada/saída, envia ordens ao executor (com latência) e persiste tudo.
 * Todos os métodos recebem `now` explicitamente para funcionar em tempo real e em replay.
 */
import { EventEmitter } from "node:events";
import type { Config } from "../config";
import type { CurveState } from "../curve";
import { TokenState, type FeatureSnapshot } from "../features/tokenState";
import type { MigrationMsg, NewTokenMsg, TradeMsg } from "../feed/schemas";
import type { Feed } from "../feed/types";
import type { BuyFill, ExecutionEvent, Executor, ExitReason, SellFill, SellOrder } from "../executor/Executor";
import { costsFromConfig, netLiquidationSol, type PaperCosts } from "../executor/PaperExecutor";
import type { SimDb } from "../db/db";
import type { RiskManager } from "../risk/manager";
import type { JevFilter, JevOutcome } from "../jev/client";
import { entryFilters, type EntryFilter } from "./entry";
import { exitReason, STOP_REASONS } from "./exit";
import { logger } from "../logger";

export interface OpenPosition {
  id: number;
  mint: string;
  symbol: string;
  name: string;
  shadow: boolean;
  tokens: number;
  solSpent: number;
  entryPrice: number;
  decidedAt: number;
  openedAt: number;
  peakNetPct: number;
  lastNetPct: number;
  exitPending: ExitReason | null;
  features: FeatureSnapshot;
  jev: JevOutcome;
  costs: { curve: number; exec: number; network: number };
}

export interface EngineDeps {
  cfg: () => Config;
  feed: Feed;
  db: SimDb;
  executor: Executor;
  risk: RiskManager;
  jev: JevFilter | null;
  solUsd: () => number;
}

export interface EngineStats {
  watched: number;
  tokensSeen: number;
  tradesSeen: number;
  evaluations: number;
  rejections: Record<string, number>;
  entriesSubmitted: number;
  cancels: number;
  jevVetoes: number;
  jevFailures: number;
  openPositions: number;
  openShadow: number;
}

export class Engine extends EventEmitter {
  readonly tokens = new Map<string, TokenState>();
  readonly positions = new Map<number, OpenPosition>();
  private lastEval = new Map<string, number>();
  private entryPending = new Set<string>();
  private stats: EngineStats = { watched: 0, tokensSeen: 0, tradesSeen: 0, evaluations: 0, rejections: {}, entriesSubmitted: 0, cancels: 0, jevVetoes: 0, jevFailures: 0, openPositions: 0, openShadow: 0 };
  private orderSeq = 0;
  private lastEquityAt = 0;
  private lastPruneAt = 0;
  private lastEvictAt = 0;
  /** No replay não há latência de rede real; o executor continua simulando a latência configurada. */
  readonly replay: boolean;

  constructor(private readonly d: EngineDeps, opts: { replay?: boolean } = {}) {
    super();
    this.replay = opts.replay ?? false;
  }

  costs(): PaperCosts { return costsFromConfig(this.d.cfg()); }

  curveState(mint: string): CurveState | undefined { return this.tokens.get(mint)?.state; }
  get jevEnabled(): boolean { return this.d.jev?.enabled ?? false; }
  pendingOrders() { return this.d.executor.pending(); }

  getStats(): EngineStats {
    let open = 0, shadow = 0;
    for (const p of this.positions.values()) { if (p.shadow) shadow++; else open++; }
    return { ...this.stats, watched: this.tokens.size, openPositions: open, openShadow: shadow, rejections: { ...this.stats.rejections } };
  }

  // ------------------------------------------------------------------ eventos do feed

  onNewToken(msg: NewTokenMsg, now: number): void {
    if (this.tokens.has(msg.mint)) return;
    const cfg = this.d.cfg();
    const tok = new TokenState(msg, now, cfg.curve);
    this.tokens.set(msg.mint, tok);
    this.stats.tokensSeen++;
    this.d.db.insertToken({ mint: tok.mint, name: tok.name, symbol: tok.symbol, uri: tok.uri, creator: tok.creator, createdAt: now, vSol: msg.vSolInBondingCurve, vTokens: msg.vTokensInBondingCurve, initialBuy: msg.initialBuy ?? 0, creatorSol: msg.solAmount ?? 0 });
    this.d.feed.subscribeToken(msg.mint);
    if (this.tokens.size > cfg.feed.maxWatched) this.evict(now, cfg);
  }

  onTrade(msg: TradeMsg, now: number): void {
    const tok = this.tokens.get(msg.mint);
    if (!tok || tok.migrated) return;
    // Ordens cuja latência já venceu executam ANTES de aplicar este trade (com o estado que valia no
    // intervalo entre trades). Assim o replay reproduz o que o timer de 250 ms faz em tempo real.
    this.processExecution(now);
    const t = tok.onTrade(msg, now);
    this.stats.tradesSeen++;
    this.d.db.bufferTrade({ mint: msg.mint, ts: now, side: t.side, sol: t.sol, tokens: t.tokens, trader: t.trader, v_sol: t.vSol, v_tokens: t.vTokens, new_balance: msg.newTokenBalance ?? null });
    for (const p of this.positions.values()) if (p.mint === msg.mint) this.checkExit(p, tok, now);
    const last = this.lastEval.get(msg.mint) ?? 0;
    if (now - last >= 1000) { this.lastEval.set(msg.mint, now); this.evaluateEntry(tok, now); }
  }

  onMigration(msg: MigrationMsg, now: number): void {
    const tok = this.tokens.get(msg.mint);
    if (!tok) return;
    tok.migrated = true;
    this.d.db.markMigrated(msg.mint, now);
    const cfg = this.d.cfg();
    // Graduação: a curva congela; saímos no último preço com penalidade (liquidez migra para a AMM).
    for (const p of [...this.positions.values()]) {
      if (p.mint !== msg.mint) continue;
      const order: SellOrder = { id: this.oid(), mint: p.mint, positionId: p.id, tokens: p.tokens, decidedAt: now, reason: "migration", shadow: p.shadow, penaltyPct: cfg.exit.migrationPenaltyPct };
      const fill = this.d.executor.executeNow(order, now);
      if (fill) this.onSellFill(fill, now);
    }
    this.d.feed.unsubscribeToken(msg.mint);
    this.d.db.event(now, "migration", { mint: msg.mint, symbol: tok.symbol });
  }

  /** Chamado periodicamente (tempo real: a cada ~250ms; replay: a cada trade). */
  tick(now: number): void {
    this.processExecution(now);
    for (const p of this.positions.values()) {
      const tok = this.tokens.get(p.mint);
      if (tok) this.checkExit(p, tok, now);
    }
    const cfg = this.d.cfg();
    if (now - this.lastEvictAt >= 5000) { this.lastEvictAt = now; this.evict(now, cfg); }
    if (now - this.lastEquityAt >= cfg.db.equityIntervalSec * 1000) { this.lastEquityAt = now; this.recordEquity(now); }
    if (!this.replay && now - this.lastPruneAt >= 3_600_000) {
      this.lastPruneAt = now;
      const n = this.d.db.pruneTrades(now - cfg.db.tradesRetentionDays * 86_400_000);
      if (n) logger.info({ removed: n }, "retenção: trades antigos removidos");
    }
  }

  // ------------------------------------------------------------------ entrada

  private evaluateEntry(tok: TokenState, now: number): void {
    if (this.entryPending.has(tok.mint) || this.d.executor.hasPendingFor(tok.mint)) return;
    for (const p of this.positions.values()) if (p.mint === tok.mint) return;
    const cfg = this.d.cfg();
    // fora da janela de idade nem vale a pena calcular tudo
    const age = tok.ageSec(now);
    if (age > cfg.entry.maxAgeSec) return;
    const f = tok.snapshot(now);
    this.stats.evaluations++;
    const failed = entryFilters(f, cfg.entry);
    if (failed.length) { for (const r of failed) this.reject(r); return; }
    const risk = this.d.risk.canOpen(now, this.countOpen(false));
    if (!risk.ok) { this.reject(risk.reason!); return; }
    const sizeSol = this.d.risk.positionSol();
    if (this.d.jev?.enabled) {
      this.entryPending.add(tok.mint);
      void this.withJev(tok, f, sizeSol, now);
    } else {
      this.submitBuy(tok, f, sizeSol, now, null, false);
    }
  }

  private async withJev(tok: TokenState, f: FeatureSnapshot, sizeSol: number, decidedAt: number): Promise<void> {
    const jev = this.d.jev!;
    try {
      const description = await jev.fetchDescription(tok.mint, tok.uri);
      const outcome = await jev.evaluate({ name: tok.name, symbol: tok.symbol, uri: tok.uri, description }, f);
      const now = Date.now();
      if (outcome && "veto" in outcome && outcome.veto) {
        this.stats.jevVetoes++;
        this.d.db.event(now, "jev_veto", { mint: tok.mint, symbol: tok.symbol, isLikelyScam: outcome.isLikelyScam, category: outcome.category });
        // modo sombra: simula a operação vetada sem afetar a banca
        if (this.d.cfg().jev.shadow) this.submitBuy(tok, f, sizeSol, now, outcome, true);
        else this.entryPending.delete(tok.mint);
        return;
      }
      if (outcome && "error" in outcome) this.stats.jevFailures++;
      // re-checa o risco porque o tempo passou enquanto o Jev respondia
      const risk = this.d.risk.canOpen(now, this.countOpen(false));
      if (!risk.ok) { this.reject(risk.reason!); this.entryPending.delete(tok.mint); return; }
      this.submitBuy(tok, f, sizeSol, now, outcome, false);
    } catch (err) {
      logger.error({ err, mint: tok.mint }, "falha inesperada no caminho do Jev");
      this.entryPending.delete(tok.mint);
    }
  }

  private submitBuy(tok: TokenState, f: FeatureSnapshot, sizeSol: number, now: number, jev: JevOutcome, shadow: boolean): void {
    this.entryPending.add(tok.mint);
    this.stats.entriesSubmitted++;
    this.d.executor.submitBuy({ id: this.oid(), mint: tok.mint, solIn: sizeSol, decidedAt: now, decisionPrice: tok.price(), shadow, meta: { features: f, jev } });
    logger.info({ mint: tok.mint, symbol: tok.symbol, age: +f.ageSec.toFixed(0), curve: +f.curvePct.toFixed(1), buyers60: f.w60.uniqueBuyers, shadow }, "ENTRADA decidida (aguardando latência)");
  }

  private reject(r: EntryFilter | string): void { this.stats.rejections[r] = (this.stats.rejections[r] ?? 0) + 1; }

  private countOpen(shadow: boolean): number {
    let n = 0;
    for (const p of this.positions.values()) if (p.shadow === shadow) n++;
    // compras reais pendentes também contam para não estourar o limite
    if (!shadow) for (const o of this.d.executor.pending()) if ("solIn" in o && !o.shadow) n++;
    return n;
  }

  // ------------------------------------------------------------------ saída

  private checkExit(p: OpenPosition, tok: TokenState, now: number): void {
    if (p.exitPending) return;
    const c = this.costs();
    const liq = netLiquidationSol(tok.state, p.tokens, c);
    const netPct = ((liq - p.solSpent) / p.solSpent) * 100;
    p.lastNetPct = netPct;
    if (netPct > p.peakNetPct) p.peakNetPct = netPct;
    const reason = exitReason({ netPct, peakNetPct: p.peakNetPct, heldSec: (now - p.openedAt) / 1000, creatorSold: tok.creatorSold }, this.d.cfg().exit);
    if (!reason) return;
    p.exitPending = reason;
    this.d.executor.submitSell({ id: this.oid(), mint: p.mint, positionId: p.id, tokens: p.tokens, decidedAt: now, reason, shadow: p.shadow });
    logger.info({ mint: p.mint, symbol: p.symbol, reason, netPct: +netPct.toFixed(2), shadow: p.shadow }, "SAÍDA decidida (aguardando latência)");
  }

  /** Encerramento gracioso: fecha tudo a mercado, sem latência. */
  closeAll(now: number, reason: ExitReason = "shutdown"): void {
    for (const p of [...this.positions.values()]) {
      const order: SellOrder = { id: this.oid(), mint: p.mint, positionId: p.id, tokens: p.tokens, decidedAt: now, reason, shadow: p.shadow };
      const fill = this.d.executor.executeNow(order, now);
      if (fill) this.onSellFill(fill, now);
      else { logger.warn({ mint: p.mint }, "sem estado para fechar posição; registrando como fechada a custo zero"); this.finalizeClose(p, now, reason, 0, 0, 0, 0, 0, 0); }
    }
    this.recordEquity(now);
  }

  // ------------------------------------------------------------------ execução

  private processExecution(now: number): void {
    for (const ev of this.d.executor.tick(now)) this.onExecution(ev, now);
  }

  private onExecution(ev: ExecutionEvent, now: number): void {
    if (ev.type === "buy") this.onBuyFill(ev, now);
    else if (ev.type === "sell") this.onSellFill(ev, now);
    else {
      this.stats.cancels++;
      this.entryPending.delete(ev.order.mint);
      if ("positionId" in ev.order) { const p = this.positions.get(ev.order.positionId); if (p) p.exitPending = null; }
      this.d.db.event(now, "order_cancelled", { mint: ev.order.mint, reason: ev.reason, side: "solIn" in ev.order ? "buy" : "sell" });
      logger.info({ mint: ev.order.mint, reason: ev.reason }, "ordem cancelada");
    }
  }

  private onBuyFill(f: BuyFill, now: number): void {
    this.entryPending.delete(f.order.mint);
    const tok = this.tokens.get(f.order.mint);
    const features = (f.order.meta?.features as FeatureSnapshot | undefined) ?? tok?.snapshot(now);
    const jev = (f.order.meta?.jev as JevOutcome | undefined) ?? null;
    if (!tok || !features) return;
    const solUsd = this.d.solUsd();
    const id = this.d.db.openPosition({
      mint: tok.mint, name: tok.name, symbol: tok.symbol, shadow: f.order.shadow, decidedAt: f.order.decidedAt, openedAt: f.executedAt,
      sizeSol: f.order.solIn, tokens: f.tokens, entryPrice: f.fillPrice, solSpent: f.solSpent,
      costCurveFee: f.costs.curveFeeSol, costExecFee: f.costs.executionFeeSol, costNetworkFee: f.costs.networkFeeSol, solPriceUsd: solUsd, features, jev,
    });
    if (!f.order.shadow) { this.d.risk.onBuy(f.solSpent); this.d.db.setEntryFeatures(tok.mint, features); }
    const p: OpenPosition = { id, mint: tok.mint, symbol: tok.symbol, name: tok.name, shadow: f.order.shadow, tokens: f.tokens, solSpent: f.solSpent, entryPrice: f.fillPrice, decidedAt: f.order.decidedAt, openedAt: f.executedAt, peakNetPct: -Infinity, lastNetPct: 0, exitPending: null, features, jev, costs: { curve: f.costs.curveFeeSol, exec: f.costs.executionFeeSol, network: f.costs.networkFeeSol } };
    this.positions.set(id, p);
    this.emit("opened", p);
    logger.info({ id, symbol: tok.symbol, tokens: Math.round(f.tokens), solSpent: +f.solSpent.toFixed(4), slippagePct: +(((f.execPrice - f.order.decisionPrice) / f.order.decisionPrice) * 100).toFixed(2), shadow: p.shadow }, "COMPRA executada");
    // pode já estar em condição de saída (ex.: o preço despencou durante a latência)
    this.checkExit(p, tok, now);
  }

  private onSellFill(f: SellFill, now: number): void {
    const p = this.positions.get(f.order.positionId);
    if (!p) return;
    this.finalizeClose(p, f.executedAt, f.order.reason, f.solReceived, f.fillPrice, f.costs.curveFeeSol, f.costs.executionFeeSol, f.costs.networkFeeSol, f.costs.penaltySol);
  }

  private finalizeClose(p: OpenPosition, at: number, reason: ExitReason, solReceived: number, exitPrice: number, curveFee: number, execFee: number, netFee: number, penalty: number): void {
    const solUsd = this.d.solUsd();
    // bruto = diferença de preço da curva sem taxas (aprox.: recebido + taxas de saída − (gasto − taxas de entrada))
    const pnlNet = solReceived - p.solSpent;
    const pnlGross = pnlNet + curveFee + execFee + netFee + penalty + p.costs.curve + p.costs.exec + p.costs.network;
    const pnlNetPct = (pnlNet / p.solSpent) * 100;
    this.d.db.closePosition({ id: p.id, shadow: p.shadow, closedAt: at, exitReason: reason, exitPrice, solReceived, costCurveFee: curveFee, costExecFee: execFee, costNetworkFee: netFee, costPenalty: penalty, pnlGrossSol: pnlGross, pnlNetSol: pnlNet, pnlNetUsd: pnlNet * solUsd, pnlNetPct, durationSec: (at - p.openedAt) / 1000, peakNetPct: Number.isFinite(p.peakNetPct) ? p.peakNetPct : pnlNetPct });
    if (!p.shadow) this.d.risk.onClose(at, solReceived, pnlNet, STOP_REASONS.has(reason));
    this.positions.delete(p.id);
    this.emit("closed", { ...p, exitReason: reason, pnlNet, pnlNetPct, closedAt: at });
    logger.info({ id: p.id, symbol: p.symbol, reason, pnlNetSol: +pnlNet.toFixed(5), pnlNetPct: +pnlNetPct.toFixed(2), heldSec: Math.round((at - p.openedAt) / 1000), shadow: p.shadow }, "VENDA executada");
  }

  // ------------------------------------------------------------------ manutenção

  private hasInterest(mint: string): boolean {
    if (this.entryPending.has(mint) || this.d.executor.hasPendingFor(mint)) return true;
    for (const p of this.positions.values()) if (p.mint === mint) return true;
    return false;
  }

  /** Descarta moedas velhas/inativas/migradas sem posição, respeitando maxWatched. */
  private evict(now: number, cfg: Config): void {
    for (const tok of [...this.tokens.values()]) {
      if (this.hasInterest(tok.mint)) continue;
      if (tok.migrated || tok.ageSec(now) > cfg.feed.watchTtlSec) this.drop(tok.mint);
    }
    if (this.tokens.size > cfg.feed.maxWatched) {
      const candidates = [...this.tokens.values()].filter((t) => !this.hasInterest(t.mint)).sort((a, b) => a.lastTradeAt - b.lastTradeAt);
      let excess = this.tokens.size - cfg.feed.maxWatched;
      for (const t of candidates) { if (excess-- <= 0) break; this.drop(t.mint); }
    }
  }

  private drop(mint: string): void {
    this.tokens.delete(mint);
    this.lastEval.delete(mint);
    this.d.feed.unsubscribeToken(mint);
  }

  openValueSol(): number {
    const c = this.costs();
    let v = 0;
    for (const p of this.positions.values()) {
      if (p.shadow) continue;
      const tok = this.tokens.get(p.mint);
      v += tok ? netLiquidationSol(tok.state, p.tokens, c) : p.solSpent;
    }
    return v;
  }

  recordEquity(now: number): void {
    const solUsd = this.d.solUsd();
    const bank = this.d.risk.bankrollSol;
    const open = this.openValueSol();
    this.d.db.equity({ ts: now, bankroll_sol: bank, open_value_sol: open, equity_sol: bank + open, equity_usd: (bank + open) * solUsd, sol_price_usd: solUsd });
    this.d.db.kvSet("bankroll_sol", String(bank));
  }

  private oid(): string { return `o${++this.orderSeq}`; }
}
