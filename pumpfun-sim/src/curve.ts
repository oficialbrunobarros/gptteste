/**
 * Matemática da bonding curve da Pump.fun.
 *
 * Modelo: produto constante sobre reservas VIRTUAIS: k = vSol * vTokens.
 * Uma compra injeta SOL (líquido de taxa) na reserva e retira tokens de forma a manter k.
 * Uma venda injeta tokens e retira SOL; a taxa é cobrada sobre o SOL de saída.
 * Todos os valores em unidades "humanas" (SOL e tokens inteiros), como o PumpPortal envia.
 */
export interface CurveState {
  vSol: number;
  vTokens: number;
}

export interface CurveParams {
  feePct: number;              // taxa por operação, em % (1.25 = 1,25%)
  initialVirtualSol: number;   // 30 SOL na Pump.fun
  initialVirtualTokens: number;
  graduationSol: number;       // ~85 SOL reais para graduar
  totalSupply: number;
}

export const DEFAULT_CURVE_PARAMS: CurveParams = {
  feePct: 1.25,
  initialVirtualSol: 30,
  initialVirtualTokens: 1_073_000_000,
  graduationSol: 85,
  totalSupply: 1_000_000_000,
};

/** Preço à vista em SOL por token. */
export function spotPrice(s: CurveState): number {
  return s.vSol / s.vTokens;
}

export interface BuyResult {
  tokensOut: number;
  solNet: number;   // SOL que realmente entra na curva
  fee: number;      // taxa da curva em SOL
  after: CurveState;
  avgPrice: number; // SOL por token efetivamente pago (sem contar a taxa)
}

/** Compra com `solIn` SOL brutos: aplica a taxa e calcula tokens recebidos. */
export function buy(s: CurveState, solIn: number, feePct: number): BuyResult {
  if (!(solIn > 0)) throw new RangeError("solIn deve ser > 0");
  assertState(s);
  const fee = solIn * (feePct / 100);
  const solNet = solIn - fee;
  const k = s.vSol * s.vTokens;
  const tokensOut = s.vTokens - k / (s.vSol + solNet);
  const after = { vSol: s.vSol + solNet, vTokens: s.vTokens - tokensOut };
  return { tokensOut, solNet, fee, after, avgPrice: solNet / tokensOut };
}

export interface SellResult {
  solGross: number; // SOL antes da taxa
  fee: number;
  solOut: number;   // SOL líquido recebido
  after: CurveState;
  avgPrice: number;
}

/** Venda de `tokensIn` tokens: calcula SOL de saída e aplica a taxa sobre ele. */
export function sell(s: CurveState, tokensIn: number, feePct: number): SellResult {
  if (!(tokensIn > 0)) throw new RangeError("tokensIn deve ser > 0");
  assertState(s);
  const k = s.vSol * s.vTokens;
  const solGross = s.vSol - k / (s.vTokens + tokensIn);
  const fee = solGross * (feePct / 100);
  const solOut = solGross - fee;
  const after = { vSol: s.vSol - solGross, vTokens: s.vTokens + tokensIn };
  return { solGross, fee, solOut, after, avgPrice: solGross / tokensIn };
}

/** Quanto SOL (líquido, sem taxa) é preciso injetar para receber exatamente `tokensOut`. */
export function solForExactTokens(s: CurveState, tokensOut: number): number {
  if (tokensOut >= s.vTokens) return Infinity;
  const k = s.vSol * s.vTokens;
  return k / (s.vTokens - tokensOut) - s.vSol;
}

/** SOL real acumulado na curva (descontando a reserva virtual inicial). */
export function realSol(s: CurveState, p: CurveParams): number {
  return Math.max(0, s.vSol - p.initialVirtualSol);
}

/** % da curva preenchida rumo à graduação. */
export function curveFillPct(s: CurveState, p: CurveParams): number {
  return Math.min(100, (realSol(s, p) / p.graduationSol) * 100);
}

/** Market cap em SOL (preço à vista × fornecimento total). */
export function marketCapSol(s: CurveState, p: CurveParams): number {
  return spotPrice(s) * p.totalSupply;
}

export function initialState(p: CurveParams): CurveState {
  return { vSol: p.initialVirtualSol, vTokens: p.initialVirtualTokens };
}

function assertState(s: CurveState): void {
  if (!(s.vSol > 0) || !(s.vTokens > 0) || !Number.isFinite(s.vSol) || !Number.isFinite(s.vTokens)) {
    throw new RangeError(`estado de curva inválido: vSol=${s.vSol} vTokens=${s.vTokens}`);
  }
}
