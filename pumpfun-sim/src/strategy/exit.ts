import type { Config } from "../config";
import type { ExitReason } from "../executor/Executor";

export interface ExitContext {
  netPct: number;        // PnL líquido atual em % (se vendêssemos agora, com todas as taxas)
  peakNetPct: number;    // maior netPct visto desde a abertura
  heldSec: number;
  creatorSold: boolean;
}

/**
 * Regras de SAÍDA — a primeira que disparar vence, na ordem:
 * criador vendeu > stop > alvo > trailing > tempo máximo.
 * (migração e encerramento são tratados diretamente pelo motor.)
 */
export function exitReason(ctx: ExitContext, cfg: Config["exit"]): ExitReason | null {
  if (ctx.creatorSold) return "creator_sold";
  if (ctx.netPct <= -cfg.stopLossPct) return "stop_loss";
  if (ctx.netPct >= cfg.takeProfitPct) return "take_profit";
  if (cfg.trailingPct !== null && ctx.peakNetPct > 0 && ctx.peakNetPct - ctx.netPct >= cfg.trailingPct) return "trailing_stop";
  if (ctx.heldSec >= cfg.maxHoldSec) return "max_hold";
  return null;
}

export const STOP_REASONS: ReadonlySet<ExitReason> = new Set(["stop_loss", "creator_sold", "trailing_stop"]);
