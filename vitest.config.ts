import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["dist/**", "node_modules/**", "tmp/**", ".claude/**", ".cursor/**", "frontend/**"],
    // Failures that tests provoke on purpose must not land in the person's own swallowed-error log.
    env: { SHELRA_DIAGNOSTICS_LOG: "off" },
  },
});
