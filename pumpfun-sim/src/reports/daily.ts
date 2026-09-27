import fs from "node:fs";
import path from "node:path";
import type { SimDb } from "../db/db";
import type { Config } from "../config";
import { ageBucket, curveBucket, featureComparison, groupBy, jevBreakdown, summarize, type Summary } from "./metrics";
import { localDateStr } from "../risk/time";

const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : x === Infinity ? "∞" : "-");
const pct = (x: number) => f(x * 100, 1) + "%";

function summaryTable(s: Summary): string {
  return [
    "| Métrica | Valor |", "|---|---|",
    `| Operações fechadas | ${s.n} (${s.wins} ganhas / ${s.losses} perdidas) |`,
    `| Taxa de acerto | ${pct(s.winRate)} |`,
    `| PnL líquido | ${f(s.netSol, 5)} SOL (US$ ${f(s.netUsd)}) |`,
    `| Fator de lucro | ${f(s.profitFactor)} |`,
    `| Expectativa por operação | ${f(s.expectancyPct)}% |`,
    `| Ganho médio / perda média | ${f(s.avgWinPct)}% / ${f(s.avgLossPct)}% |`,
    `| Drawdown máximo | ${f(s.maxDrawdownPct)}% |`,
    `| Operações por hora | ${f(s.tradesPerHour)} |`,
    `| Lucro por hora | US$ ${f(s.pnlPerHourUsd)} |`,
    `| Tempo médio de posição | ${f(s.avgDurationSec, 0)} s |`,
    `| Custos totais (taxas) | ${f(s.totalCostsSol, 5)} SOL |`,
  ].join("\n");
}

function bucketTable(title: string, b: ReturnType<typeof groupBy>): string {
  if (!b.length) return `### ${title}\n\n_sem dados_\n`;
  return `### ${title}\n\n| Faixa | N | Acerto | PnL líq. (SOL) | Média % |\n|---|---|---|---|---|\n` +
    b.map((x) => `| ${x.key} | ${x.n} | ${pct(x.winRate)} | ${f(x.netSol, 5)} | ${f(x.avgPct)}% |`).join("\n") + "\n";
}

export function buildReport(db: SimDb, cfg: Config, date: string): string {
  const all = db.positions({ status: "closed" });
  const shadow = db.positions({ shadow: true, status: "closed" });
  const day = all.filter((r) => localDateStr(r.closed_at ?? 0, cfg.risk.timezone) === date);
  const eqAll = db.equityCurve(0, 100000);
  const sAll = summarize(all, eqAll);
  const sDay = summarize(day);
  const sorted = [...day].sort((a, b) => (b.pnl_net_sol ?? 0) - (a.pnl_net_sol ?? 0));
  const best = sorted.slice(0, 10), worst = sorted.slice(-10).reverse();
  const row = (r: typeof all[number]) => `| ${r.id} | ${r.symbol} | ${r.exit_reason} | ${f(r.pnl_net_pct ?? 0)}% | ${f(r.pnl_net_sol ?? 0, 5)} | ${f(r.duration_sec ?? 0, 0)}s | ${r.jev ? (JSON.parse(r.jev).category ?? "erro") : "-"} |`;
  const opsHeader = "| # | Símbolo | Saída | PnL % | PnL SOL | Duração | Jev |\n|---|---|---|---|---|---|---|";
  const feats = featureComparison(day.length >= 10 ? day : all);
  const events = db.events(200).filter((e) => localDateStr(e.ts, cfg.risk.timezone) === date && ["daily_limit_hit", "cooldown", "reconnect", "error", "migration"].includes(e.type));
  const stats = db.kvGet("engine_stats");
  const parsedStats = stats ? JSON.parse(stats) as { rejections?: Record<string, number>; evaluations?: number; tokensSeen?: number } : null;

  return `# Relatório diário — ${date}

Simulação (paper trading) de scalping em memecoins da Pump.fun. Fuso: ${cfg.risk.timezone}.

## Resultado do dia

${summaryTable(sDay)}

## Acumulado (desde o início)

${summaryTable(sAll)}

## Quebra do resultado

${bucketTable("Por motivo de saída", groupBy(day, (r) => r.exit_reason ?? "?"))}
${bucketTable("Por idade na entrada", groupBy(day, (_r, ft) => ageBucket(ft)))}
${bucketTable("Por % da curva na entrada", groupBy(day, (_r, ft) => curveBucket(ft)))}
### Com × sem Jev (inclui sombra)

| Grupo | N | Acerto | PnL líq. (SOL) | Fator de lucro |
|---|---|---|---|---|
${jevBreakdown(all, shadow).map((j) => `| ${j.group} | ${j.s.n} | ${pct(j.s.winRate)} | ${f(j.s.netSol, 5)} | ${f(j.s.profitFactor)} |`).join("\n")}

## 10 melhores operações do dia

${opsHeader}
${best.map(row).join("\n") || "| - | | | | | | |"}

## 10 piores operações do dia

${opsHeader}
${worst.map(row).join("\n") || "| - | | | | | | |"}

## Quais filtros separam ganhadoras de perdedoras

Médias das features na ENTRADA (${day.length >= 10 ? "operações do dia" : "acumulado, pois o dia tem menos de 10 operações"}). Diferenças grandes sugerem onde apertar/afrouxar o \`config.yaml\`.

| Feature | Ganhadoras | Perdedoras | Dif. |
|---|---|---|---|
${feats.map((x) => `| ${x.feature} | ${f(x.winners)} | ${f(x.losers)} | ${f(x.diffPct, 0)}% |`).join("\n")}

## Rejeições por filtro (contadores da execução atual)

${parsedStats?.rejections ? Object.entries(parsedStats.rejections).sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${k}: ${v}`).join("\n") : "_indisponível_"}

Avaliações de entrada: ${parsedStats?.evaluations ?? "-"} · Moedas vistas: ${parsedStats?.tokensSeen ?? "-"}

## Eventos relevantes do dia

${events.length ? events.map((e) => `- ${new Date(e.ts).toISOString()} **${e.type}** ${e.detail}`).join("\n") : "_nenhum_"}

## Parâmetros vigentes

\`\`\`yaml
entry: ${JSON.stringify(cfg.entry)}
exit: ${JSON.stringify(cfg.exit)}
costs: ${JSON.stringify(cfg.costs)}
risk: ${JSON.stringify({ positionUsd: cfg.risk.positionUsd, dailyLossLimitUsd: cfg.risk.dailyLossLimitUsd })}
\`\`\`

> Limitações: simulação sem execução real; a nossa ordem não altera a curva de verdade; latência e slippage são modelados, não medidos; MEV/sandwich e falhas de transação não são simulados.
`;
}

export function writeReport(db: SimDb, cfg: Config, date = localDateStr(Date.now(), cfg.risk.timezone)): string {
  const dir = path.resolve(cfg.report.dir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${date}.md`);
  fs.writeFileSync(file, buildReport(db, cfg, date));
  return file;
}
