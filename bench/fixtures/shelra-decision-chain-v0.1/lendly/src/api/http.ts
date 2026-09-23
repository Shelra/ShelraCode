import type { Database } from "bun:sqlite";

export interface ApiRequest {
  method: string;
  /** The path without its query string, such as /books/3. */
  path: string;
  query?: Record<string, string>;
  body?: unknown;
}

export interface ApiResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface RouteContext {
  db: Database;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  now: Date;
}

export interface Route {
  method: string;
  /** A path with :name segments, such as /users/:id. */
  path: string;
  handler: (context: RouteContext) => ApiResponse;
}

export function json(status: number, body: unknown): ApiResponse {
  return { status, body };
}

export function error(status: number, message: string): ApiResponse {
  return { status, body: { error: message } };
}

/** A field of a JSON request body, or undefined. */
export function field(body: unknown, name: string): unknown {
  return body && typeof body === "object" ? (body as Record<string, unknown>)[name] : undefined;
}
