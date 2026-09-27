import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { validateCurveSamples } from "../src/curveValidation";
import { SyntheticFeed } from "../src/feed/synthetic";

const REAL = path.resolve("samples/trades.jsonl");

describe("validação da fórmula da curva", () => {
  it.skipIf(!fs.existsSync(REAL))("bate com trades REAIS do PumpPortal (samples/trades.jsonl)", () => {
    const rep = validateCurveSamples(REAL, 1.25)!;
    expect(rep.pairs).toBeGreaterThan(10);
    const best = rep.hypotheses.find((h) => h.name === rep.best)!;
    // tolerância pequena: mediana < 0,5% e ao menos 90% dos pares com erro < 1%
    expect(best.medianAbsErrPct).toBeLessThan(0.5);
    expect(best.within1pct).toBeGreaterThan(0.9);
  });

  it("(sem amostras reais) o validador reconhece uma sequência coerente gerada pela própria fórmula", async () => {
    // Isto NÃO valida a fórmula contra a realidade; só garante que o validador e o gerador estão consistentes.
    const tmp = path.resolve("data/.synthetic-trades.jsonl");
    const feed = new SyntheticFeed({ seed: 3, newTokenEveryMs: 1000, speed: 1 });
    const lines: string[] = [];
    feed.on("newToken", (m) => feed.subscribeToken(m.mint));
    feed.on("trade", (m) => lines.push(JSON.stringify({ receivedAt: 0, msg: m })));
    (feed as any).running = true; (feed as any).simNow = 0; (feed as any).nextTokenAt = 100;
    for (let t = 0; t < 120_000; t += 250) feed.step(t);
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.writeFileSync(tmp, lines.join("\n") + "\n");
    const rep = validateCurveSamples(tmp, 1.25)!;
    fs.unlinkSync(tmp);
    expect(rep.pairs).toBeGreaterThan(50);
    expect(rep.best).toBe("solAmount líquido (sem taxa)");
    expect(rep.hypotheses.find((h) => h.name === rep.best)!.meanAbsErrPct).toBeLessThan(1e-6);
    expect(rep.reserveConsistency.meanAbsErrPct).toBeLessThan(1e-6);
  });
});
