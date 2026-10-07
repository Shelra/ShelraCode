import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Agent tests drive real timers and processes: with one fork per core they starve each other and trip the 5 s
    // limit (seen 2026-10-07: nine timeouts, all green with three workers), so the pool is capped.
    maxWorkers: 4,
    exclude: ["dist/**", "node_modules/**", "tmp/**", ".claude/**", ".cursor/**"],
    // Failures that tests provoke on purpose must not land in the person's own swallowed-error log, nor test turns
    // in their session traces, nor a test's "always …" in their own user-wide memory. A test turn searches the web
    // only when the test turns research back on with a fake search.
    env: {
      SHELRA_DIAGNOSTICS_LOG: "off",
      SHELRA_TRACE: "off",
      // A test that runs a delegated agent must not leave run records in the real home (src/extend/runs.ts).
      SHELRA_AGENT_RUNS: "off",
      SHELRA_RESEARCH: "off",
      SHELRA_USER_MEMORY_ROOT: join(tmpdir(), "shelra-vitest-user-memory"),
    },
  },
});
