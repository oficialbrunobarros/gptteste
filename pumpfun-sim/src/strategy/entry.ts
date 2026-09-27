import type { Config } from "../config";
import type { FeatureSnapshot } from "../features/tokenState";

export type EntryFilter =
  | "age_min" | "age_max" | "curve_min" | "curve_max" | "unique_buyers_60s" | "buy_sell_ratio_60s"
  | "top10_concentration" | "creator_sold" | "bundle_strong";

/**
 * Filtros de ENTRADA (todos precisam passar). Devolve a lista de filtros que falharam,
 * para que o painel mostre quais estão rejeitando mais moedas.
 */
export function entryFilters(f: FeatureSnapshot, cfg: Config["entry"]): EntryFilter[] {
  const failed: EntryFilter[] = [];
  if (f.ageSec < cfg.minAgeSec) failed.push("age_min");
  if (f.ageSec > cfg.maxAgeSec) failed.push("age_max");
  if (f.curvePct < cfg.minCurvePct) failed.push("curve_min");
  if (f.curvePct > cfg.maxCurvePct) failed.push("curve_max");
  if (f.w60.uniqueBuyers < cfg.minUniqueBuyers60s) failed.push("unique_buyers_60s");
  if (f.w60.buySellRatio < cfg.minBuySellRatio) failed.push("buy_sell_ratio_60s");
  if (f.top10Pct > cfg.maxTop10Pct) failed.push("top10_concentration");
  if (cfg.creatorSoldBlocks && f.creatorSold) failed.push("creator_sold");
  if (cfg.blockStrongBundle && f.bundleSignal === "strong") failed.push("bundle_strong");
  return failed;
}
