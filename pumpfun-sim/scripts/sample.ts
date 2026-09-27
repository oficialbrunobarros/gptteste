/**
 * PASSO 1 OBRIGATÓRIO: grava ~N mensagens reais de cada tipo do PumpPortal em samples/.
 * Uso: npm run sample [-- --n 50 --timeout 600]
 * Abre UMA conexão, assina newToken + migration, e assina trades das primeiras moedas novas que aparecerem.
 */
import fs from "node:fs";
import path from "node:path";
import WebSocket from "ws";

const args = process.argv.slice(2);
const argv = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] ?? d : d; };
const N = Number(argv("n", "50"));
const TIMEOUT_S = Number(argv("timeout", "900"));
const URL = process.env.PUMPPORTAL_URL ?? "wss://pumpportal.fun/api/data";
const dir = path.resolve("samples");
fs.mkdirSync(dir, { recursive: true });

const files = {
  newToken: fs.createWriteStream(path.join(dir, "new_tokens.jsonl")),
  trade: fs.createWriteStream(path.join(dir, "trades.jsonl")),
  migration: fs.createWriteStream(path.join(dir, "migrations.jsonl")),
  other: fs.createWriteStream(path.join(dir, "other.jsonl")),
};
const counts = { newToken: 0, trade: 0, migration: 0, other: 0 };
const watched = new Set<string>();
const MAX_WATCH = 30;

const ws = new WebSocket(URL);
const started = Date.now();
console.log(`conectando a ${URL} ... alvo: ${N} de cada tipo (timeout ${TIMEOUT_S}s)`);

ws.on("open", () => {
  ws.send(JSON.stringify({ method: "subscribeNewToken" }));
  ws.send(JSON.stringify({ method: "subscribeMigration" }));
});

ws.on("message", (data) => {
  const now = Date.now();
  let m: any;
  try { m = JSON.parse(data.toString()); } catch { return; }
  const line = JSON.stringify({ receivedAt: now, msg: m }) + "\n";
  const tx = typeof m?.txType === "string" ? m.txType : "";
  if (tx === "create") {
    counts.newToken++; files.newToken.write(line);
    if (watched.size < MAX_WATCH && counts.trade < N * 4) {
      watched.add(m.mint);
      ws.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [m.mint] }));
    }
  } else if (tx === "buy" || tx === "sell") {
    // gravamos mais trades (4N) porque a validação da curva precisa de sequências por moeda
    if (counts.trade < N * 4) { counts.trade++; files.trade.write(line); }
  } else if (/migrat/i.test(tx) || /amm|raydium/i.test(String(m?.pool ?? ""))) {
    counts.migration++; files.migration.write(line);
  } else {
    counts.other++; files.other.write(line);
    console.log("outra mensagem:", JSON.stringify(m).slice(0, 200));
  }
  if (now - lastLog > 5000) { lastLog = now; console.log("contagens:", counts); }
  // migrações são raras (~1 a cada vários minutos); não bloqueia o término
  if (counts.newToken >= N && counts.trade >= N * 4 && (counts.migration >= Math.min(N, 5) || now - started > TIMEOUT_S * 1000 * 0.5)) finish("alvo atingido");
});
let lastLog = 0;
ws.on("error", (e) => { console.error("erro:", e.message); });
ws.on("close", (c) => { console.log("conexão fechada", c); finish("fechado"); });
setTimeout(() => finish("timeout"), TIMEOUT_S * 1000).unref();

let done = false;
function finish(why: string) {
  if (done) return; done = true;
  console.log(`terminando (${why}) contagens:`, counts);
  try { if (watched.size) ws.send(JSON.stringify({ method: "unsubscribeTokenTrade", keys: [...watched] })); ws.close(); } catch {}
  for (const f of Object.values(files)) f.end();
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify({ url: URL, startedAt: started, finishedAt: Date.now(), counts, watched: [...watched] }, null, 2));
  setTimeout(() => process.exit(0), 500);
}
