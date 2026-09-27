/**
 * Schemas das mensagens do PumpPortal (wss://pumpportal.fun/api/data).
 *
 * ATENÇÃO: estes schemas foram escritos a partir da documentação pública do PumpPortal
 * porque a rede deste ambiente de desenvolvimento bloqueou o host. Rode `npm run sample`
 * para gravar mensagens reais em `samples/` e `npm run inspect-samples` para comparar
 * os campos reais com estes schemas. Campos incertos estão como opcionais e todos os
 * objetos usam `.passthrough()` para não perder nada que chegue a mais.
 */
import { z } from "zod";

const num = z.coerce.number();

/** Evento de criação (subscribeNewToken). txType = "create". */
export const NewTokenSchema = z.object({
  signature: z.string().optional(),
  mint: z.string(),
  traderPublicKey: z.string(),          // carteira do criador
  txType: z.literal("create"),
  initialBuy: num.optional(),            // tokens comprados pelo criador na criação
  solAmount: num.optional(),             // SOL gasto pelo criador na criação
  bondingCurveKey: z.string().optional(),
  vTokensInBondingCurve: num,
  vSolInBondingCurve: num,
  marketCapSol: num.optional(),
  name: z.string().optional().default(""),
  symbol: z.string().optional().default(""),
  uri: z.string().optional().default(""),
  pool: z.string().optional(),
}).passthrough();
export type NewTokenMsg = z.infer<typeof NewTokenSchema>;

/** Evento de trade (subscribeTokenTrade). txType = "buy" | "sell".
 *  vSol/vTokens refletem o estado da curva DEPOIS do trade. */
export const TradeSchema = z.object({
  signature: z.string().optional(),
  mint: z.string(),
  traderPublicKey: z.string(),
  txType: z.enum(["buy", "sell"]),
  tokenAmount: num,
  solAmount: num,
  newTokenBalance: num.optional(),       // saldo do trader depois do trade
  bondingCurveKey: z.string().optional(),
  vTokensInBondingCurve: num,
  vSolInBondingCurve: num,
  marketCapSol: num.optional(),
  pool: z.string().optional(),
}).passthrough();
export type TradeMsg = z.infer<typeof TradeSchema>;

/** Evento de migração/graduação (subscribeMigration). */
export const MigrationSchema = z.object({
  signature: z.string().optional(),
  mint: z.string(),
  txType: z.string().regex(/migrat/i).optional(),
  pool: z.string().optional(),
}).passthrough();
export type MigrationMsg = z.infer<typeof MigrationSchema>;

/** Mensagens de serviço, ex.: {"message":"Successfully subscribed to token creation events."} */
export const ServiceSchema = z.object({ message: z.string() }).passthrough();

export type FeedMessage =
  | { kind: "newToken"; data: NewTokenMsg }
  | { kind: "trade"; data: TradeMsg }
  | { kind: "migration"; data: MigrationMsg }
  | { kind: "service"; data: z.infer<typeof ServiceSchema> }
  | { kind: "unknown"; data: unknown };

/** Classifica e valida uma mensagem bruta do WebSocket. */
export function classify(raw: unknown): FeedMessage {
  if (typeof raw !== "object" || raw === null) return { kind: "unknown", data: raw };
  const r = raw as Record<string, unknown>;
  const tx = typeof r.txType === "string" ? r.txType : "";
  if (tx === "create") {
    const p = NewTokenSchema.safeParse(raw);
    return p.success ? { kind: "newToken", data: p.data } : { kind: "unknown", data: raw };
  }
  if (tx === "buy" || tx === "sell") {
    const p = TradeSchema.safeParse(raw);
    return p.success ? { kind: "trade", data: p.data } : { kind: "unknown", data: raw };
  }
  if (/migrat/i.test(tx) || (typeof r.pool === "string" && /amm|raydium/i.test(r.pool) && typeof r.mint === "string" && !("tokenAmount" in r))) {
    const p = MigrationSchema.safeParse(raw);
    return p.success ? { kind: "migration", data: p.data } : { kind: "unknown", data: raw };
  }
  if (typeof r.message === "string") return { kind: "service", data: { message: r.message, ...r } };
  return { kind: "unknown", data: raw };
}
