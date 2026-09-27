/**
 * Ponto de entrada: `npm start`.
 * Sobe feed (WebSocket), motor, executor de papel, painel e agendador do relatório diário.
 */
import "dotenv/config";
import { LiveConfig } from "./config";
import { SimDb } from "./db/db";
import { Engine } from "./strategy/engine";
import { PaperExecutor, costsFromConfig } from "./executor/PaperExecutor";
import { RiskManager } from "./risk/manager";
import { SolPrice } from "./risk/solPrice";
import { JevFilter } from "./jev/client";
import { PumpPortalFeed } from "./feed/pumpportal";
import { SyntheticFeed } from "./feed/synthetic";
import type { Feed } from "./feed/types";
import { startDashboard } from "./dashboard/server";
import { writeReport } from "./reports/daily";
import { nextLocalTime } from "./risk/time";
import { logger } from "./logger";

async function main(): Promise<void> {
  const live = new LiveConfig();
  const cfg = () => live.current;
  const c0 = live.current;
  logger.info({ feed: c0.feed.mode, db: c0.db.path, port: c0.dashboard.port }, "iniciando simulador (PAPER TRADING — nada vai à blockchain)");

  const db = new SimDb(c0.db.path);
  const solPrice = new SolPrice(c0.risk.solPriceFallbackUsd, c0.risk.solPriceCacheMin * 60_000);
  const solUsd = await solPrice.get();
  db.kvSet("sol_usd", String(solUsd));

  // banca: continua de onde parou, a menos que RESET_BANKROLL=1
  const saved = db.kvGet("bankroll_sol");
  let bankrollSol = saved && process.env.RESET_BANKROLL !== "1" ? Number(saved) : c0.risk.bankrollUsd / solUsd;
  // posições órfãs de uma execução anterior (queda sem encerramento gracioso): devolve o caixa, fecha a zero
  for (const p of db.orphanOpenPositions()) {
    bankrollSol += p.sol_spent;
    db.closePosition({ id: p.id, shadow: false, closedAt: Date.now(), exitReason: "shutdown", exitPrice: p.entry_price, solReceived: p.sol_spent, costCurveFee: 0, costExecFee: 0, costNetworkFee: 0, costPenalty: 0, pnlGrossSol: 0, pnlNetSol: 0, pnlNetUsd: 0, pnlNetPct: 0, durationSec: 0, peakNetPct: 0 });
    db.event(Date.now(), "orphan_position_closed", { id: p.id, mint: p.mint });
  }
  const todayPnl = db.positions({ status: "closed", sinceTs: Date.now() - 86_400_000 }).reduce((a, r) => a + (r.pnl_net_usd ?? 0), 0);
  const risk = new RiskManager(c0, () => solPrice.current(), bankrollSol, Date.now(), { dailyPnlUsd: todayPnl }, (type, detail) => { db.event(Date.now(), type, detail); logger.warn({ type, ...detail }, "evento de risco"); });
  logger.info({ bankrollSol: +bankrollSol.toFixed(4), solUsd, positionSol: +risk.positionSol().toFixed(4) }, "banca simulada");

  const feed: Feed = c0.feed.mode === "synthetic"
    ? new SyntheticFeed({ newTokenEveryMs: Number(process.env.SYNTH_TOKEN_MS ?? 4000), seed: Number(process.env.SYNTH_SEED ?? Date.now() % 100000) })
    : new PumpPortalFeed({ url: c0.feed.url, heartbeatSec: c0.feed.heartbeatSec });
  const jev = new JevFilter(c0);
  // o executor consulta o estado da curva no motor no instante da execução (latência)
  const executor = new PaperExecutor((m) => engine.curveState(m), costsFromConfig(c0));
  const engine: Engine = new Engine({ cfg, feed, db, executor, risk, jev, solUsd: () => solPrice.current() });

  feed.on("newToken", (m, ts) => engine.onNewToken(m, ts));
  feed.on("trade", (m, ts) => engine.onTrade(m, ts));
  feed.on("migration", (m, ts) => engine.onMigration(m, ts));
  feed.on("status", (s) => { db.event(Date.now(), s.connected ? "ws_connected" : "ws_disconnected", { reconnects: s.reconnects, detail: s.detail ?? null }); });

  live.on("reload", (next) => { executor.setCosts(costsFromConfig(next)); risk.setConfig(next); jev.configure(next); solPrice.configure(next.risk.solPriceFallbackUsd, next.risk.solPriceCacheMin * 60_000); db.event(Date.now(), "config_reloaded", {}); });
  live.watch();

  const dash = startDashboard({ engine, db, feed, risk, cfg: live, solUsd: () => solPrice.current(), solSource: () => solPrice.source() }, c0.dashboard.port);
  await feed.start();

  const tick = setInterval(() => { try { engine.tick(Date.now()); } catch (err) { logger.error({ err }, "erro no tick"); } }, 250);
  const flush = setInterval(() => { db.flushTrades(); db.kvSet("engine_stats", JSON.stringify(engine.getStats())); }, 1000);
  const price = setInterval(() => { void solPrice.get().then((p) => db.kvSet("sol_usd", String(p))); }, 60_000);
  const status = setInterval(() => {
    const s = engine.getStats(); const r = risk.snapshot();
    logger.info({ watched: s.watched, tokens: s.tokensSeen, trades: s.tradesSeen, evals: s.evaluations, entries: s.entriesSubmitted, open: s.openPositions, bankrollSol: +r.bankrollSol.toFixed(4), dailyPnlUsd: +r.dailyPnlUsd.toFixed(2), feed: feed.status().connected }, "status");
    const top = Object.entries(s.rejections).sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (top.length) logger.info({ rejections: Object.fromEntries(top) }, "filtros que mais rejeitam");
  }, 60_000);

  // relatório diário às HH:MM locais
  let reportTimer: NodeJS.Timeout | undefined;
  const scheduleReport = () => {
    const at = nextLocalTime(Date.now(), cfg().report.dailyAt, cfg().risk.timezone);
    reportTimer = setTimeout(() => {
      try { const file = writeReport(db, cfg()); logger.info({ file }, "relatório diário gerado"); db.event(Date.now(), "daily_report", { file }); }
      catch (err) { logger.error({ err }, "falha ao gerar relatório diário"); }
      scheduleReport();
    }, at - Date.now());
    logger.info({ at: new Date(at).toISOString() }, "relatório diário agendado");
  };
  scheduleReport();

  let shuttingDown = false;
  const shutdown = async (sig: string) => {
    if (shuttingDown) return; shuttingDown = true;
    logger.warn({ sig }, "encerrando: fechando posições simuladas a mercado e salvando");
    clearInterval(tick); clearInterval(flush); clearInterval(price); clearInterval(status); if (reportTimer) clearTimeout(reportTimer);
    live.stop();
    try { engine.closeAll(Date.now()); } catch (err) { logger.error({ err }, "erro ao fechar posições"); }
    db.event(Date.now(), "shutdown", { sig, stats: engine.getStats() });
    db.kvSet("engine_stats", JSON.stringify(engine.getStats()));
    await feed.stop();
    await dash.close();
    db.close();
    logger.info("encerrado");
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("uncaughtException", (err) => { logger.fatal({ err }, "exceção não tratada"); db.event(Date.now(), "error", { message: err.message }); });
  process.on("unhandledRejection", (err) => { logger.error({ err }, "rejeição não tratada"); });
}

main().catch((err) => { logger.fatal({ err }, "falha ao iniciar"); process.exit(1); });
