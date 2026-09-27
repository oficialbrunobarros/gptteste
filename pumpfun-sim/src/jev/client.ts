/**
 * Filtro Jev — TypeSafe System One (POST https://api.typesafe.ai/v1/systemone) via SDK oficial.
 * O formato de estado/perguntas segue os tipos do pacote @typesafe-ai/sdk (noul / score / choice).
 * Sem TYPESAFE_API_KEY o filtro fica desligado e o sistema segue normalmente.
 */
import { TypeSafeClient, noul, score, choice } from "@typesafe-ai/sdk";
import type { Config } from "../config";
import type { FeatureSnapshot } from "../features/tokenState";
import { logger } from "../logger";

export interface JevResult {
  model: string;
  latencyMs: number;
  isLikelyScam: number;          // probabilidade 0..1 (noul)
  memeTraction: number;          // score esperado 0..10
  category: "meme_forte" | "meme_fraco" | "golpe_provavel" | "incerto";
  categoryConfidence: number;
  veto: boolean;
  timedOut?: false;
  error?: undefined;
}
export interface JevFailure { timedOut: boolean; error: string; latencyMs: number }
export type JevOutcome = JevResult | JevFailure | null; // null = filtro desligado

export interface TokenMeta { name: string; symbol: string; uri: string; description?: string }

export class JevFilter {
  private client: TypeSafeClient | null = null;
  private descCache = new Map<string, string>();

  constructor(private cfg: Config) { this.configure(cfg); }

  configure(cfg: Config): void {
    this.cfg = cfg;
    const key = process.env.TYPESAFE_API_KEY?.trim();
    const wanted = cfg.jev.enabled === "auto" ? !!key : cfg.jev.enabled;
    if (wanted && key) {
      if (!this.client) {
        this.client = new TypeSafeClient({ apiKey: key, defaultModel: cfg.jev.model, timeout: cfg.jev.timeoutMs, retry: { maxRetries: 0 }, logLevel: "off" });
        logger.info({ model: cfg.jev.model }, "filtro Jev ativado");
      }
    } else {
      if (this.client) logger.info("filtro Jev desativado");
      if (wanted && !key) logger.warn("jev.enabled=true mas TYPESAFE_API_KEY ausente; filtro desligado");
      this.client = null;
    }
  }

  get enabled(): boolean { return this.client !== null; }

  /** Busca a descrição no `uri` de metadados (JSON), com timeout curto. Nunca lança. */
  async fetchDescription(mint: string, uri: string): Promise<string | undefined> {
    if (!uri) return undefined;
    if (this.descCache.has(mint)) return this.descCache.get(mint);
    const url = uri.startsWith("ipfs://") ? `https://ipfs.io/ipfs/${uri.slice(7)}` : uri;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), this.cfg.jev.metadataTimeoutMs);
      const res = await fetch(url, { signal: ctl.signal });
      clearTimeout(t);
      if (!res.ok) return undefined;
      const j = (await res.json()) as { description?: unknown };
      const d = typeof j.description === "string" ? j.description.slice(0, 1000) : "";
      this.descCache.set(mint, d);
      if (this.descCache.size > 2000) this.descCache.delete(this.descCache.keys().next().value!);
      return d;
    } catch { return undefined; }
  }

  async evaluate(meta: TokenMeta, f: FeatureSnapshot): Promise<JevOutcome> {
    if (!this.client) return null;
    const started = Date.now();
    const state = {
      nome: meta.name, simbolo: meta.symbol, descricao: meta.description ?? "(indisponível)",
      idade_segundos: Math.round(f.ageSec), curva_pct: +f.curvePct.toFixed(1),
      compradores_unicos_60s: f.w60.uniqueBuyers, razao_compra_venda_60s: +f.w60.buySellRatio.toFixed(2),
      concentracao: { top1_pct: +f.top1Pct.toFixed(1), top5_pct: +f.top5Pct.toFixed(1), top10_pct: +f.top10Pct.toFixed(1), detentores: f.holders },
      criador: { comprou_sol: +f.creatorBoughtSol.toFixed(3), detem_pct: +f.creatorHoldsPct.toFixed(1), ja_vendeu: f.creatorSold },
      sinal_bundle: f.bundleSignal,
    };
    try {
      const res = await this.client.systemOne({
        state,
        questions: {
          is_likely_scam: noul("Esta memecoin recém-criada na Pump.fun tem sinais de golpe (rug pull, bundle, criador despejando)?"),
          meme_traction: score("De 0 a 10, quão forte é a tração orgânica deste meme?", [
            "nenhuma tração", null, "muito fraca", null, "fraca", "mediana", null, "boa", null, "muito boa", "excepcional",
          ]),
          category: choice("Classifique a moeda", { meme_forte: "meme com tração orgânica forte", meme_fraco: "meme fraco ou genérico", golpe_provavel: "provável golpe", incerto: "não dá para dizer" }),
        },
      }, { timeout: this.cfg.jev.timeoutMs });
      const latencyMs = Date.now() - started;
      const scam = res.answers.is_likely_scam.noul;
      return {
        model: res.model, latencyMs, isLikelyScam: scam, memeTraction: res.answers.meme_traction.score,
        category: res.answers.category.choice, categoryConfidence: res.answers.category.confidence,
        veto: scam >= this.cfg.jev.scamConfidence,
      };
    } catch (err) {
      const latencyMs = Date.now() - started;
      const msg = (err as Error).message ?? String(err);
      const timedOut = /timeout|timed out|abort/i.test(msg) || latencyMs >= this.cfg.jev.timeoutMs;
      logger.warn({ mint: f.mint, latencyMs, err: msg }, timedOut ? "Jev estourou o timeout; seguindo sem ele" : "Jev falhou; seguindo sem ele");
      return { timedOut, error: msg, latencyMs };
    }
  }
}
