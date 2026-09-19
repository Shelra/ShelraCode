import { describe, expect, it } from "vitest";
import { API_KEY_ENV, CLI_NAME, CONFIG_DIR_NAME, PRODUCT_NAME } from "./identity";

describe("Shelra product identity", () => {
  it("uses the canonical product names", () => {
    expect(PRODUCT_NAME).toBe("ShelraCode");
    expect(CLI_NAME).toBe("shelra");
    expect(CONFIG_DIR_NAME).toBe(".shelra");
    expect(API_KEY_ENV).toBe("SHELRA_API_KEY");
  });
});
