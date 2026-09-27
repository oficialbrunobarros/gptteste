import { describe, expect, it } from "vitest";
import { buy, sell, spotPrice, curveFillPct, initialState, solForExactTokens, DEFAULT_CURVE_PARAMS as P } from "../src/curve";

const s0 = initialState(P);

describe("curve", () => {
  it("preço à vista inicial é vSol/vTokens", () => {
    expect(spotPrice(s0)).toBeCloseTo(30 / 1_073_000_000, 18);
  });

  it("compra mantém o produto constante e aplica a taxa antes", () => {
    const r = buy(s0, 1, 1.25);
    expect(r.fee).toBeCloseTo(0.0125, 12);
    expect(r.solNet).toBeCloseTo(0.9875, 12);
    expect(r.after.vSol * r.after.vTokens).toBeCloseTo(s0.vSol * s0.vTokens, -2);
    expect(r.tokensOut).toBeGreaterThan(0);
    // preço médio pago fica acima do preço à vista (impacto)
    expect(r.avgPrice).toBeGreaterThan(spotPrice(s0));
    expect(r.avgPrice).toBeLessThan(spotPrice(r.after));
  });

  it("venda mantém o produto constante e aplica a taxa sobre o SOL de saída", () => {
    const b = buy(s0, 2, 1.25);
    const r = sell(b.after, b.tokensOut, 1.25);
    expect(r.after.vSol * r.after.vTokens).toBeCloseTo(b.after.vSol * b.after.vTokens, -2);
    expect(r.fee).toBeCloseTo(r.solGross * 0.0125, 12);
  });

  it("ida e volta perde aproximadamente 2x a taxa", () => {
    const fee = 1.25;
    const b = buy(s0, 0.5, fee);
    const r = sell(b.after, b.tokensOut, fee);
    const lossPct = (1 - r.solOut / 0.5) * 100;
    // exatamente: 1 - (1-f)^2 ≈ 2f - f²  => 2.484%
    expect(lossPct).toBeCloseTo(2 * fee - (fee * fee) / 100, 6);
  });

  it("sem taxa a ida e volta é neutra", () => {
    const b = buy(s0, 3, 0);
    const r = sell(b.after, b.tokensOut, 0);
    expect(r.solOut).toBeCloseTo(3, 9);
  });

  it("compra grande sobe o preço; compras sucessivas pequenas equivalem a uma grande", () => {
    const big = buy(s0, 10, 0);
    let s = s0; let tokens = 0;
    for (let i = 0; i < 100; i++) { const r = buy(s, 0.1, 0); tokens += r.tokensOut; s = r.after; }
    expect(tokens).toBeCloseTo(big.tokensOut, 3);
    expect(spotPrice(big.after)).toBeGreaterThan(spotPrice(s0));
  });

  it("% da curva: 0% no início, 100% em ~85 SOL reais", () => {
    expect(curveFillPct(s0, P)).toBe(0);
    expect(curveFillPct({ vSol: 30 + 42.5, vTokens: 1 }, P)).toBeCloseTo(50, 9);
    expect(curveFillPct({ vSol: 30 + 85, vTokens: 1 }, P)).toBeCloseTo(100, 9);
    expect(curveFillPct({ vSol: 500, vTokens: 1 }, P)).toBe(100);
  });

  it("solForExactTokens é a inversa da compra sem taxa", () => {
    const r = buy(s0, 1.234, 0);
    expect(solForExactTokens(s0, r.tokensOut)).toBeCloseTo(1.234, 9);
    expect(solForExactTokens(s0, s0.vTokens)).toBe(Infinity);
  });

  it("casos-limite rejeitam entradas inválidas", () => {
    expect(() => buy(s0, 0, 1.25)).toThrow();
    expect(() => buy(s0, -1, 1.25)).toThrow();
    expect(() => sell(s0, 0, 1.25)).toThrow();
    expect(() => buy({ vSol: 0, vTokens: 1 }, 1, 1.25)).toThrow();
    expect(() => buy({ vSol: NaN, vTokens: 1 }, 1, 1.25)).toThrow();
  });

  it("vender mais tokens do que o fornecimento não produz SOL acima da reserva", () => {
    const r = sell(s0, 1e15, 0);
    expect(r.solOut).toBeLessThan(s0.vSol);
    expect(r.after.vSol).toBeGreaterThan(0);
  });
});
