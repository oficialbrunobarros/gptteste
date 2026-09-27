import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { PumpPortalFeed } from "../src/feed/pumpportal";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("PumpPortalFeed (servidor falso)", () => {
  let wss: WebSocketServer | null = null;
  let feed: PumpPortalFeed | null = null;
  afterEach(async () => { await feed?.stop(); wss?.close(); });

  it("assina newToken/migration na conexão, trades por mint, e reassina tudo após reconectar", async () => {
    const received: string[][] = [];
    const sockets: WebSocket[] = [];
    wss = new WebSocketServer({ port: 0 });
    wss.on("connection", (ws) => {
      const msgs: string[] = []; received.push(msgs); sockets.push(ws);
      ws.on("message", (d) => { const m = JSON.parse(d.toString()); msgs.push(m.method + (m.keys ? ":" + m.keys.join(",") : "")); });
      ws.send(JSON.stringify({ message: "Successfully subscribed to token creation events." }));
      ws.send(JSON.stringify({ signature: "s", mint: "MINT1", traderPublicKey: "DEV", txType: "create", initialBuy: 1, solAmount: 0.1, vTokensInBondingCurve: 1e9, vSolInBondingCurve: 30.1, name: "n", symbol: "s", uri: "u" }));
      ws.send(JSON.stringify({ signature: "s", mint: "MINT1", traderPublicKey: "X", txType: "buy", tokenAmount: 10, solAmount: 0.1, vTokensInBondingCurve: 1e9, vSolInBondingCurve: 30.2 }));
    });
    const port = (wss.address() as { port: number }).port;
    feed = new PumpPortalFeed({ url: `ws://127.0.0.1:${port}`, heartbeatSec: 60, maxBackoffMs: 500 });
    const events: string[] = [];
    feed.on("newToken", (m) => { events.push("new:" + m.mint); feed!.subscribeToken(m.mint); });
    feed.on("trade", (m) => events.push("trade:" + m.mint));
    await feed.start();
    await sleep(400);
    expect(received[0]).toContain("subscribeNewToken");
    expect(received[0]).toContain("subscribeMigration");
    expect(received[0]).toContain("subscribeTokenTrade:MINT1");
    expect(events).toEqual(["new:MINT1", "trade:MINT1"]);
    expect(feed.status().connected).toBe(true);
    // derruba a conexão pelo servidor
    sockets[0]!.close();
    await sleep(1600);
    expect(feed.status().reconnects).toBe(1);
    expect(feed.status().connected).toBe(true);
    expect(received[1]).toContain("subscribeNewToken");
    expect(received[1]).toContain("subscribeTokenTrade:MINT1");
    feed.unsubscribeToken("MINT1");
    await sleep(100);
    expect(received[1]).toContain("unsubscribeTokenTrade:MINT1");
    expect(feed.status().subscribedMints).toBe(0);
  });

  it("heartbeat reconecta quando a conexão fica muda", async () => {
    let conns = 0;
    wss = new WebSocketServer({ port: 0 });
    wss.on("connection", () => { conns++; });
    const port = (wss.address() as { port: number }).port;
    feed = new PumpPortalFeed({ url: `ws://127.0.0.1:${port}`, heartbeatSec: 1, maxBackoffMs: 300 });
    await feed.start();
    await sleep(2800);
    expect(conns).toBeGreaterThanOrEqual(2);
    expect(feed.status().reconnects).toBeGreaterThanOrEqual(1);
  });
});
