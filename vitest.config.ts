import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // frontend/ and backend/ are separate packages with their own test runners (backend: `bun test`).
    exclude: ["dist/**", "node_modules/**", "tmp/**", ".claude/**", ".cursor/**", "frontend/**", "backend/**"],
    // Failures that tests provoke on purpose must not land in the person's own swallowed-error log, nor test turns
    // in their session traces, nor a test's "always …" in their own user-wide memory.
    env: {
      SHELRA_DIAGNOSTICS_LOG: "off",
      SHELRA_TRACE: "off",
      SHELRA_USER_MEMORY_ROOT: join(tmpdir(), "shelra-vitest-user-memory"),
    },
  },
});
