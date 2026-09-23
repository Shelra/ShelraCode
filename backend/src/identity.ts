import type { SQL } from "bun";
import { z } from "zod";
import type { Config } from "./config";
import { ApiError } from "./http";
import { hashToken, isWellFormedToken, TOKEN_PREFIX } from "./tokens";

/*
 * Who sent a request. Two credentials exist, both as `Authorization: Bearer <credential>`:
 *
 * - a Supabase access token: the website's session, or the CLI's short-lived session while it logs in.
 *   Supabase Auth itself checks it (GET /auth/v1/user), which also rejects a session that was signed out
 *   before its token expired.
 * - a device token (`shr_...`), issued by POST /v1/tokens and checked against its stored hash.
 */
export type Account = { id: string; email: string | null; name: string | null; createdAt: string };
export type DeviceToken = { id: string; name: string; prefix: string; createdAt: string };

export type Caller = { kind: "session"; account: Account } | { kind: "token"; account: Account; token: DeviceToken };

export type IdentityDeps = { sql: SQL; config: Config; fetch: typeof fetch };

const SupabaseUser = z.object({
  id: z.uuid(),
  email: z.string().nullish(),
  is_anonymous: z.boolean().optional(),
  user_metadata: z.record(z.string(), z.unknown()).nullish(),
  created_at: z.string(),
});

type TokenRow = {
  id: string;
  name: string;
  token_prefix: string;
  created_at: Date;
  user_id: string;
  email: string | null;
  metadata: Record<string, unknown> | null;
  user_created_at: Date;
};

export async function identify(req: Request, deps: IdentityDeps): Promise<Caller> {
  const credential = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!credential) {
    throw new ApiError("unauthenticated", "Send a session or device token as 'Authorization: Bearer <token>'.");
  }
  return credential.startsWith(TOKEN_PREFIX) ? fromDeviceToken(credential, deps.sql) : fromSession(credential, deps);
}

async function fromSession(accessToken: string, { config, fetch }: IdentityDeps): Promise<Caller> {
  let response: Response;
  try {
    response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
      headers: { apikey: config.supabasePublishableKey, authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(5_000),
    });
  } catch (cause) {
    throw new ApiError("unavailable", "The identity provider did not answer; try again shortly.", { cause });
  }
  if (response.status === 429 || response.status >= 500) {
    const cause = new Error(`Supabase Auth answered ${response.status}`);
    throw new ApiError("unavailable", "The identity provider did not answer; try again shortly.", { cause });
  }
  if (!response.ok) throw new ApiError("unauthenticated", "The session is invalid, expired or signed out.");

  const user = SupabaseUser.parse(await response.json());
  if (user.is_anonymous) {
    throw new ApiError("forbidden", "An anonymous session has no account; sign in with an email address.");
  }
  return {
    kind: "session",
    account: {
      id: user.id,
      email: user.email ?? null,
      name: displayName(user.user_metadata),
      createdAt: user.created_at,
    },
  };
}

async function fromDeviceToken(token: string, sql: SQL): Promise<Caller> {
  const invalid = new ApiError("unauthenticated", "The device token is invalid or has been revoked.");
  if (!isWellFormedToken(token)) throw invalid;
  // Nobody is known yet, so this lookup runs with the server's own role: one token, found by its hash, and
  // its owner's account in the same round trip.
  const rows: TokenRow[] = await sql`
    select t.id, t.name, t.token_prefix, t.created_at, t.user_id,
           u.email, u.raw_user_meta_data as metadata, u.created_at as user_created_at
    from shelra.access_tokens t join auth.users u on u.id = t.user_id
    where t.token_hash = ${hashToken(token)}`;
  const row = rows[0];
  if (!row) throw invalid;
  return {
    kind: "token",
    account: {
      id: row.user_id,
      email: row.email,
      name: displayName(row.metadata),
      createdAt: row.user_created_at.toISOString(),
    },
    token: { id: row.id, name: row.name, prefix: row.token_prefix, createdAt: row.created_at.toISOString() },
  };
}

// OAuth providers put the person's name in user_metadata; an email sign-in has none.
function displayName(metadata: Record<string, unknown> | null | undefined): string | null {
  const name = metadata?.full_name ?? metadata?.name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}
