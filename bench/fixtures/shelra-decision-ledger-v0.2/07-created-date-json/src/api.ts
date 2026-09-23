import { findUser } from "./users";

export interface ApiResponse {
  status: number;
  body: Record<string, unknown>;
}

/** GET /users/:id — the mobile apps read this response. */
export function getUserResponse(id: string): ApiResponse {
  const user = findUser(id);
  if (!user) return { status: 404, body: { error_code: "user_not_found" } };
  return { status: 200, body: { user_id: user.id, display_name: user.displayName } };
}
