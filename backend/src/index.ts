import { createApp } from "./app";
import { loadConfig } from "./config";
import { openDatabase } from "./db";
import { describeError, jsonLogger as log } from "./log";

/*
 * Entry point: validate the configuration, check the database answers and has the schema, serve, and
 * close cleanly on SIGTERM (what a host sends before replacing the process).
 */
let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const sql = openDatabase(config.databaseUrl);
try {
  const [row] = await sql`select to_regclass('shelra.access_tokens') is not null as ready`;
  if (!row?.ready) {
    log({ level: "error", msg: "the database has no shelra schema; apply backend/supabase/migrations first" });
    process.exit(1);
  }
} catch (error) {
  log({ level: "error", msg: "could not check the database", error: describeError(error) });
  process.exit(1);
}

const server = Bun.serve({
  port: config.port,
  // Bun's development mode answers an uncaught error with a page showing source code; never serve it.
  development: false,
  // Every request body this API accepts is a few hundred bytes.
  maxRequestBodySize: 64 * 1024,
  ...createApp({ config, sql, log }),
});
log({ level: "info", msg: "listening", url: server.url.href });

async function shutdown(signal: string): Promise<void> {
  log({ level: "info", msg: "shutting down", signal });
  await server.stop();
  await sql.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
