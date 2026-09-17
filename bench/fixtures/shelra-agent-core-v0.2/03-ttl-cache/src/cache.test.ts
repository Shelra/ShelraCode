import { expect, test } from "bun:test";
import { TtlCache } from "./cache";

test("returns a value before its ttl", () => {
  const cache = new TtlCache(() => 10);
  cache.set("key", "value", 5);
  expect(cache.get("key")).toBe("value");
});
