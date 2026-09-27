import { buy as curveBuy, sell as curveSell, spotPrice, type CurveState } from "../curve";
import type { BuyFill, BuyOrder, Cancel, ExecutionEvent, Executor, SellFill, SellOrder } from "./Executor";

import type { Config } from "../config";

export function costsFromConfig(c: Config): PaperCosts {
  return { curveFeePct: c.curve.feePct, executionFeePct: c.costs.executionFeePct, networkFeeSol: c.costs.networkFeeSol, latencyMs: c.costs.latencyMs, maxSlippagePct: c.costs.maxSlippagePct };
}

export interface PaperCosts {
  curveFeePct: number;
  executionFeePct: number;
  networkFeeSol: number;
  latencyMs: number;
  maxSlippagePct: number;
}

type Pending = { order: BuyOrder | SellOrder; executeAt: number };

/**
 * Executor de papel: nada vai à blockchain.
 *
 * LATÊNCIA: toda ordem só executa `latencyMs` depois da decisão, usando o estado da curva
 * conhecido NAQUELE instante (isto é, já contando os trades de terceiros que chegaram no meio).
 * SLIPPAGE: se o preço subiu mais que `maxSlippagePct` desde a decisão, a compra é cancelada.
 * Vendas sempre executam (stop nunca é cancelado).
 * A nossa própria operação não altera o estado da curva compartilhado (somos observadores),
 * mas o impacto do nosso tamanho no preço É contabilizado pela fórmula de produto constante.
 */
export class PaperExecutor implements Executor {
  private queue: Pending[] = [];

  constructor(
    private readonly getState: (mint: string) => CurveState | undefined,
    private costs: PaperCosts,
  ) {}

  setCosts(c: PaperCosts): void { this.costs = c; }

  submitBuy(order: BuyOrder): void { this.queue.push({ order, executeAt: order.decidedAt + this.costs.latencyMs }); }
  submitSell(order: SellOrder): void { this.queue.push({ order, executeAt: order.decidedAt + this.costs.latencyMs }); }

  pending(): ReadonlyArray<BuyOrder | SellOrder> { return this.queue.map((p) => p.order); }
  hasPendingFor(mint: string): boolean { return this.queue.some((p) => p.order.mint === mint); }

  tick(now: number): ExecutionEvent[] {
    const out: ExecutionEvent[] = [];
    const keep: Pending[] = [];
    for (const p of this.queue) {
      if (p.executeAt > now) { keep.push(p); continue; }
      const state = this.getState(p.order.mint);
      if (!state) { out.push({ type: "cancel", order: p.order, at: now, reason: "estado da curva indisponível" }); continue; }
      if ("solIn" in p.order) out.push(this.fillBuy(p.order, state, p.executeAt));
      else { const f = this.fillSell(p.order, state, p.executeAt); if (f) out.push(f); }
    }
    this.queue = keep;
    return out;
  }

  executeNow(order: SellOrder, now: number): SellFill | null {
    const state = this.getState(order.mint);
    if (!state) return null;
    return this.fillSell(order, state, now);
  }

  private fillBuy(order: BuyOrder, state: CurveState, at: number): BuyFill | Cancel {
    const execPrice = spotPrice(state);
    const slip = ((execPrice - order.decisionPrice) / order.decisionPrice) * 100;
    if (slip > this.costs.maxSlippagePct) {
      return { type: "cancel", order, at, reason: `slippage ${slip.toFixed(1)}% > ${this.costs.maxSlippagePct}%` };
    }
    // taxa de execução de terceiros sai do SOL bruto antes de chegar à curva
    const executionFeeSol = order.solIn * (this.costs.executionFeePct / 100);
    const toCurve = order.solIn - executionFeeSol;
    const r = curveBuy(state, toCurve, this.costs.curveFeePct);
    const solSpent = order.solIn + this.costs.networkFeeSol;
    return {
      type: "buy", order, executedAt: at, tokens: r.tokensOut, solSpent, fillPrice: solSpent / r.tokensOut, execPrice,
      costs: { curveFeeSol: r.fee, executionFeeSol, networkFeeSol: this.costs.networkFeeSol, penaltySol: 0 }, stateAtExec: state,
    };
  }

  private fillSell(order: SellOrder, state: CurveState, at: number): SellFill | null {
    if (order.tokens <= 0) return null;
    const execPrice = spotPrice(state);
    const r = curveSell(state, order.tokens, this.costs.curveFeePct);
    const executionFeeSol = r.solOut * (this.costs.executionFeePct / 100);
    const penaltySol = r.solOut * ((order.penaltyPct ?? 0) / 100);
    const solReceived = Math.max(0, r.solOut - executionFeeSol - penaltySol - this.costs.networkFeeSol);
    return {
      type: "sell", order, executedAt: at, solReceived, fillPrice: solReceived / order.tokens, execPrice,
      costs: { curveFeeSol: r.fee, executionFeeSol, networkFeeSol: this.costs.networkFeeSol, penaltySol }, stateAtExec: state,
    };
  }
}

/** Valor líquido de liquidação de `tokens` no estado atual (o que sobraria na banca se vendêssemos agora). */
export function netLiquidationSol(state: CurveState, tokens: number, c: PaperCosts, penaltyPct = 0): number {
  if (tokens <= 0) return 0;
  const r = curveSell(state, tokens, c.curveFeePct);
  return Math.max(0, r.solOut * (1 - c.executionFeePct / 100) * (1 - penaltyPct / 100) - c.networkFeeSol);
}
