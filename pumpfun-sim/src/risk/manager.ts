import type { Config } from "../config";
import { localDateStr, nextMidnight } from "./time";

export interface RiskDecision { ok: boolean; reason?: string }

export interface RiskSnapshot {
  bankrollSol: number;
  initialBankrollSol: number;
  dailyPnlUsd: number;
  dailyHaltedUntil: number | null;
  cooldownUntil: number | null;
  consecutiveStops: number;
  positionSol: number;
}

/**
 * Gestão de risco da banca simulada: caixa em SOL, limite de perda diária (fuso local),
 * cooldown após N stops seguidos e tamanho fixo por operação em USD.
 */
export class RiskManager {
  bankrollSol: number;
  readonly initialBankrollSol: number;
  private dailyPnlUsd = 0;
  private dailyDate: string;
  private dailyHaltedUntil: number | null = null;
  private cooldownUntil: number | null = null;
  private consecutiveStops = 0;

  constructor(
    private cfg: Config,
    private readonly solUsd: () => number,
    initialBankrollSol: number,
    now: number,
    opts: { dailyPnlUsd?: number; consecutiveStops?: number } = {},
    private readonly onEvent: (type: string, detail: Record<string, unknown>) => void = () => {},
  ) {
    this.bankrollSol = initialBankrollSol;
    this.initialBankrollSol = initialBankrollSol;
    this.dailyDate = localDateStr(now, cfg.risk.timezone);
    this.dailyPnlUsd = opts.dailyPnlUsd ?? 0;
    this.consecutiveStops = opts.consecutiveStops ?? 0;
  }

  setConfig(cfg: Config): void { this.cfg = cfg; }

  /** Tamanho da posição em SOL (positionUsd convertido pelo preço atual). */
  positionSol(): number { return this.cfg.risk.positionUsd / this.solUsd(); }

  private rollDay(now: number): void {
    const d = localDateStr(now, this.cfg.risk.timezone);
    if (d !== this.dailyDate) {
      this.dailyDate = d; this.dailyPnlUsd = 0;
      if (this.dailyHaltedUntil && now >= this.dailyHaltedUntil) { this.dailyHaltedUntil = null; this.onEvent("daily_limit_reset", { date: d }); }
    }
  }

  canOpen(now: number, openPositions: number): RiskDecision {
    this.rollDay(now);
    if (this.dailyHaltedUntil && now < this.dailyHaltedUntil) return { ok: false, reason: "daily_loss_limit" };
    if (this.cooldownUntil && now < this.cooldownUntil) return { ok: false, reason: "cooldown" };
    if (openPositions >= this.cfg.entry.maxOpenPositions) return { ok: false, reason: "max_open_positions" };
    const size = this.positionSol() + this.cfg.costs.networkFeeSol;
    if (this.bankrollSol < size) return { ok: false, reason: "bankroll_insufficient" };
    return { ok: true };
  }

  /** Debita a compra (SOL total gasto, inclusive taxa de rede). */
  onBuy(solSpent: number): void { this.bankrollSol -= solSpent; }

  /** Credita a venda e atualiza PnL diário / cooldown. */
  onClose(now: number, solReceived: number, pnlNetSol: number, wasStop: boolean): void {
    this.rollDay(now);
    this.bankrollSol += solReceived;
    const pnlUsd = pnlNetSol * this.solUsd();
    this.dailyPnlUsd += pnlUsd;
    if (wasStop) {
      this.consecutiveStops++;
      if (this.consecutiveStops >= this.cfg.risk.consecutiveStopsForCooldown && this.cfg.risk.cooldownMin > 0) {
        this.cooldownUntil = now + this.cfg.risk.cooldownMin * 60_000;
        this.onEvent("cooldown", { consecutiveStops: this.consecutiveStops, until: this.cooldownUntil });
        this.consecutiveStops = 0;
      }
    } else if (pnlNetSol > 0) {
      this.consecutiveStops = 0;
    }
    if (this.dailyPnlUsd <= -this.cfg.risk.dailyLossLimitUsd && !this.dailyHaltedUntil) {
      this.dailyHaltedUntil = nextMidnight(now, this.cfg.risk.timezone);
      this.onEvent("daily_limit_hit", { dailyPnlUsd: this.dailyPnlUsd, until: this.dailyHaltedUntil });
    }
  }

  snapshot(): RiskSnapshot {
    return { bankrollSol: this.bankrollSol, initialBankrollSol: this.initialBankrollSol, dailyPnlUsd: this.dailyPnlUsd, dailyHaltedUntil: this.dailyHaltedUntil, cooldownUntil: this.cooldownUntil, consecutiveStops: this.consecutiveStops, positionSol: this.positionSol() };
  }
}
