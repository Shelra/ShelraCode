export interface User {
  id: string;
  email: string;
  name: string;
}

export type SignUpResult = { ok: true; user: User } | { ok: false; reason: "invalid-email" | "email-taken" };

const users = new Map<string, User>();
let nextId = 1;

export function resetUsers(): void {
  users.clear();
  nextId = 1;
}

export function findByEmail(email: string): User | undefined {
  const wanted = email.trim().toLowerCase();
  for (const user of users.values()) {
    if (user.email === wanted) return user;
  }
  return undefined;
}

export function signUp(input: { email: string; name: string }): SignUpResult {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(email)) return { ok: false, reason: "invalid-email" };
  if (findByEmail(email)) return { ok: false, reason: "email-taken" };
  const user: User = { id: `u${nextId}`, email, name: input.name.trim() };
  nextId += 1;
  users.set(user.id, user);
  return { ok: true, user };
}
