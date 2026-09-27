import { logger } from "../logger";

/** Preço do SOL em USD: tenta APIs públicas em ordem, cache de N minutos, e valor de reserva configurável. */
export class SolPrice {
  private cached: { usd: number; at: number; source: string } | null = null;
  private inflight: Promise<number> | null = null;

  constructor(private fallbackUsd: number, private cacheMs: number) {}

  configure(fallbackUsd: number, cacheMs: number): void { this.fallbackUsd = fallbackUsd; this.cacheMs = cacheMs; }

  /** Valor imediato (cache ou reserva) — nunca bloqueia. */
  current(): number { return this.cached?.usd ?? this.fallbackUsd; }
  source(): string { return this.cached?.source ?? "fallback"; }

  async get(): Promise<number> {
    const now = Date.now();
    if (this.cached && now - this.cached.at < this.cacheMs) return this.cached.usd;
    if (this.inflight) return this.inflight;
    this.inflight = this.fetch().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async fetch(): Promise<number> {
    const sources: Array<[string, string, (j: any) => number]> = [
      ["coingecko", "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", (j) => Number(j?.solana?.usd)],
      ["coinbase", "https://api.coinbase.com/v2/prices/SOL-USD/spot", (j) => Number(j?.data?.amount)],
      ["binance", "https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT", (j) => Number(j?.price)],
      ["kraken", "https://api.kraken.com/0/public/Ticker?pair=SOLUSD", (j) => Number(Object.values(j?.result ?? {})[0] ? (Object.values(j.result)[0] as any).c?.[0] : NaN)],
    ];
    for (const [name, url, pick] of sources) {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 4000);
        const res = await fetch(url, { signal: ctl.signal, headers: { accept: "application/json" } });
        clearTimeout(t);
        if (!res.ok) continue;
        const usd = pick(await res.json());
        if (Number.isFinite(usd) && usd > 0) {
          this.cached = { usd, at: Date.now(), source: name };
          logger.info({ usd, source: name }, "preço do SOL atualizado");
          return usd;
        }
      } catch (err) {
        logger.debug({ source: name, err: (err as Error).message }, "fonte de preço falhou");
      }
    }
    if (!this.cached) logger.warn({ fallbackUsd: this.fallbackUsd }, "nenhuma fonte de preço do SOL respondeu; usando valor de reserva");
    // mantém o último valor conhecido (ou reserva) e tenta de novo depois do cache expirar
    this.cached = { usd: this.cached?.usd ?? this.fallbackUsd, at: Date.now(), source: this.cached?.source ?? "fallback" };
    return this.cached.usd;
  }
}
