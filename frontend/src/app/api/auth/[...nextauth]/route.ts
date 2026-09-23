import type { NextRequest } from "next/server";
import { handlers } from "@/auth";

/*
 * Auth.js handlers. A production deployment without AUTH_SECRET has no working
 * sign-in; instead of a 500 on every session poll, the session endpoint says
 * "no session" and the other auth routes explain what is missing.
 */
const configured = Boolean(process.env.AUTH_SECRET) || process.env.NODE_ENV === "development";

function unavailable(request: NextRequest): Response {
  if (request.nextUrl.pathname.endsWith("/session")) return Response.json(null);
  return Response.json(
    { error: "Sign-in is not configured on this deployment (AUTH_SECRET is missing)." },
    { status: 503 },
  );
}

export const GET = configured ? handlers.GET : unavailable;
export const POST = configured ? handlers.POST : unavailable;
