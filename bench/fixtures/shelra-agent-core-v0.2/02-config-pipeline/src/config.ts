export interface AppConfig {
  host: string;
  port: number;
  debug: boolean;
  retries: number;
}

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  return {
    host: env.HOST ?? "127.0.0.1",
    port: Number(env.PORT ?? "3000"),
    debug: env.DEBUG === "true",
    retries: Number(env.RETRIES ?? "3"),
  };
}
