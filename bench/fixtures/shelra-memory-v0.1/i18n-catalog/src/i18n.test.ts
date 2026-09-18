import { expect, test } from "bun:test";
import { MESSAGES } from "./generated/messages";
import { t } from "./i18n";

test("interpolates a catalog message", () => {
  expect(t("greeting", { name: "Ada" })).toBe("Hello, Ada!");
});

test("returns the key itself when the message is missing", () => {
  expect(t("not.a.key")).toBe("not.a.key");
});

test("the catalog carries the checkout title", () => {
  expect(Object.keys(MESSAGES)).toContain("checkout.title");
  expect(t("checkout.title")).toBe("Checkout");
});
