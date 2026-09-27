import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { classify } from "./schemas";
import type { Feed, FeedStatus } from "./types";
import { logger } from "../logger";

export interface PumpPortalOptions {
  url: string;
  heartbeatSec: number;
  /** Cada conexão nova reassina tudo. Backoff: 1s, 2s, 4s ... até maxBackoffMs. */
  maxBackoffMs?: number;
}

/**
 * Cliente do WebSocket do PumpPortal.
 * Regras do serviço: UMA conexão só (múltiplas conexões são punidas), assinaturas
 * reutilizando a mesma conexão, e reassinatura completa após reconectar.
 */
export class PumpPortalFeed extends EventEmitter implements Feed {
  private ws: WebSocket | null = null;
  private subscribed = new Set<string>();
  private pendingSubs = new Set<string>();   // mints à espera de conexão aberta
  private reconnects = 0;
  private lastMessageAt: number | null = null;
  private stopped = false;
  private backoffMs = 1000;
  private heartbeat?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private flushTimer?: NodeJS.Timeout;
  private connected = false;

  constructor(private readonly opts: PumpPortalOptions) { super(); }

  async start(): Promise<void> {
    this.stopped = false;
    this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN && this.subscribed.size) {
          this.send({ method: "unsubscribeTokenTrade", keys: [...this.subscribed] });
        }
        this.ws.close();
      } catch { /* ignora */ }
      this.ws = null;
    }
    this.connected = false;
    this.emitStatus();
  }

  subscribeToken(mint: string): void {
    if (this.subscribed.has(mint)) return;
    this.subscribed.add(mint);
    this.pendingSubs.add(mint);
    this.scheduleFlush();
  }

  unsubscribeToken(mint: string): void {
    if (!this.subscribed.delete(mint)) return;
    this.pendingSubs.delete(mint);
    if (this.isOpen()) this.send({ method: "unsubscribeTokenTrade", keys: [mint] });
    this.emitStatus();
  }

  status(): FeedStatus {
    return { connected: this.connected, reconnects: this.reconnects, lastMessageAt: this.lastMessageAt, subscribedMints: this.subscribed.size, mode: "pumpportal" };
  }

  // ---- internos ----

  private isOpen(): boolean { return !!this.ws && this.ws.readyState === WebSocket.OPEN; }

  private send(obj: unknown): void {
    if (!this.isOpen()) return;
    this.ws!.send(JSON.stringify(obj));
  }

  /** Agrupa assinaturas de mints em lotes para não inundar o serviço. */
  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      if (!this.isOpen() || this.pendingSubs.size === 0) return;
      const keys = [...this.pendingSubs];
      this.pendingSubs.clear();
      this.send({ method: "subscribeTokenTrade", keys });
      this.emitStatus();
    }, 200);
  }

  private connect(): void {
    if (this.stopped) return;
    logger.info({ url: this.opts.url }, "conectando ao PumpPortal");
    const ws = new WebSocket(this.opts.url);
    this.ws = ws;

    ws.on("open", () => {
      this.connected = true;
      this.backoffMs = 1000;
      this.lastMessageAt = Date.now();
      logger.info("WebSocket conectado; assinando eventos");
      this.send({ method: "subscribeNewToken" });
      this.send({ method: "subscribeMigration" });
      // Reassina tudo o que estava ativo antes da queda
      if (this.subscribed.size) this.send({ method: "subscribeTokenTrade", keys: [...this.subscribed] });
      this.pendingSubs.clear();
      this.startHeartbeat();
      this.emitStatus();
    });

    ws.on("message", (data) => {
      const now = Date.now();
      this.lastMessageAt = now;
      let parsed: unknown;
      try { parsed = JSON.parse(data.toString()); } catch { return; }
      this.emit("raw", parsed, now);
      const m = classify(parsed);
      switch (m.kind) {
        case "newToken": this.emit("newToken", m.data, now); break;
        case "trade": this.emit("trade", m.data, now); break;
        case "migration": this.emit("migration", m.data, now); break;
        case "service": logger.debug({ msg: m.data.message }, "mensagem de serviço"); break;
        default: logger.debug({ raw: parsed }, "mensagem não reconhecida");
      }
    });

    const onDown = (why: string) => {
      if (this.ws !== ws) return;
      this.connected = false;
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.ws = null;
      this.emitStatus(why);
      if (this.stopped) return;
      this.reconnects++;
      const delay = this.backoffMs;
      this.backoffMs = Math.min(this.backoffMs * 2, this.opts.maxBackoffMs ?? 60_000);
      logger.warn({ why, delayMs: delay, reconnects: this.reconnects }, "WebSocket caiu; reconectando");
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };
    ws.on("close", (code) => onDown(`close ${code}`));
    ws.on("error", (err) => { logger.warn({ err: err.message }, "erro no WebSocket"); onDown(`error ${err.message}`); });
  }

  /** Heartbeat: se nada chegar em heartbeatSec, derruba a conexão para forçar reconexão. */
  private startHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    const ms = this.opts.heartbeatSec * 1000;
    this.heartbeat = setInterval(() => {
      if (!this.ws) return;
      if (this.lastMessageAt && Date.now() - this.lastMessageAt > ms) {
        logger.warn({ silentMs: Date.now() - this.lastMessageAt }, "heartbeat: sem mensagens; reconectando");
        try { this.ws.terminate(); } catch { /* ignora */ }
      }
    }, Math.max(1000, ms / 4));
    this.heartbeat.unref();
  }

  private emitStatus(detail?: string): void {
    this.emit("status", { ...this.status(), ...(detail ? { detail } : {}) });
  }
}
