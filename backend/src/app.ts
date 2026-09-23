import type { SQL } from "bun";
import { z } from "zod";
import type { Config } from "./config";
import { asUser } from "./db";
import { ApiError, errorResponse, readJson } from "./http";
import { type Caller, identify } from "./identity";
import { describeError, type Logger } from "./log";
import { displayPrefix, generateToken, hashToken } from "./tokens";

/*
 * The HTTP surface, on Bun.serve's own router. Each route is wrapped once by `handle`, which gives the
 * request an id (returned as x-request-id), turns thrown errors into the error shape of http.ts, and logs
 * one line with the route, status, duration and, for a 5xx, the cause.
 *
 *   GET    /health          the process is up (no dependencies checked)
 *   GET    /v1/auth/config  where clients sign in: the Supabase URL and publishable key
 *   GET    /v1/me           the caller's account and the credential used
 *   POST   /v1/tokens       a signed-in session issues a device token (shown once)
 *   DELETE /v1/tokens/:id   revoke (delete) a device token; a device token may revoke only itself
 */
export type AppDeps = { config: Config; sql: SQL; log: Logger; fetch?: typeof fetch };

/** Device tokens one account may hold: every machine and script a person runs, with room to spare. */
export const MAX_TOKENS = 50;

const CreateTokenBody = z.object({ name: z.string().trim().min(1).max(64) });

type Context = { requestId: string; params: Record<string, string>; userId?: string };
type Handler = (req: Request, ctx: Context) => Response | Promise<Response>;

type TokenRow = { id: string; name: string; token_prefix: string; created_at: Date };

export function createApp(deps: AppDeps) {
  const { config, sql, log } = deps;
  const identityDeps = { sql, config, fetch: deps.fetch ?? fetch };

  function handle(route: string, handler: Handler) {
    return async (req: Request): Promise<Response> => {
      const params = (req as Request & { params?: Record<string, string> }).params ?? {};
      const ctx: Context = { requestId: crypto.randomUUID(), params };
      const started = performance.now();
      let response: Response;
      let failure: unknown;
      try {
        response = await handler(req, ctx);
      } catch (error) {
        failure = error;
        const apiError =
          error instanceof ApiError
            ? error
            : new ApiError("internal", "Something went wrong on our side; quote the request id if you report it.");
        response = errorResponse(apiError, ctx.requestId);
      }
      response.headers.set("x-request-id", ctx.requestId);
      const failed = response.status >= 500;
      log({
        level: failed ? "error" : "info",
        msg: "request",
        requestId: ctx.requestId,
        method: req.method,
        route,
        status: response.status,
        ms: Math.round(performance.now() - started),
        ...(ctx.userId ? { userId: ctx.userId } : {}),
        ...(failure instanceof ApiError ? { code: failure.code } : {}),
        ...(failed && failure !== undefined ? { error: describeError(causeOf(failure)) } : {}),
      });
      return response;
    };
  }

  async function caller(req: Request, ctx: Context): Promise<Caller> {
    const who = await identify(req, identityDeps);
    ctx.userId = who.account.id;
    return who;
  }

  const authConfig = handle("auth.config", () =>
    Response.json({ supabaseUrl: config.supabaseUrl, supabasePublishableKey: config.supabasePublishableKey }),
  );

  const me = handle("me.get", async (req, ctx) => {
    const who = await caller(req, ctx);
    const credential = who.kind === "token" ? { type: "token" as const, ...who.token } : { type: "session" as const };
    return Response.json({ account: who.account, credential });
  });

  const createToken = handle("tokens.create", async (req, ctx) => {
    const who = await caller(req, ctx);
    // A leaked device token must not be able to mint more of itself.
    if (who.kind !== "session") throw new ApiError("forbidden", "Only a signed-in session can create device tokens.");
    const { name } = await readJson(req, CreateTokenBody);
    const token = generateToken();
    const userId = who.account.id;
    const row = await asUser(sql, userId, async (tx) => {
      const [held] = await tx`select count(*)::int as count from shelra.access_tokens where user_id = ${userId}`;
      if ((held?.count ?? 0) >= MAX_TOKENS) {
        throw new ApiError("conflict", `This account already has ${MAX_TOKENS} device tokens; revoke one first.`);
      }
      const [created]: TokenRow[] = await tx`
        insert into shelra.access_tokens (user_id, name, token_prefix, token_hash)
        values (${userId}, ${name}, ${displayPrefix(token)}, ${hashToken(token)})
        returning id, name, token_prefix, created_at`;
      return created;
    });
    if (!row) throw new Error("The token insert returned no row");
    const body = {
      id: row.id,
      name: row.name,
      prefix: row.token_prefix,
      createdAt: row.created_at.toISOString(),
      token,
    };
    return Response.json(body, { status: 201 });
  });

  const revokeToken = handle("tokens.revoke", async (req, ctx) => {
    const who = await caller(req, ctx);
    const id = ctx.params.id ?? "";
    // A leaked device token must not be able to sign the person's other machines out.
    if (who.kind === "token" && who.token.id !== id) {
      throw new ApiError("forbidden", "A device token can revoke only itself.");
    }
    const notFound = new ApiError("not_found", "This account has no token with that id.");
    if (!z.uuid().safeParse(id).success) throw notFound;
    const userId = who.account.id;
    const revoked = await asUser(
      sql,
      userId,
      (tx) => tx`delete from shelra.access_tokens where id = ${id} and user_id = ${userId} returning id`,
    );
    if (revoked.length === 0) throw notFound;
    return new Response(null, { status: 204 });
  });

  const unmatched = handle("unmatched", (req) => {
    throw new ApiError("not_found", `No route for ${req.method} ${new URL(req.url).pathname}.`);
  });

  return {
    routes: {
      "/health": { GET: () => Response.json({ status: "ok" }) },
      "/v1/auth/config": { GET: authConfig },
      "/v1/me": { GET: me },
      "/v1/tokens": { POST: createToken },
      "/v1/tokens/:id": { DELETE: revokeToken },
    },
    fetch: unmatched,
  };
}

// An ApiError that wraps an outage (e.g. `unavailable`) carries the real failure as its cause.
function causeOf(error: unknown): unknown {
  return error instanceof ApiError && error.cause !== undefined ? error.cause : error;
}
