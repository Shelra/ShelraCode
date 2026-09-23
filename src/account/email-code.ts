import type { AuthConfig } from "./client";
import { AccountError } from "./client";

/*
 * Supabase Auth's one-time email code, over its REST API (the requests supabase-js sends for signInWithOtp
 * and verifyOtp), so the CLI needs no Supabase SDK and no browser. Only the publishable key is used. The
 * session that comes back stays in memory: `shelra login` exchanges it for a device token and signs it out.
 */
type FetchLike = typeof fetch;

export type EmailSession = { accessToken: string };

async function authRequest(
  config: AuthConfig,
  path: string,
  init: { body?: unknown; bearer?: string },
  fetchImpl: FetchLike,
): Promise<Response> {
  const headers: Record<string, string> = { apikey: config.supabasePublishableKey };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.bearer) headers.authorization = `Bearer ${init.bearer}`;
  try {
    return await fetchImpl(`${config.supabaseUrl.replace(/\/+$/, "")}/auth/v1${path}`, {
      method: "POST",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new AccountError(`Could not reach the sign-in service (${reason}).`);
  }
}

// Supabase Auth has answered errors as { msg } and as { error_description }; take whichever is there.
async function authFailure(response: Response): Promise<AccountError> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const text = [body.msg, body.error_description, body.message, body.error].find((v) => typeof v === "string");
  const code = typeof body.error_code === "string" ? body.error_code : undefined;
  return new AccountError(
    (text as string | undefined) ?? `Sign-in failed (${response.status}).`,
    response.status,
    code,
  );
}

/** Sends a sign-in code to `email`, creating the account on first use. */
export async function sendEmailCode(config: AuthConfig, email: string, fetchImpl: FetchLike = fetch): Promise<void> {
  const response = await authRequest(config, "/otp", { body: { email, create_user: true } }, fetchImpl);
  if (response.status === 429) {
    throw new AccountError("A code was requested too recently; wait a minute and try again.", 429);
  }
  if (!response.ok) throw await authFailure(response);
}

export async function verifyEmailCode(
  config: AuthConfig,
  email: string,
  code: string,
  fetchImpl: FetchLike = fetch,
): Promise<EmailSession> {
  const response = await authRequest(config, "/verify", { body: { type: "email", email, token: code } }, fetchImpl);
  if (!response.ok) throw await authFailure(response);
  const body = (await response.json().catch(() => ({}))) as { access_token?: unknown };
  if (typeof body.access_token !== "string" || !body.access_token) {
    throw new AccountError("The sign-in service did not return a session.");
  }
  return { accessToken: body.access_token };
}

/** Ends the short-lived session; best effort, since it is discarded either way. */
export async function signOutSession(config: AuthConfig, accessToken: string, fetchImpl: FetchLike = fetch) {
  try {
    await authRequest(config, "/logout?scope=local", { bearer: accessToken }, fetchImpl);
  } catch {
    // The session's refresh token was never stored; its access token expires on its own.
  }
}
