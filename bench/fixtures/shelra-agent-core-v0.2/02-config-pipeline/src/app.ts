import { loadConfig } from "./config";

export function serverAddress(env: Record<string, string | undefined>): string {
  const config = loadConfig(env);
  return `http://${config.host}:${config.port}`;
}
