import { z } from "zod";

/*
 * Everything the server reads from its environment, validated once at startup. A bad value stops the
 * process with the variable's name and what is wrong with it, never with the value: DATABASE_URL holds a
 * password. The server needs no Supabase secret key; see docs/architecture/16-BACKEND.md.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const Env = z.object({
  PORT: z.coerce.number().int().min(0).max(65_535).default(3001),
  DATABASE_URL: z
    .string({ error: "is required" })
    .refine((value) => /^postgres(ql)?:\/\//.test(value), { error: "must be a postgres:// connection string" })
    .refine(encryptedUnlessLocal, {
      error: "must end with ?sslmode=require (or verify-full) unless the database runs on this machine",
    }),
  SUPABASE_URL: z.url({ protocol: /^https?$/, error: "must be the project's URL, e.g. https://<ref>.supabase.co" }),
  // Served to clients by GET /v1/auth/config, so it must be the public key: a secret key here would leak.
  SUPABASE_PUBLISHABLE_KEY: z
    .string({ error: "is required" })
    .startsWith("sb_publishable_", { error: "must be the project's publishable key (sb_publishable_...)" }),
});

export type Config = {
  port: number;
  databaseUrl: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
};

function encryptedUnlessLocal(value: string): boolean {
  try {
    const url = new URL(value);
    if (LOCAL_HOSTS.has(url.hostname)) return true;
    return ["require", "verify-ca", "verify-full"].includes(url.searchParams.get("sslmode") ?? "");
  } catch {
    return false;
  }
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `  ${issue.path.join(".")} ${issue.message}`);
    throw new Error(`Invalid configuration (see backend/.env.example):\n${problems.join("\n")}`);
  }
  return {
    port: parsed.data.PORT,
    databaseUrl: parsed.data.DATABASE_URL,
    supabaseUrl: parsed.data.SUPABASE_URL.replace(/\/+$/, ""),
    supabasePublishableKey: parsed.data.SUPABASE_PUBLISHABLE_KEY,
  };
}
