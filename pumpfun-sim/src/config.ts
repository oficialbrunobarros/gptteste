import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import YAML from "yaml";
import { z } from "zod";
import { logger } from "./logger";

const pct = z.number().min(0).max(100);

export const ConfigSchema = z.object({
  feed: z.object({
    mode: z.enum(["pumpportal", "synthetic"]).default("pumpportal"),
    url: z.string().url().default("wss://pumpportal.fun/api/data"),
    maxWatched: z.number().int().positive().default(150),
    watchTtlSec: z.number().positive().default(900),
    heartbeatSec: z.number().positive().default(60),
  }).prefault({}),
  curve: z.object({
    feePct: pct.default(1.25),
    initialVirtualSol: z.number().positive().default(30),
    initialVirtualTokens: z.number().positive().default(1_073_000_000),
    graduationSol: z.number().positive().default(85),
    totalSupply: z.number().positive().default(1_000_000_000),
  }).prefault({}),
  costs: z.object({
    executionFeePct: pct.default(0.5),
    networkFeeSol: z.number().min(0).default(0.0005),
    latencyMs: z.number().min(0).default(1500),
    maxSlippagePct: pct.default(10),
  }).prefault({}),
  entry: z.object({
    minAgeSec: z.number().min(0).default(20),
    maxAgeSec: z.number().positive().default(600),
    minCurvePct: pct.default(8),
    maxCurvePct: pct.default(60),
    minUniqueBuyers60s: z.number().int().min(0).default(12),
    minBuySellRatio: z.number().min(0).default(1.5),
    maxTop10Pct: pct.default(35),
    creatorSoldBlocks: z.boolean().default(true),
    blockStrongBundle: z.boolean().default(true),
    maxOpenPositions: z.number().int().positive().default(4),
  }).prefault({}),
  exit: z.object({
    takeProfitPct: z.number().positive().default(15),
    stopLossPct: z.number().positive().default(8),
    maxHoldSec: z.number().positive().default(180),
    trailingPct: z.number().positive().nullable().default(null),
    migrationPenaltyPct: pct.default(5),
  }).prefault({}),
  risk: z.object({
    bankrollUsd: z.number().positive().default(100),
    positionUsd: z.number().positive().default(8),
    dailyLossLimitUsd: z.number().positive().default(15),
    consecutiveStopsForCooldown: z.number().int().positive().default(3),
    cooldownMin: z.number().min(0).default(10),
    solPriceFallbackUsd: z.number().positive().default(150),
    solPriceCacheMin: z.number().positive().default(5),
    timezone: z.string().default("America/Sao_Paulo"),
  }).prefault({}),
  jev: z.object({
    enabled: z.union([z.literal("auto"), z.boolean()]).default("auto"),
    model: z.string().default("jev-latest"),
    timeoutMs: z.number().positive().default(800),
    scamConfidence: z.number().min(0).max(1).default(0.7),
    metadataTimeoutMs: z.number().positive().default(1500),
    shadow: z.boolean().default(true),
  }).prefault({}),
  db: z.object({
    path: z.string().default("data/sim.db"),
    tradesRetentionDays: z.number().positive().default(7),
    equityIntervalSec: z.number().positive().default(60),
  }).prefault({}),
  dashboard: z.object({
    port: z.number().int().positive().default(3000),
  }).prefault({}),
  report: z.object({
    dailyAt: z.string().regex(/^\d{2}:\d{2}$/).default("23:55"),
    dir: z.string().default("reports"),
  }).prefault({}),
  backtest: z.object({
    grid: z.object({
      takeProfitPct: z.array(z.number().positive()).default([10, 15, 20, 30]),
      stopLossPct: z.array(z.number().positive()).default([5, 8, 12]),
      maxHoldSec: z.array(z.number().positive()).default([90, 180, 300]),
      minUniqueBuyers60s: z.array(z.number().int().min(0)).default([8, 12, 18]),
      minCurvePct: z.array(pct).default([5, 8, 15]),
    }).prefault({}),
  }).prefault({}),
});

export type Config = z.infer<typeof ConfigSchema>;

export function parseConfig(raw: unknown): Config {
  return ConfigSchema.parse(raw ?? {});
}

export function loadConfig(file = process.env.CONFIG_PATH ?? "config.yaml"): Config {
  const text = fs.readFileSync(path.resolve(file), "utf8");
  const cfg = parseConfig(YAML.parse(text));
  // Sobrescritas por ambiente (úteis em testes e no pm2)
  if (process.env.FEED_MODE === "synthetic" || process.env.FEED_MODE === "pumpportal") cfg.feed.mode = process.env.FEED_MODE;
  if (process.env.PORT) cfg.dashboard.port = Number(process.env.PORT);
  if (process.env.DB_PATH) cfg.db.path = process.env.DB_PATH;
  return cfg;
}

/**
 * Configuração viva: mantém a versão atual e recarrega a quente quando o arquivo mudar.
 * Se a nova versão for inválida, mantém a anterior e registra o erro.
 */
export class LiveConfig extends EventEmitter {
  current: Config;
  private timer?: NodeJS.Timeout;
  private lastMtime = 0;

  constructor(readonly file = process.env.CONFIG_PATH ?? "config.yaml") {
    super();
    this.current = loadConfig(file);
  }

  watch(intervalMs = 2000): void {
    try { this.lastMtime = fs.statSync(this.file).mtimeMs; } catch { /* ignora */ }
    this.timer = setInterval(() => {
      let mtime = 0;
      try { mtime = fs.statSync(this.file).mtimeMs; } catch { return; }
      if (mtime === this.lastMtime) return;
      this.lastMtime = mtime;
      try {
        const next = loadConfig(this.file);
        this.current = next;
        logger.info("config recarregada a quente");
        this.emit("reload", next);
      } catch (err) {
        logger.error({ err }, "config.yaml inválido; mantendo configuração anterior");
        this.emit("error", err);
      }
    }, intervalMs);
    this.timer.unref();
  }

  stop(): void { if (this.timer) clearInterval(this.timer); }
}
