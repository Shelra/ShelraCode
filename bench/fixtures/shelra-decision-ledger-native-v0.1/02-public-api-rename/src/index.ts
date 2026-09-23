import { findUser, type User } from "./users";

export type { User } from "./users";
export { listUsers } from "./users";

/** The user with this id, or undefined when there is none. Ids look like u1, u2 and so on. */
export function fetchUsr(id: string): User | undefined {
  if (!/^u\d+$/u.test(id)) throw new TypeError(`Not a user id: ${id}`);
  return findUser(id);
}
