import type { Logger } from "./types.js";

function write(level: string, message: string, meta?: Record<string, unknown>): void {
  const fields = meta ? ` ${JSON.stringify(meta)}` : "";
  process.stdout.write(`${new Date().toISOString()} ${level} ${message}${fields}\n`);
}

export const consoleLogger: Logger = {
  debug: (message, meta) => write("DEBUG", message, meta),
  info: (message, meta) => write("INFO", message, meta),
  warn: (message, meta) => write("WARN", message, meta),
  error: (message, meta) => write("ERROR", message, meta)
};
