import type { z } from "zod";

/*
 * The API's one error strategy. A handler throws an ApiError for anything the client should be told; the
 * route wrapper in app.ts turns it into
 *
 *   { "error": { "code": "not_found", "message": "...", "requestId": "...", "issues"?: [...] } }
 *
 * with the matching status. Any other thrown value is a bug or an outage: the client gets `internal` and
 * the request id, and the details go to the log only.
 */
export type ErrorCode =
  | "invalid_request"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "internal"
  | "unavailable";

const STATUS: Record<ErrorCode, number> = {
  invalid_request: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  internal: 500,
  unavailable: 503,
};

export type Issue = { path: string; message: string };

export class ApiError extends Error {
  readonly status: number;
  readonly issues?: Issue[];

  /** `cause` is logged with the request, never sent to the client. */
  constructor(
    readonly code: ErrorCode,
    message: string,
    options: { issues?: Issue[]; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "ApiError";
    this.status = STATUS[code];
    this.issues = options.issues;
  }
}

export function errorResponse(error: ApiError, requestId: string): Response {
  const body = {
    code: error.code,
    message: error.message,
    requestId,
    ...(error.issues ? { issues: error.issues } : {}),
  };
  // RFC 6750: a 401 names the scheme the client should use.
  const headers: Record<string, string> = error.status === 401 ? { "www-authenticate": "Bearer" } : {};
  return Response.json({ error: body }, { status: error.status, headers });
}

/** Parses a JSON body against `schema`; anything else is the client's error, reported field by field. */
export async function readJson<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError("invalid_request", "The request body must be JSON.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
    throw new ApiError("invalid_request", "The request body is invalid.", { issues });
  }
  return parsed.data;
}
