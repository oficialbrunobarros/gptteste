/** Mostra a união dos campos reais observados em cada arquivo de samples/ e compara com os schemas. */
import fs from "node:fs";
import path from "node:path";
import { classify } from "../src/feed/schemas";

const dir = path.resolve("samples");
for (const f of ["new_tokens.jsonl", "trades.jsonl", "migrations.jsonl", "other.jsonl"]) {
  const p = path.join(dir, f);
  if (!fs.existsSync(p)) { console.log(`\n== ${f}: ausente (rode npm run sample)`); continue; }
  const lines = fs.readFileSync(p, "utf8").split("\n").filter(Boolean);
  const fields = new Map<string, Set<string>>();
  const kinds = new Map<string, number>();
  let example: unknown = null;
  for (const l of lines) {
    const { msg } = JSON.parse(l);
    example ??= msg;
    for (const [k, v] of Object.entries(msg ?? {})) {
      if (!fields.has(k)) fields.set(k, new Set());
      fields.get(k)!.add(typeof v);
    }
    const kind = classify(msg).kind;
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  }
  console.log(`\n== ${f}: ${lines.length} mensagens`);
  console.log("classificação pelos schemas:", Object.fromEntries(kinds));
  for (const [k, t] of fields) console.log(`  ${k}: ${[...t].join("|")}`);
  console.log("exemplo:", JSON.stringify(example));
}
