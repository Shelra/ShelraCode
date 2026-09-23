import { z } from "zod";

/*
 * The CLI's side of the ShelraCode account service (backend/, docs/architecture/16-BACKEND.md). Only
 * `shelra login`, `whoami` and `logout` call it; the agent never does, so a missing or unreachable service
 * cannot affect a coding session. Every response is validated before use: it comes from the network.
 */
type FetchLike = typeof fetch;

export class AccountError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "AccountError";
  }
}

const ErrorBody = z.object({
  error: z.object({ code: z.string(), message: z.string(), requestId: z.string().optional() }),
});

const AuthConfigBody = z.object({
  supabaseUrl: z.url({ protocol: /^https?$/ }),
  supabasePublishableKey: z.string().startsWith("sb_publishable_"),
});

const DeviceTokenBody = z.object({ id: z.string(), name: z.string(), prefix: z.string(), createdAt: z.string() });

const IssuedTokenBody = DeviceTokenBody.extend({ token: z.string().startsWith("shr_") });

const MeBody = z.object({
  account: z.object({
    id: z.string(),
    email: z.string().nullable(),
    name: z.string().nullable(),
    createdAt: z.string(),
  }),
  credential: z.discriminatedUnion("type", [
    z.object({ type: z.literal("session") }),
    DeviceTokenBody.extend({ type: z.literal("token") }),
  ]),
});

export type AuthConfig = z.infer<typeof AuthConfigBody>;
export type IssuedToken = z.infer<typeof IssuedTokenBody>;
export type Me = z.infer<typeof MeBody>;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The account service URL as the person gave it, checked: sessions and tokens travel to it, so it must be
 * https unless it is this machine (a development server).
 */
export function normalizeAccountUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new AccountError(`"${value}" is not a URL.`);
  }
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new AccountError("The account service URL must use https (http is accepted only for localhost).");
  }
  return url.origin;
}

async function call<T>(
  schema: z.ZodType<T>,
  apiUrl: string,
  path: string,
  init: RequestInit,
  fetchImpl: FetchLike,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(`${apiUrl}${path}`, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new AccountError(`Could not reach the account service at ${apiUrl} (${reason}).`);
  }
  const body: unknown = response.status === 204 ? null : await response.json().catch(() => undefined);
  if (!response.ok) {
    const parsed = ErrorBody.safeParse(body);
    if (!parsed.success) throw new AccountError(`The account service answered ${response.status}.`, response.status);
    const { code, message, requestId } = parsed.data.error;
    throw new AccountError(message, response.status, code, requestId);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AccountError("The account service sent a response this version of shelra does not understand.");
  }
  return parsed.data;
}

export function getAuthConfig(apiUrl: string, fetchImpl: FetchLike = fetch): Promise<AuthConfig> {
  return call(AuthConfigBody, apiUrl, "/v1/auth/config", { method: "GET" }, fetchImpl);
}

/** Exchanges a signed-in Supabase session for a device token, shown this once. */
export function createDeviceToken(
  apiUrl: string,
  accessToken: string,
  name: string,
  fetchImpl: FetchLike = fetch,
): Promise<IssuedToken> {
  return call(
    IssuedTokenBody,
    apiUrl,
    "/v1/tokens",
    {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ name }),
    },
    fetchImpl,
  );
}

export function getMe(apiUrl: string, token: string, fetchImpl: FetchLike = fetch): Promise<Me> {
  return call(MeBody, apiUrl, "/v1/me", { method: "GET", headers: { authorization: `Bearer ${token}` } }, fetchImpl);
}

export async function revokeDeviceToken(
  apiUrl: string,
  token: string,
  tokenId: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await call(
    z.null(),
    apiUrl,
    `/v1/tokens/${encodeURIComponent(tokenId)}`,
    { method: "DELETE", headers: { authorization: `Bearer ${token}` } },
    fetchImpl,
  );
}
