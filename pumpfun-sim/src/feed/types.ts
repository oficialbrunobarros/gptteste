import type { EventEmitter } from "node:events";
import type { MigrationMsg, NewTokenMsg, TradeMsg } from "./schemas";

/** Eventos emitidos por qualquer implementação de Feed. */
export interface FeedEvents {
  newToken: (msg: NewTokenMsg, receivedAt: number) => void;
  trade: (msg: TradeMsg, receivedAt: number) => void;
  migration: (msg: MigrationMsg, receivedAt: number) => void;
  status: (s: FeedStatus) => void;
  raw: (msg: unknown, receivedAt: number) => void;
}

export interface FeedStatus {
  connected: boolean;
  reconnects: number;
  lastMessageAt: number | null;
  subscribedMints: number;
  mode: "pumpportal" | "synthetic" | "replay";
  detail?: string;
}

/**
 * Fonte de dados de mercado. Uma única conexão, assinaturas por mint.
 * Implementações: PumpPortalFeed (real), SyntheticFeed (offline), ReplayFeed (backtest).
 */
export interface Feed extends EventEmitter {
  start(): Promise<void>;
  stop(): Promise<void>;
  subscribeToken(mint: string): void;
  unsubscribeToken(mint: string): void;
  status(): FeedStatus;
  on<K extends keyof FeedEvents>(event: K, listener: FeedEvents[K]): this;
  emit<K extends keyof FeedEvents>(event: K, ...args: Parameters<FeedEvents[K]>): boolean;
}
