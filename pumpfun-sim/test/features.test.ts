import { describe, expect, it } from "vitest";
import { TokenState } from "../src/features/tokenState";
import { DEFAULT_CURVE_PARAMS } from "../src/curve";
import { MiniMarket, newTokenMsg } from "./helpers";

describe("TokenState (features)", () => {
  it("janelas, compradores únicos e razão compra/venda", () => {
    const t0 = 1_000_000;
    const { msg, state } = newTokenMsg("M", "CREATOR", 0.5, t0);
    const tok = new TokenState(msg, t0, DEFAULT_CURVE_PARAMS);
    const mk = new MiniMarket(state);
    for (let i = 0; i < 15; i++) tok.onTrade(mk.buy("B" + i, 0.2), t0 + 5000 + i * 1000);
    tok.onTrade(mk.sell("B1", mk.balances.get("B1")!), t0 + 21_000);
    const f = tok.snapshot(t0 + 22_000);
    expect(f.w60.uniqueBuyers).toBe(15);
    expect(f.w60.sells).toBe(1);
    expect(f.w60.buySellRatio).toBeGreaterThan(1);
    expect(f.w10.uniqueBuyers).toBeLessThan(f.w60.uniqueBuyers);
    expect(f.ageSec).toBeCloseTo(22, 5);
    expect(f.curvePct).toBeGreaterThan(0);
    expect(f.holders).toBe(15); // 14 compradores + criador (B1 zerou)
    expect(f.priceChg60sPct).toBeGreaterThan(0);
  });

  it("concentração: top-1 domina quando uma carteira compra tudo", () => {
    const { msg, state } = newTokenMsg("M", "CREATOR", 0, 0);
    const tok = new TokenState(msg, 0, DEFAULT_CURVE_PARAMS);
    const mk = new MiniMarket(state);
    tok.onTrade(mk.buy("WHALE", 5), 1000);
    tok.onTrade(mk.buy("SMALL", 0.01), 2000);
    const f = tok.snapshot(3000);
    expect(f.top1Pct).toBeGreaterThan(95);
    expect(f.top10Pct).toBeCloseTo(100, 6);
  });

  it("criador: compra na criação e venda posterior marca creatorSold", () => {
    const { msg, state } = newTokenMsg("M", "DEV", 1, 0);
    const tok = new TokenState(msg, 0, DEFAULT_CURVE_PARAMS);
    expect(tok.creatorBoughtSol).toBeGreaterThan(0.9);
    expect(tok.creatorSold).toBe(false);
    const mk = new MiniMarket(state); mk.balances.set("DEV", msg.initialBuy!);
    tok.onTrade(mk.buy("X", 0.3), 1000);
    expect(tok.snapshot(1500).creatorHoldsPct).toBeGreaterThan(50);
    tok.onTrade(mk.sell("DEV", msg.initialBuy! / 2), 2000);
    expect(tok.creatorSold).toBe(true);
  });

  it("bundle: várias compras parecidas no mesmo segundo da criação => forte", () => {
    const { msg, state } = newTokenMsg("M", "DEV", 0.1, 0);
    const tok = new TokenState(msg, 0, DEFAULT_CURVE_PARAMS);
    const mk = new MiniMarket(state);
    for (let i = 0; i < 7; i++) tok.onTrade(mk.buy("BOT" + i, 0.5), 100 + i * 50);
    expect(tok.bundle().signal).toBe("strong");
    expect(tok.bundle().count).toBe(7);
    // compras variadas e mais tarde não contam
    const { msg: m2, state: s2 } = newTokenMsg("N", "DEV", 0.1, 0);
    const tok2 = new TokenState(m2, 0, DEFAULT_CURVE_PARAMS);
    const mk2 = new MiniMarket(s2);
    for (let i = 0; i < 7; i++) tok2.onTrade(mk2.buy("U" + i, 0.1 + i * 0.3), 5000 + i * 1000);
    expect(tok2.bundle().signal).toBe("none");
  });

  it("maior queda recente é detectada", () => {
    const { msg, state } = newTokenMsg("M", "DEV", 0, 0);
    const tok = new TokenState(msg, 0, DEFAULT_CURVE_PARAMS);
    const mk = new MiniMarket(state);
    tok.onTrade(mk.buy("A", 5), 1000);
    tok.onTrade(mk.sell("A", mk.balances.get("A")! * 0.9), 2000);
    expect(tok.snapshot(3000).maxDrawdown60sPct).toBeGreaterThan(20);
  });
});
