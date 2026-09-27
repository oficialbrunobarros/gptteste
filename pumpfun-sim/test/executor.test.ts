import { describe, expect, it } from "vitest";
import { PaperExecutor, netLiquidationSol, type PaperCosts } from "../src/executor/PaperExecutor";
import { initialState, DEFAULT_CURVE_PARAMS, spotPrice, buy, type CurveState } from "../src/curve";

const costs: PaperCosts = { curveFeePct: 1.25, executionFeePct: 0.5, networkFeeSol: 0.0005, latencyMs: 1500, maxSlippagePct: 10 };

describe("PaperExecutor", () => {
  it("só executa depois da latência e usa o estado da curva daquele instante", () => {
    let state: CurveState = initialState(DEFAULT_CURVE_PARAMS);
    const ex = new PaperExecutor(() => state, costs);
    const p0 = spotPrice(state);
    ex.submitBuy({ id: "1", mint: "M", solIn: 0.05, decidedAt: 1000, decisionPrice: p0, shadow: false });
    expect(ex.tick(2000)).toHaveLength(0);
    expect(ex.hasPendingFor("M")).toBe(true);
    // preço sobe 3% durante a latência (trades de terceiros)
    state = buy(state, 0.9, 1.25).after;
    const [ev] = ex.tick(2500);
    expect(ev?.type).toBe("buy");
    if (ev?.type !== "buy") throw new Error();
    expect(ev.execPrice).toBeGreaterThan(p0);
    expect(ev.executedAt).toBe(2500);
    expect(ev.solSpent).toBeCloseTo(0.05 + 0.0005, 12);
    expect(ev.costs.executionFeeSol).toBeCloseTo(0.05 * 0.005, 12);
    expect(ev.costs.curveFeeSol).toBeCloseTo((0.05 - 0.05 * 0.005) * 0.0125, 12);
    expect(ex.hasPendingFor("M")).toBe(false);
  });

  it("cancela a compra se o slippage passar do máximo; venda sempre executa", () => {
    let state: CurveState = initialState(DEFAULT_CURVE_PARAMS);
    const ex = new PaperExecutor(() => state, costs);
    ex.submitBuy({ id: "1", mint: "M", solIn: 0.05, decidedAt: 0, decisionPrice: spotPrice(state), shadow: false });
    state = buy(state, 5, 1.25).after; // +~35%
    const [c] = ex.tick(1500);
    expect(c?.type).toBe("cancel");
    ex.submitSell({ id: "2", mint: "M", positionId: 1, tokens: 1000, decidedAt: 1500, reason: "stop_loss", shadow: false });
    state = buy(state, 20, 1.25).after;
    const [s] = ex.tick(3000);
    expect(s?.type).toBe("sell");
  });

  it("ida e volta imediata perde ~2x taxa da curva + 2x execução + 2 taxas de rede", () => {
    const state = initialState(DEFAULT_CURVE_PARAMS);
    const c0 = { ...costs, latencyMs: 0, networkFeeSol: 0 };
    const ex = new PaperExecutor(() => state, c0);
    // tamanho minúsculo para o impacto no preço ser desprezível e sobrar só a taxa
    ex.submitBuy({ id: "1", mint: "M", solIn: 0.001, decidedAt: 0, decisionPrice: spotPrice(state), shadow: false });
    const [b] = ex.tick(0);
    if (b?.type !== "buy") throw new Error();
    const liq = netLiquidationSol(state, b.tokens, c0);
    const lossPct = (1 - liq / b.solSpent) * 100;
    // (1-0.005)(1-0.0125) ida, idem volta => ~3.47% + 2 taxas de rede sobre 1 SOL
    expect(lossPct).toBeGreaterThan(3.4);
    expect(lossPct).toBeLessThan(3.7);
  });

  it("penalidade de migração reduz o SOL recebido", () => {
    const state = initialState(DEFAULT_CURVE_PARAMS);
    const ex = new PaperExecutor(() => state, costs);
    const a = ex.executeNow({ id: "1", mint: "M", positionId: 1, tokens: 1e6, decidedAt: 0, reason: "migration", shadow: false, penaltyPct: 5 }, 0)!;
    const b = ex.executeNow({ id: "2", mint: "M", positionId: 1, tokens: 1e6, decidedAt: 0, reason: "max_hold", shadow: false }, 0)!;
    expect(a.solReceived).toBeLessThan(b.solReceived);
    expect(a.costs.penaltySol).toBeGreaterThan(0);
  });
});
