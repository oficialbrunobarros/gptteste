import "dotenv/config";
import { loadConfig } from "../config";
import { SimDb } from "../db/db";
import { writeReport } from "./daily";
import { localDateStr } from "../risk/time";

const cfg = loadConfig();
const db = new SimDb(cfg.db.path);
const i = process.argv.indexOf("--date");
const date = i >= 0 ? process.argv[i + 1]! : localDateStr(Date.now(), cfg.risk.timezone);
const file = writeReport(db, cfg, date);
db.close();
console.log(`relatório gerado: ${file}`);
