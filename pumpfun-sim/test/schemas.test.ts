import { describe, expect, it } from "vitest";
import { classify } from "../src/feed/schemas";
import { parseConfig } from "../src/config";

describe("schemas do PumpPortal", () => {
  it("classifica criação, trade, migração e serviço", () => {
    expect(classify({ signature: "x", mint: "M", traderPublicKey: "T", txType: "create", initialBuy: 1e6, solAmount: 0.5, vTokensInBondingCurve: 1e9, vSolInBondingCurve: 30.5, marketCapSol: 30, name: "a", symbol: "A", uri: "u", pool: "pump" }).kind).toBe("newToken");
    const t = classify({ signature: "x", mint: "M", traderPublicKey: "T", txType: "buy", tokenAmount: 1000, solAmount: 0.1, newTokenBalance: 1000, vTokensInBondingCurve: 1e9, vSolInBondingCurve: 30.6, marketCapSol: 30, pool: "pump" });
    expect(t.kind).toBe("trade");
    expect(classify({ signature: "x", mint: "M", txType: "migrate", pool: "pump-amm" }).kind).toBe("migration");
    expect(classify({ message: "Successfully subscribed to token creation events." }).kind).toBe("service");
    expect(classify({ foo: 1 }).kind).toBe("unknown");
    expect(classify("str").kind).toBe("unknown");
  });
  it("aceita números como string (coerção) e mantém campos extras", () => {
    const m = classify({ mint: "M", traderPublicKey: "T", txType: "sell", tokenAmount: "10", solAmount: "0.1", vTokensInBondingCurve: "1e9", vSolInBondingCurve: "30", extra: true });
    expect(m.kind).toBe("trade");
    if (m.kind === "trade") { expect(m.data.tokenAmount).toBe(10); expect((m.data as any).extra).toBe(true); }
  });
  it("rejeita trade sem reservas", () => {
    expect(classify({ mint: "M", traderPublicKey: "T", txType: "buy", tokenAmount: 1, solAmount: 1 }).kind).toBe("unknown");
  });
});

describe("config", () => {
  it("aplica padrões e valida", () => {
    const c = parseConfig({});
    expect(c.entry.minUniqueBuyers60s).toBe(12);
    expect(c.exit.trailingPct).toBeNull();
    expect(() => parseConfig({ exit: { stopLossPct: -1 } })).toThrow();
    expect(() => parseConfig({ feed: { mode: "live" } })).toThrow();
  });
});
