import { EventEmitter } from "node:events";
import type { Feed, FeedStatus } from "./types";

/** Feed nulo para replay: o backtest injeta eventos direto no motor. */
export class ReplayFeed extends EventEmitter implements Feed {
  private subs = new Set<string>();
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  subscribeToken(mint: string): void { this.subs.add(mint); }
  unsubscribeToken(mint: string): void { this.subs.delete(mint); }
  status(): FeedStatus { return { connected: false, reconnects: 0, lastMessageAt: null, subscribedMints: this.subs.size, mode: "replay" }; }
}
