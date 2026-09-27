import type { CurveState } from "../curve";
import type { FeatureSnapshot } from "../features/tokenState";

export type ExitReason = "take_profit" | "stop_loss" | "max_hold" | "trailing_stop" | "creator_sold" | "migration" | "shutdown" | "daily_limit";

export interface BuyOrder {
  id: string;
  mint: string;
  solIn: number;            // SOL bruto destinado à operação (antes de taxas)
  decidedAt: number;
  decisionPrice: number;    // preço à vista no instante da decisão
  shadow: boolean;          // posição-sombra (vetada pelo Jev) não afeta a banca
  meta?: Record<string, unknown>;
}

export interface SellOrder {
  id: string;
  mint: string;
  positionId: number;
  tokens: number;
  decidedAt: number;
  reason: ExitReason;
  shadow: boolean;
  /** Penalidade adicional sobre o SOL de saída (ex.: migração), em % */
  penaltyPct?: number;
}

export interface CostBreakdown {
  curveFeeSol: number;
  executionFeeSol: number;
  networkFeeSol: number;
  penaltySol: number;
}

export interface BuyFill {
  type: "buy";
  order: BuyOrder;
  executedAt: number;
  tokens: number;
  solSpent: number;        // total saído da banca (solIn + taxa de rede)
  fillPrice: number;       // SOL/token efetivo (solIn / tokens)
  execPrice: number;       // preço à vista na execução
  costs: CostBreakdown;
  stateAtExec: CurveState;
}

export interface SellFill {
  type: "sell";
  order: SellOrder;
  executedAt: number;
  solReceived: number;     // líquido, já sem todas as taxas
  fillPrice: number;
  execPrice: number;
  costs: CostBreakdown;
  stateAtExec: CurveState;
}

export interface Cancel {
  type: "cancel";
  order: BuyOrder | SellOrder;
  at: number;
  reason: string;
}

export type ExecutionEvent = BuyFill | SellFill | Cancel;

/**
 * Interface de execução. Só existe a implementação PaperExecutor (simulação).
 * Um executor real seria uma decisão separada, fora do escopo deste projeto.
 */
export interface Executor {
  submitBuy(order: BuyOrder): void;
  submitSell(order: SellOrder): void;
  /** Processa ordens cuja latência já venceu; devolve fills/cancelamentos. */
  tick(now: number): ExecutionEvent[];
  pending(): ReadonlyArray<BuyOrder | SellOrder>;
  hasPendingFor(mint: string): boolean;
  /** Fecha imediatamente (sem latência) — usado no encerramento gracioso. */
  executeNow(order: SellOrder, now: number): SellFill | null;
}
