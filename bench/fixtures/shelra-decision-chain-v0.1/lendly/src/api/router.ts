import type { Database } from "bun:sqlite";
import { bookRoutes } from "./books";
import { type ApiRequest, type ApiResponse, error, type Route } from "./http";
import { userRoutes } from "./users";

export type { ApiRequest, ApiResponse } from "./http";

/** Every route of the API, matched in order. */
export const routes: Route[] = [...userRoutes, ...bookRoutes];

function match(pattern: string, path: string): Record<string, string> | null {
  const expected = pattern.split("/");
  const actual = path.split("/");
  if (expected.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (const [index, part] of expected.entries()) {
    const value = actual[index] ?? "";
    if (part.startsWith(":")) params[part.slice(1)] = decodeURIComponent(value);
    else if (part !== value) return null;
  }
  return params;
}

/** Answers one API request. `now` is the clock, so tests control time. */
export function handle(db: Database, request: ApiRequest, now: Date = new Date()): ApiResponse {
  for (const route of routes) {
    if (route.method !== request.method) continue;
    const params = match(route.path, request.path);
    if (params) return route.handler({ db, params, query: request.query ?? {}, body: request.body ?? {}, now });
  }
  return error(404, `No route for ${request.method} ${request.path}`);
}
