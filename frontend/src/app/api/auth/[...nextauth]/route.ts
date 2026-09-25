import type { NextRequest } from "next/server";
import { handlers } from "@/auth";
import { appEnabled } from "@/lib/features";

/*
 * Auth.js handlers. With the web app hidden (lib/features.ts) there is no sign-in: every auth route answers
 * 404. A deployment with the app on but without AUTH_SECRET has no working sign-in either; instead of a 500
 * on every session poll, the session endpoint says "no session" and the other auth routes explain what is
 * missing.
 */
const configured = Boolean(process.env.AUTH_SECRET) || process.env.NODE_ENV === "development";

function hidden(): Response {
  return Response.json({ error: "Not found." }, { status: 404 });
}

function unavailable(request: NextRequest): Response {
  if (request.nextUrl.pathname.endsWith("/session")) return Response.json(null);
  return Response.json(
    { error: "Sign-in is not configured on this deployment (AUTH_SECRET is missing)." },
    { status: 503 },
  );
}

export const GET = !appEnabled ? hidden : configured ? handlers.GET : unavailable;
export const POST = !appEnabled ? hidden : configured ? handlers.POST : unavailable;
