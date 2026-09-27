/** Utilidades de fuso horário (padrão America/Sao_Paulo) sem dependências. */
export function localDateStr(ts: number, tz: string): string {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(new Date(ts)); // YYYY-MM-DD
}

function tzOffsetMs(ts: number, tz: string): number {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  return asUtc - Math.floor(ts / 1000) * 1000;
}

/** Próxima meia-noite local depois de `ts`. */
export function nextMidnight(ts: number, tz: string): number {
  const off = tzOffsetMs(ts, tz);
  const local = new Date(ts + off);
  const midnightLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1);
  return midnightLocal - tzOffsetMs(midnightLocal - off, tz);
}

/** Próximo instante em que o relógio local marcar HH:MM. */
export function nextLocalTime(ts: number, hhmm: string, tz: string): number {
  const [hh, mm] = hhmm.split(":").map(Number) as [number, number];
  const off = tzOffsetMs(ts, tz);
  const local = new Date(ts + off);
  let target = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hh, mm) - off;
  if (target <= ts) target += 86_400_000;
  return target;
}
