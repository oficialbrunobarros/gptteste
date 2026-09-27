import fs from "node:fs";
import { validateCurveSamples } from "../src/curveValidation";
import { loadConfig } from "../src/config";

const cfg = loadConfig();
const rep = validateCurveSamples("samples/trades.jsonl", cfg.curve.feePct);
if (!rep) { console.log("samples/trades.jsonl ausente — rode `npm run sample` primeiro"); process.exit(1); }
console.log(`pares consecutivos analisados: ${rep.pairs}`);
console.log(`consistência das reservas |ΔvSol − solAmount|: erro médio ${rep.reserveConsistency.meanAbsErrPct.toFixed(4)}%`);
for (const h of rep.hypotheses) console.log(`hipótese "${h.name}": erro médio ${h.meanAbsErrPct.toFixed(4)}% · mediana ${h.medianAbsErrPct.toFixed(4)}% · p95 ${h.p95AbsErrPct.toFixed(3)}% · <1%: ${(h.within1pct * 100).toFixed(1)}%`);
console.log(`melhor hipótese: ${rep.best}`);
fs.writeFileSync("samples/curve-validation.json", JSON.stringify({ generatedAt: new Date().toISOString(), feePct: cfg.curve.feePct, ...rep }, null, 2));
console.log("gravado em samples/curve-validation.json");
