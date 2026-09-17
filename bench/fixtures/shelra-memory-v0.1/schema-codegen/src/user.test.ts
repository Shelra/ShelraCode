import { expect, test } from "bun:test";
import { USER_FIELDS } from "./generated/schema";
import { formatUser } from "./user";

test("formats every schema field in schema order", () => {
  const user = Object.fromEntries(USER_FIELDS.map((field) => [field, `${field}-value`])) as never;
  expect(formatUser(user)).toBe(USER_FIELDS.map((field) => `${field}=${field}-value`).join("; "));
});
