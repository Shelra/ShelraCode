import { expect, test } from "bun:test";
import { slugify } from "./slug";

test("normalizes a simple phrase", () => {
  expect(slugify("Hello World")).toBe("hello-world");
});
