import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { FeatureSnapshot } from "../features/tokenState";
import type { ExitReason } from "../executor/Executor";
import type { JevOutcome } from "../jev/client";

export interface TokenRow {
  mint: string; name: string; symbol: string; uri: string; creator: string; created_at: number;
  v_sol0: number; v_tokens0: number; initial_buy: number; creator_sol: number; migrated_at: number | null; entry_features: string | null;
}

export interface PositionRow {
  id: number; mint: string; name: string; symbol: string; shadow: number; status: "open" | "closed";
  decided_at: number; opened_at: number; closed_at: number | null; exit_reason: ExitReason | null;
  size_sol: number; tokens: number; entry_price: number; exit_price: number | null;
  sol_spent: number; sol_received: number | null;
  cost_curve_fee: number; cost_exec_fee: number; cost_network_fee: number; cost_penalty: number;
  pnl_gross_sol: number | null; pnl_net_sol: number | null; pnl_net_usd: number | null; pnl_net_pct: number | null;
  sol_price_usd: number; duration_sec: number | null; peak_net_pct: number | null;
  features: string; jev: string | null;
}

export interface EventRow { id: number; ts: number; type: string; detail: string }
export interface EquityRow { ts: number; bankroll_sol: number; open_value_sol: number; equity_sol: number; equity_usd: number; sol_price_usd: number }
export interface TradeRow { mint: string; ts: number; side: "buy" | "sell"; sol: number; tokens: number; trader: string; v_sol: number; v_tokens: number; new_balance: number | null }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tokens (
  mint TEXT PRIMARY KEY, name TEXT, symbol TEXT, uri TEXT, creator TEXT, created_at INTEGER NOT NULL,
  v_sol0 REAL, v_tokens0 REAL, initial_buy REAL, creator_sol REAL, migrated_at INTEGER, entry_features TEXT
);
CREATE INDEX IF NOT EXISTS idx_tokens_created ON tokens(created_at);
CREATE TABLE IF NOT EXISTS trades_observed (
  id INTEGER PRIMARY KEY AUTOINCREMENT, mint TEXT NOT NULL, ts INTEGER NOT NULL, side TEXT NOT NULL,
  sol REAL NOT NULL, tokens REAL NOT NULL, trader TEXT NOT NULL, v_sol REAL NOT NULL, v_tokens REAL NOT NULL, new_balance REAL
);
CREATE INDEX IF NOT EXISTS idx_trades_mint_ts ON trades_observed(mint, ts);
CREATE INDEX IF NOT EXISTS idx_trades_ts ON trades_observed(ts);
CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, mint TEXT NOT NULL, name TEXT, symbol TEXT, shadow INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL, decided_at INTEGER NOT NULL, opened_at INTEGER NOT NULL, closed_at INTEGER, exit_reason TEXT,
  size_sol REAL NOT NULL, tokens REAL NOT NULL, entry_price REAL NOT NULL, exit_price REAL,
  sol_spent REAL NOT NULL, sol_received REAL,
  cost_curve_fee REAL NOT NULL DEFAULT 0, cost_exec_fee REAL NOT NULL DEFAULT 0, cost_network_fee REAL NOT NULL DEFAULT 0, cost_penalty REAL NOT NULL DEFAULT 0,
  pnl_gross_sol REAL, pnl_net_sol REAL, pnl_net_usd REAL, pnl_net_pct REAL, sol_price_usd REAL NOT NULL,
  duration_sec REAL, peak_net_pct REAL, features TEXT NOT NULL, jev TEXT
);
CREATE INDEX IF NOT EXISTS idx_positions_closed ON positions(closed_at);
CREATE TABLE IF NOT EXISTS shadow_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, mint TEXT NOT NULL, name TEXT, symbol TEXT, shadow INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL, decided_at INTEGER NOT NULL, opened_at INTEGER NOT NULL, closed_at INTEGER, exit_reason TEXT,
  size_sol REAL NOT NULL, tokens REAL NOT NULL, entry_price REAL NOT NULL, exit_price REAL,
  sol_spent REAL NOT NULL, sol_received REAL,
  cost_curve_fee REAL NOT NULL DEFAULT 0, cost_exec_fee REAL NOT NULL DEFAULT 0, cost_network_fee REAL NOT NULL DEFAULT 0, cost_penalty REAL NOT NULL DEFAULT 0,
  pnl_gross_sol REAL, pnl_net_sol REAL, pnl_net_usd REAL, pnl_net_pct REAL, sol_price_usd REAL NOT NULL,
  duration_sec REAL, peak_net_pct REAL, features TEXT NOT NULL, jev TEXT
);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, type TEXT NOT NULL, detail TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE TABLE IF NOT EXISTS equity (ts INTEGER PRIMARY KEY, bankroll_sol REAL, open_value_sol REAL, equity_sol REAL, equity_usd REAL, sol_price_usd REAL);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

export interface OpenPositionInput {
  mint: string; name: string; symbol: string; shadow: boolean; decidedAt: number; openedAt: number;
  sizeSol: number; tokens: number; entryPrice: number; solSpent: number;
  costCurveFee: number; costExecFee: number; costNetworkFee: number; solPriceUsd: number;
  features: FeatureSnapshot; jev: JevOutcome;
}
export interface ClosePositionInput {
  id: number; shadow: boolean; closedAt: number; exitReason: ExitReason; exitPrice: number; solReceived: number;
  costCurveFee: number; costExecFee: number; costNetworkFee: number; costPenalty: number;
  pnlGrossSol: number; pnlNetSol: number; pnlNetUsd: number; pnlNetPct: number; durationSec: number; peakNetPct: number;
}

export class SimDb {
  readonly db: Database.Database;
  private tradeBuffer: TradeRow[] = [];
  private stmts;

  constructor(file: string) {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    this.db = new Database(file);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.exec(SCHEMA);
    this.stmts = {
      insertToken: this.db.prepare(`INSERT OR IGNORE INTO tokens (mint,name,symbol,uri,creator,created_at,v_sol0,v_tokens0,initial_buy,creator_sol) VALUES (?,?,?,?,?,?,?,?,?,?)`),
      tokenMigrated: this.db.prepare(`UPDATE tokens SET migrated_at=? WHERE mint=?`),
      tokenEntryFeatures: this.db.prepare(`UPDATE tokens SET entry_features=? WHERE mint=? AND entry_features IS NULL`),
      insertTrade: this.db.prepare(`INSERT INTO trades_observed (mint,ts,side,sol,tokens,trader,v_sol,v_tokens,new_balance) VALUES (?,?,?,?,?,?,?,?,?)`),
      insertEvent: this.db.prepare(`INSERT INTO events (ts,type,detail) VALUES (?,?,?)`),
      insertEquity: this.db.prepare(`INSERT OR REPLACE INTO equity (ts,bankroll_sol,open_value_sol,equity_sol,equity_usd,sol_price_usd) VALUES (?,?,?,?,?,?)`),
      kvGet: this.db.prepare(`SELECT value FROM kv WHERE key=?`),
      kvSet: this.db.prepare(`INSERT OR REPLACE INTO kv (key,value) VALUES (?,?)`),
    };
  }

  // ---- tokens ----
  insertToken(t: { mint: string; name: string; symbol: string; uri: string; creator: string; createdAt: number; vSol: number; vTokens: number; initialBuy: number; creatorSol: number }): void {
    this.stmts.insertToken.run(t.mint, t.name, t.symbol, t.uri, t.creator, t.createdAt, t.vSol, t.vTokens, t.initialBuy, t.creatorSol);
  }
  markMigrated(mint: string, ts: number): void { this.stmts.tokenMigrated.run(ts, mint); }
  setEntryFeatures(mint: string, f: FeatureSnapshot): void { this.stmts.tokenEntryFeatures.run(JSON.stringify(f), mint); }
  tokens(sinceTs = 0): TokenRow[] { return this.db.prepare(`SELECT * FROM tokens WHERE created_at>=? ORDER BY created_at`).all(sinceTs) as TokenRow[]; }
  countTokens(): number { return (this.db.prepare(`SELECT COUNT(*) c FROM tokens`).get() as { c: number }).c; }

  // ---- trades observados (gravação em lote) ----
  bufferTrade(t: TradeRow): void { this.tradeBuffer.push(t); if (this.tradeBuffer.length >= 500) this.flushTrades(); }
  flushTrades(): void {
    if (this.tradeBuffer.length === 0) return;
    const rows = this.tradeBuffer; this.tradeBuffer = [];
    const tx = this.db.transaction((rs: TradeRow[]) => { for (const r of rs) this.stmts.insertTrade.run(r.mint, r.ts, r.side, r.sol, r.tokens, r.trader, r.v_sol, r.v_tokens, r.new_balance); });
    tx(rows);
  }
  tradesFor(mints: string[] | null, sinceTs = 0): TradeRow[] {
    if (mints === null) return this.db.prepare(`SELECT mint,ts,side,sol,tokens,trader,v_sol,v_tokens,new_balance FROM trades_observed WHERE ts>=? ORDER BY ts, id`).all(sinceTs) as TradeRow[];
    const q = this.db.prepare(`SELECT mint,ts,side,sol,tokens,trader,v_sol,v_tokens,new_balance FROM trades_observed WHERE mint=? AND ts>=? ORDER BY ts, id`);
    return mints.flatMap((m) => q.all(m, sinceTs) as TradeRow[]);
  }
  countTrades(): number { return (this.db.prepare(`SELECT COUNT(*) c FROM trades_observed`).get() as { c: number }).c; }
  /** Retenção: apaga trades observados mais velhos que N dias (e tokens sem posição mais velhos que isso). */
  pruneTrades(olderThanTs: number): number {
    const r = this.db.prepare(`DELETE FROM trades_observed WHERE ts<?`).run(olderThanTs);
    this.db.prepare(`DELETE FROM tokens WHERE created_at<? AND mint NOT IN (SELECT mint FROM positions) AND mint NOT IN (SELECT mint FROM shadow_positions)`).run(olderThanTs);
    return r.changes;
  }

  // ---- posições ----
  openPosition(p: OpenPositionInput): number {
    const table = p.shadow ? "shadow_positions" : "positions";
    const r = this.db.prepare(`INSERT INTO ${table} (mint,name,symbol,shadow,status,decided_at,opened_at,size_sol,tokens,entry_price,sol_spent,cost_curve_fee,cost_exec_fee,cost_network_fee,sol_price_usd,features,jev)
      VALUES (?,?,?,?, 'open', ?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      p.mint, p.name, p.symbol, p.shadow ? 1 : 0, p.decidedAt, p.openedAt, p.sizeSol, p.tokens, p.entryPrice, p.solSpent,
      p.costCurveFee, p.costExecFee, p.costNetworkFee, p.solPriceUsd, JSON.stringify(p.features), p.jev ? JSON.stringify(p.jev) : null);
    return Number(r.lastInsertRowid);
  }
  closePosition(c: ClosePositionInput): void {
    const table = c.shadow ? "shadow_positions" : "positions";
    this.db.prepare(`UPDATE ${table} SET status='closed', closed_at=?, exit_reason=?, exit_price=?, sol_received=?,
      cost_curve_fee=cost_curve_fee+?, cost_exec_fee=cost_exec_fee+?, cost_network_fee=cost_network_fee+?, cost_penalty=?,
      pnl_gross_sol=?, pnl_net_sol=?, pnl_net_usd=?, pnl_net_pct=?, duration_sec=?, peak_net_pct=? WHERE id=?`).run(
      c.closedAt, c.exitReason, c.exitPrice, c.solReceived, c.costCurveFee, c.costExecFee, c.costNetworkFee, c.costPenalty,
      c.pnlGrossSol, c.pnlNetSol, c.pnlNetUsd, c.pnlNetPct, c.durationSec, c.peakNetPct, c.id);
  }
  positions(opts: { shadow?: boolean; status?: "open" | "closed"; sinceTs?: number; limit?: number } = {}): PositionRow[] {
    const table = opts.shadow ? "shadow_positions" : "positions";
    const where: string[] = []; const args: unknown[] = [];
    if (opts.status) { where.push("status=?"); args.push(opts.status); }
    if (opts.sinceTs) { where.push("COALESCE(closed_at, opened_at)>=?"); args.push(opts.sinceTs); }
    const sql = `SELECT * FROM ${table} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC ${opts.limit ? "LIMIT " + opts.limit : ""}`;
    return this.db.prepare(sql).all(...args) as PositionRow[];
  }
  /** Marca posições que ficaram abertas de uma execução anterior (crash) como fechadas por shutdown sem PnL. */
  orphanOpenPositions(): PositionRow[] { return this.db.prepare(`SELECT * FROM positions WHERE status='open'`).all() as PositionRow[]; }

  // ---- eventos / equity / kv ----
  event(ts: number, type: string, detail: Record<string, unknown>): void { this.stmts.insertEvent.run(ts, type, JSON.stringify(detail)); }
  events(limit = 50): EventRow[] { return this.db.prepare(`SELECT * FROM events ORDER BY id DESC LIMIT ?`).all(limit) as EventRow[]; }
  equity(e: EquityRow): void { this.stmts.insertEquity.run(e.ts, e.bankroll_sol, e.open_value_sol, e.equity_sol, e.equity_usd, e.sol_price_usd); }
  equityCurve(sinceTs = 0, limit = 5000): EquityRow[] { return this.db.prepare(`SELECT * FROM equity WHERE ts>=? ORDER BY ts DESC LIMIT ?`).all(sinceTs, limit).reverse() as EquityRow[]; }
  kvGet(key: string): string | null { const r = this.stmts.kvGet.get(key) as { value: string } | undefined; return r?.value ?? null; }
  kvSet(key: string, value: string): void { this.stmts.kvSet.run(key, value); }

  close(): void { this.flushTrades(); this.db.close(); }
}
