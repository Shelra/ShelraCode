import { expect, test } from "bun:test";
import { loadConfig } from "./config";

test("loads the documented defaults", () => {
  expect(loadConfig({})).toEqual({
    host: "127.0.0.1",
    port: 3000,
    debug: false,
    retries: 3,
  });
});
