import { expect, test } from "bun:test";
import { migrateState } from "./state";

test("moves the v1 name into the profile", () => {
  expect(migrateState({ version: 1, userName: "Ada" })).toMatchObject({
    version: 2,
    profile: { name: "Ada" },
  });
});
