import pino from "pino";

const pretty = process.stdout.isTTY && process.env.LOG_JSON !== "1";
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  ...(pretty ? { transport: { target: "pino-pretty", options: { translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" } } } : {}),
});
