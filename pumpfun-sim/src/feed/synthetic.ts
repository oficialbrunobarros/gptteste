/**
 * Gerador sintético de mercado, no MESMO formato de mensagens do PumpPortal.
 * Serve para testar o pipeline inteiro offline (ambientes sem rede) e para testes automatizados.
 * NÃO substitui a validação com dados reais: os arquétipos aqui são caricaturas.
 */
import { EventEmitter } from "node:events";
import { buy, sell, initialState, realSol, type CurveState, type CurveParams, DEFAULT_CURVE_PARAMS } from "../curve";
import type { Feed, FeedStatus } from "./types";
import type { NewTokenMsg, TradeMsg } from "./schemas";

type Archetype = "organic" | "rug" | "dud" | "bundle" | "runner";

interface SimToken {
  mint: string;
  creator: string;
  createdAt: number;
  archetype: Archetype;
  state: CurveState;
  balances: Map<string, number>;
  wallets: string[];
  nextTradeAt: number;
  phase: number;      // 0 = acumulação, 1 = distribuição
  dead: boolean;
  migrated: boolean;
  creatorSold: boolean;
  seq: number;
}

export interface SyntheticOptions {
  /** Intervalo médio entre moedas novas (ms). */
  newTokenEveryMs?: number;
  seed?: number;
  curve?: CurveParams;
  /** Aceleração do tempo simulado (1 = tempo real). */
  speed?: number;
}

/** PRNG determinístico (mulberry32) para testes reproduzíveis. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class SyntheticFeed extends EventEmitter implements Feed {
  private tokens = new Map<string, SimToken>();
  private subscribed = new Set<string>();
  private timer?: NodeJS.Timeout;
  private rand: () => number;
  private counter = 0;
  private curve: CurveParams;
  private every: number;
  private speed: number;
  private nextTokenAt = 0;
  private running = false;
  private lastMessageAt: number | null = null;
  private simNow = Date.now();

  constructor(opts: SyntheticOptions = {}) {
    super();
    this.rand = rng(opts.seed ?? 42);
    this.curve = opts.curve ?? DEFAULT_CURVE_PARAMS;
    this.every = opts.newTokenEveryMs ?? 4000;
    this.speed = opts.speed ?? 1;
  }

  async start(): Promise<void> {
    this.running = true;
    this.simNow = Date.now();
    this.nextTokenAt = this.simNow + 500;
    this.timer = setInterval(() => this.step(), 100);
    this.emit("status", this.status());
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.emit("status", this.status());
  }

  subscribeToken(mint: string): void { this.subscribed.add(mint); }
  unsubscribeToken(mint: string): void { this.subscribed.delete(mint); }

  status(): FeedStatus {
    return { connected: this.running, reconnects: 0, lastMessageAt: this.lastMessageAt, subscribedMints: this.subscribed.size, mode: "synthetic" };
  }

  /** Avança a simulação até `now` (permite uso em testes com tempo virtual). */
  step(now = Date.now()): void {
    if (!this.running) return;
    // tempo simulado (acelerado por `speed`)
    if (this.lastStep === undefined) this.lastStep = now;
    this.simNow += (now - this.lastStep) * this.speed;
    this.lastStep = now;
    const t = this.simNow;
    if (t >= this.nextTokenAt) {
      this.createToken(t);
      this.nextTokenAt = t + this.every * (0.4 + 1.2 * this.rand());
    }
    for (const tok of this.tokens.values()) {
      if (tok.dead || tok.migrated) continue;
      let guard = 0;
      while (tok.nextTradeAt <= t && guard++ < 50) this.tradeOnce(tok, tok.nextTradeAt);
      if (t - tok.createdAt > 20 * 60_000) tok.dead = true;
    }
    // limpeza
    if (this.tokens.size > 400) {
      const oldest = [...this.tokens.values()].sort((a, b) => a.createdAt - b.createdAt).slice(0, 100);
      for (const o of oldest) this.tokens.delete(o.mint);
    }
  }
  private lastStep?: number;

  private wallet(): string {
    return "W" + (++this.counter).toString(36).padStart(6, "0") + Math.floor(this.rand() * 1e9).toString(36);
  }

  private pick<T>(arr: T[]): T { return arr[Math.floor(this.rand() * arr.length)]!; }

  private createToken(t: number): void {
    const r = this.rand();
    const archetype: Archetype = r < 0.35 ? "dud" : r < 0.6 ? "organic" : r < 0.8 ? "rug" : r < 0.92 ? "bundle" : "runner";
    const mint = "SIM" + (++this.counter).toString(36).padStart(5, "0") + Math.floor(this.rand() * 1e12).toString(36) + "pump";
    const creator = this.wallet();
    const tok: SimToken = {
      mint, creator, createdAt: t, archetype, state: initialState(this.curve), balances: new Map(),
      wallets: Array.from({ length: 40 }, () => this.wallet()), nextTradeAt: t + 200, phase: 0,
      dead: false, migrated: false, creatorSold: false, seq: 0,
    };
    // compra do criador na criação
    const creatorSol = archetype === "rug" ? 1.5 + 2 * this.rand() : archetype === "dud" ? 0.05 * this.rand() : 0.2 + 0.8 * this.rand();
    let initialBuy = 0; let solAmount = 0;
    if (creatorSol > 0.01) {
      const b = buy(tok.state, creatorSol, this.curve.feePct);
      tok.state = b.after; initialBuy = b.tokensOut; solAmount = b.solNet;
      tok.balances.set(creator, b.tokensOut);
    }
    this.tokens.set(mint, tok);
    const msg: NewTokenMsg = {
      signature: "sig" + t + mint.slice(3, 9), mint, traderPublicKey: creator, txType: "create", initialBuy, solAmount,
      bondingCurveKey: "BC" + mint.slice(3, 20), vTokensInBondingCurve: tok.state.vTokens, vSolInBondingCurve: tok.state.vSol,
      marketCapSol: (tok.state.vSol / tok.state.vTokens) * this.curve.totalSupply,
      name: `Sim ${archetype} ${this.counter}`, symbol: archetype.slice(0, 4).toUpperCase(), uri: `https://example.invalid/meta/${mint}.json`, pool: "pump",
    };
    this.lastMessageAt = Date.now();
    this.emit("raw", msg, Date.now());
    this.emit("newToken", msg, Date.now());
    // bundle: rajada de compras parecidas no mesmo segundo
    if (archetype === "bundle") {
      const n = 6 + Math.floor(this.rand() * 6);
      const size = 0.3 + 0.3 * this.rand();
      for (let i = 0; i < n; i++) this.emitTrade(tok, this.wallet(), "buy", size * (0.95 + 0.1 * this.rand()), t + 50 * i);
    }
  }

  private tradeOnce(tok: SimToken, t: number): void {
    const age = (t - tok.createdAt) / 1000;
    const rs = realSol(tok.state, this.curve);
    let interval = 1500;
    let pBuy = 0.5;
    let size = 0.05 + 0.3 * this.rand();
    switch (tok.archetype) {
      case "dud":
        interval = 4000 + 8000 * this.rand(); pBuy = age < 30 ? 0.7 : 0.35; size *= 0.4;
        if (age > 120 && this.rand() < 0.3) tok.dead = true;
        break;
      case "organic":
        // acumulação forte nos primeiros ~90s, depois distribuição lenta
        interval = age < 90 ? 300 + 700 * this.rand() : 1500 + 3000 * this.rand();
        pBuy = age < 90 ? 0.75 : 0.42;
        break;
      case "runner":
        interval = age < 240 ? 250 + 500 * this.rand() : 1000 + 2000 * this.rand();
        pBuy = age < 240 ? 0.72 : 0.5; size *= 1.5;
        break;
      case "rug":
        interval = 400 + 900 * this.rand(); pBuy = 0.7;
        if (!tok.creatorSold && age > 45 + 60 * this.rand()) {
          const bal = tok.balances.get(tok.creator) ?? 0;
          if (bal > 0) { this.emitTrade(tok, tok.creator, "sell", bal, t, true); tok.creatorSold = true; tok.phase = 1; }
        }
        if (tok.phase === 1) { pBuy = 0.2; interval = 800 + 2000 * this.rand(); if (age > 200) tok.dead = true; }
        break;
      case "bundle":
        interval = 500 + 1500 * this.rand(); pBuy = age < 40 ? 0.65 : 0.25;
        if (age > 40 && this.rand() < 0.3) {
          // as carteiras do bundle despejam
          const dumpers = [...tok.balances.entries()].filter(([w, b]) => b > 0 && w !== tok.creator).slice(0, 3);
          for (const [w, b] of dumpers) this.emitTrade(tok, w, "sell", b, t, true);
        }
        if (age > 150) tok.dead = true;
        break;
    }
    tok.nextTradeAt = t + interval;
    const isBuy = this.rand() < pBuy;
    if (isBuy) {
      const w = this.rand() < 0.7 ? this.wallet() : this.pick(tok.wallets);
      this.emitTrade(tok, w, "buy", size, t);
    } else {
      const holders = [...tok.balances.entries()].filter(([w, b]) => b > 0 && w !== tok.creator);
      if (holders.length === 0) return;
      const [w, b] = this.pick(holders);
      const frac = this.rand() < 0.5 ? 1 : 0.3 + 0.6 * this.rand();
      this.emitTrade(tok, w, "sell", b * frac, t, true);
    }
    if (rs >= this.curve.graduationSol) {
      tok.migrated = true;
      const m = { signature: "mig" + t, mint: tok.mint, txType: "migrate", pool: "pump-amm" };
      this.emit("raw", m, Date.now());
      this.emit("migration", m, Date.now());
    }
  }

  /** amount = SOL para compra; tokens para venda. */
  private emitTrade(tok: SimToken, trader: string, side: "buy" | "sell", amount: number, t: number, tokensGiven = false): void {
    if (tok.migrated || amount <= 0) return;
    let tokenAmount: number; let solAmount: number;
    if (side === "buy") {
      const b = buy(tok.state, amount, this.curve.feePct);
      tok.state = b.after; tokenAmount = b.tokensOut; solAmount = b.solNet;
      tok.balances.set(trader, (tok.balances.get(trader) ?? 0) + tokenAmount);
    } else {
      const bal = tok.balances.get(trader) ?? 0;
      const tokens = tokensGiven ? Math.min(amount, bal) : Math.min(bal, amount);
      if (tokens <= 0) return;
      const s = sell(tok.state, tokens, this.curve.feePct);
      tok.state = s.after; tokenAmount = tokens; solAmount = s.solGross;
      tok.balances.set(trader, bal - tokens);
    }
    tok.seq++;
    if (!this.subscribed.has(tok.mint)) return; // o serviço só envia trades de mints assinados
    const msg: TradeMsg = {
      signature: "sig" + t + "_" + tok.seq, mint: tok.mint, traderPublicKey: trader, txType: side, tokenAmount, solAmount,
      newTokenBalance: tok.balances.get(trader) ?? 0, bondingCurveKey: "BC" + tok.mint.slice(3, 20),
      vTokensInBondingCurve: tok.state.vTokens, vSolInBondingCurve: tok.state.vSol,
      marketCapSol: (tok.state.vSol / tok.state.vTokens) * this.curve.totalSupply, pool: "pump",
    };
    this.lastMessageAt = Date.now();
    this.emit("raw", msg, Date.now());
    this.emit("trade", msg, Date.now());
  }
}
