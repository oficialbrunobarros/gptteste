import { parseConfig, type Config } from "../src/config";
import type { NewTokenMsg, TradeMsg } from "../src/feed/schemas";
import { buy, sell, initialState, DEFAULT_CURVE_PARAMS, type CurveState } from "../src/curve";

export function testConfig(over: Partial<Record<keyof Config, object>> = {}): Config {
  const base = parseConfig({});
  const cfg: Config = { ...base };
  for (const k of Object.keys(over) as (keyof Config)[]) (cfg as any)[k] = { ...(base as any)[k], ...(over as any)[k] };
  return cfg;
}

export function newTokenMsg(mint: string, creator = "CREATOR", initialSol = 0.5, ts = 0): { msg: NewTokenMsg; state: CurveState } {
  let state = initialState(DEFAULT_CURVE_PARAMS);
  let initialBuy = 0, solAmount = 0;
  if (initialSol > 0) { const b = buy(state, initialSol, 1.25); state = b.after; initialBuy = b.tokensOut; solAmount = b.solNet; }
  return { msg: { mint, traderPublicKey: creator, txType: "create", initialBuy, solAmount, vSolInBondingCurve: state.vSol, vTokensInBondingCurve: state.vTokens, name: "Test", symbol: "TST", uri: "", signature: "s" + ts }, state };
}

/** Simulador mínimo de curva para gerar trades coerentes nos testes. */
export class MiniMarket {
  balances = new Map<string, number>();
  constructor(public state: CurveState) {}
  buy(trader: string, sol: number, mint = "M"): TradeMsg {
    const b = buy(this.state, sol, 1.25); this.state = b.after;
    const bal = (this.balances.get(trader) ?? 0) + b.tokensOut; this.balances.set(trader, bal);
    return { mint, traderPublicKey: trader, txType: "buy", tokenAmount: b.tokensOut, solAmount: b.solNet, newTokenBalance: bal, vSolInBondingCurve: this.state.vSol, vTokensInBondingCurve: this.state.vTokens };
  }
  sell(trader: string, tokens: number, mint = "M"): TradeMsg {
    const s = sell(this.state, tokens, 1.25); this.state = s.after;
    const bal = Math.max(0, (this.balances.get(trader) ?? 0) - tokens); this.balances.set(trader, bal);
    return { mint, traderPublicKey: trader, txType: "sell", tokenAmount: tokens, solAmount: s.solGross, newTokenBalance: bal, vSolInBondingCurve: this.state.vSol, vTokensInBondingCurve: this.state.vTokens };
  }
}
