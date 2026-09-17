import { expect, test } from "bun:test";
import { createApiRouter } from "./api";

test("serves health", async () => {
  const response = await createApiRouter().handle(new Request("http://bench.test/health"));
  expect(response.status).toBe(200);
});
