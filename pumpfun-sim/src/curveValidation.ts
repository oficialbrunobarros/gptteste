/**
 * Valida a fórmula da curva contra trades reais gravados em samples/trades.jsonl.
 * Para cada par consecutivo de trades da MESMA moeda: estado antes = reservas do trade anterior;
 * dado o solAmount do trade atual, o tokenAmount calculado deve bater com o real.
 * Testa duas hipóteses sobre `solAmount`: (a) já é o SOL líquido que entrou na curva; (b) é o bruto, com a taxa dentro.
 */
import fs from "node:fs";
import { buy, sell } from "./curve";

export interface ValidationReport {
  pairs: number;
  hypotheses: Array<{ name: string; meanAbsErrPct: number; medianAbsErrPct: number; p95AbsErrPct: number; within1pct: number }>;
  reserveConsistency: { meanAbsErrPct: number; pairs: number }; // |Δreal vSol − solAmount| / solAmount
  best: string;
}

interface Row { receivedAt: number; msg: { mint: string; txType: "buy" | "sell"; tokenAmount: number; solAmount: number; vSolInBondingCurve: number; vTokensInBondingCurve: number } }

export function validateCurveSamples(file: string, feePct: number): ValidationReport | null {
  if (!fs.existsSync(file)) return null;
  const rows: Row[] = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const byMint = new Map<string, Row[]>();
  for (const r of rows) { if (!byMint.has(r.msg.mint)) byMint.set(r.msg.mint, []); byMint.get(r.msg.mint)!.push(r); }
  const errs: Record<string, number[]> = { "solAmount líquido (sem taxa)": [], "solAmount bruto (taxa dentro)": [] };
  const reserveErrs: number[] = [];
  for (const list of byMint.values()) {
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1]!.msg, cur = list[i]!.msg;
      const before = { vSol: Number(prev.vSolInBondingCurve), vTokens: Number(prev.vTokensInBondingCurve) };
      const sol = Number(cur.solAmount), tokens = Number(cur.tokenAmount);
      if (!(sol > 0) || !(tokens > 0)) continue;
      if (cur.txType === "buy") {
        const net = buy(before, sol, 0).tokensOut;
        const gross = buy(before, sol, feePct).tokensOut;
        errs["solAmount líquido (sem taxa)"]!.push(Math.abs(net - tokens) / tokens * 100);
        errs["solAmount bruto (taxa dentro)"]!.push(Math.abs(gross - tokens) / tokens * 100);
        reserveErrs.push(Math.abs((Number(cur.vSolInBondingCurve) - before.vSol) - sol) / sol * 100);
      } else {
        const r = sell(before, tokens, 0);
        errs["solAmount líquido (sem taxa)"]!.push(Math.abs(r.solGross - sol) / sol * 100);
        errs["solAmount bruto (taxa dentro)"]!.push(Math.abs(r.solGross * (1 - feePct / 100) - sol) / sol * 100);
        reserveErrs.push(Math.abs((before.vSol - Number(cur.vSolInBondingCurve)) - sol) / sol * 100);
      }
    }
  }
  const stats = (xs: number[]) => {
    if (!xs.length) return { mean: NaN, median: NaN, p95: NaN, within1: 0 };
    const s = [...xs].sort((a, b) => a - b);
    return { mean: xs.reduce((a, b) => a + b, 0) / xs.length, median: s[Math.floor(s.length / 2)]!, p95: s[Math.floor(s.length * 0.95)]!, within1: xs.filter((x) => x < 1).length / xs.length };
  };
  const hypotheses = Object.entries(errs).map(([name, xs]) => { const st = stats(xs); return { name, meanAbsErrPct: st.mean, medianAbsErrPct: st.median, p95AbsErrPct: st.p95, within1pct: st.within1 }; });
  const rs = stats(reserveErrs);
  const best = hypotheses.slice().sort((a, b) => a.medianAbsErrPct - b.medianAbsErrPct)[0]?.name ?? "";
  return { pairs: reserveErrs.length, hypotheses, reserveConsistency: { meanAbsErrPct: rs.mean, pairs: reserveErrs.length }, best };
}
