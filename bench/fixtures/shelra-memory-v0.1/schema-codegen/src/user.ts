import { USER_FIELDS, type User } from "./generated/schema";

export { USER_FIELDS };

export function formatUser(_user: User): string {
  throw new Error("not implemented");
}
