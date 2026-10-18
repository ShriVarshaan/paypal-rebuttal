import { pino } from "pino";

/** The subset of pino's API we use; Fastify's `app.log` satisfies it too. */
export interface Logger {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export function defaultLogger(): Logger {
  return pino({ name: "paypal", level: process.env["LOG_LEVEL"] ?? "info" });
}

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};
