import { expect, test } from "bun:test";
import { withRetry } from "./retry";

test("returns the first successful operation", async () => {
  await expect(withRetry(async () => "ok")).resolves.toBe("ok");
});
