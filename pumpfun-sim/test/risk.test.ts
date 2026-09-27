import { describe, expect, it } from "vitest";
import { RiskManager } from "../src/risk/manager";
import { localDateStr, nextMidnight, nextLocalTime } from "../src/risk/time";
import { testConfig } from "./helpers";

const TZ = "America/Sao_Paulo";

describe("tempo local", () => {
  it("meia-noite de São Paulo (UTC-3)", () => {
    const ts = Date.UTC(2026, 0, 15, 20, 0, 0); // 17:00 local
    const mid = nextMidnight(ts, TZ);
    expect(new Date(mid).toISOString()).toBe("2026-01-16T03:00:00.000Z");
    expect(localDateStr(mid - 1, TZ)).toBe("2026-01-15");
    expect(localDateStr(mid, TZ)).toBe("2026-01-16");
  });
  it("próximo 23:55 local", () => {
    const ts = Date.UTC(2026, 0, 15, 20, 0, 0);
    expect(new Date(nextLocalTime(ts, "23:55", TZ)).toISOString()).toBe("2026-01-16T02:55:00.000Z");
    const late = Date.UTC(2026, 0, 16, 2, 58, 0); // 23:58 local
    expect(new Date(nextLocalTime(late, "23:55", TZ)).toISOString()).toBe("2026-01-17T02:55:00.000Z");
  });
});

describe("RiskManager", () => {
  const cfg = testConfig({ risk: { dailyLossLimitUsd: 15, positionUsd: 8, consecutiveStopsForCooldown: 3, cooldownMin: 10 } });
  const solUsd = () => 100;
  it("tamanho da posição em SOL e caixa", () => {
    const r = new RiskManager(cfg, solUsd, 1, 0);
    expect(r.positionSol()).toBeCloseTo(0.08, 9);
    expect(r.canOpen(0, 0).ok).toBe(true);
    expect(r.canOpen(0, 4).reason).toBe("max_open_positions");
    r.onBuy(0.99);
    expect(r.canOpen(0, 0).reason).toBe("bankroll_insufficient");
  });
  it("limite de perda diária para até a meia-noite local", () => {
    const events: string[] = [];
    const t0 = Date.UTC(2026, 0, 15, 20, 0, 0);
    const r = new RiskManager(cfg, solUsd, 1, t0, {}, (t) => events.push(t));
    r.onClose(t0, 0, -0.10, true);  // -US$10
    expect(r.canOpen(t0, 0).ok).toBe(true);
    r.onClose(t0 + 1000, 0, -0.06, true); // total -16
    expect(r.canOpen(t0 + 2000, 0).reason).toBe("daily_loss_limit");
    expect(events).toContain("daily_limit_hit");
    const mid = nextMidnight(t0, "America/Sao_Paulo");
    expect(r.canOpen(mid + 1000, 0).ok).toBe(true);
    expect(r.snapshot().dailyPnlUsd).toBe(0);
  });
  it("cooldown depois de 3 stops seguidos", () => {
    const r = new RiskManager(cfg, solUsd, 1, 0);
    r.onClose(0, 0.07, -0.01, true); r.onClose(1000, 0.07, -0.01, true);
    expect(r.canOpen(2000, 0).ok).toBe(true);
    r.onClose(2000, 0.07, -0.01, true);
    expect(r.canOpen(3000, 0).reason).toBe("cooldown");
    expect(r.canOpen(3000 + 10 * 60_000, 0).ok).toBe(true);
    // um ganho zera a contagem
    r.onClose(0, 0.07, -0.01, true); r.onClose(0, 0.07, -0.01, true); r.onClose(0, 0.09, 0.01, false); r.onClose(0, 0.07, -0.01, true);
    expect(r.canOpen(3000 + 10 * 60_000, 0).ok).toBe(true);
  });
});
