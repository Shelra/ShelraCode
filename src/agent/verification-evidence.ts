/**
 * What counts as "the agent verified its work": a shell command that exercises the real
 * program (tests, build, type-check, lint, a real request), a rendered-output observation, or
 * a delegated verification sub-agent. Reading a file back, listing a directory, or restating
 * the diff never counts — that is the model's own claim, not evidence.
 *
 * Shared by the turn loop's completion gate (`agent.ts`) and the benchmark harness
 * (`src/bench/agent-executor.ts`) so the product and its measurement never disagree about what
 * verification means. The list is deliberately broad across ecosystems: a missing runner here
 * silently turns every real check a project runs into "no evidence" (found live 2026-09-17 —
 * `bun test`, the runner of this very repository, was absent, so the gate looped a task through
 * 50 model steps and 1.6M tokens while the agent kept running its tests).
 */
export const VERIFICATION_COMMAND_RE =
  /(?:^|[\s;&|(])(?:curl|wget|Invoke-WebRequest|Invoke-RestMethod|http|xh|pytest|py\.test|jest|vitest|mocha|ava|tap|uvu|playwright|cypress|karma|bun\s+(?:test|run\s+(?:test|build|check|lint|typecheck|verify|e2e|coverage)[\w:-]*)|bunx\s+(?:vitest|jest|tsc|playwright|biome|eslint)|npm\s+(?:test|run\s+(?:test|build|check|lint|typecheck|verify|e2e|coverage)[\w:-]*)|npx\s+(?:vitest|jest|tsc|playwright|mocha|biome|eslint)|yarn\s+(?:test|build|lint|typecheck|check|verify|e2e)|pnpm\s+(?:test|build|lint|typecheck|check|verify|e2e|run\s+\S+)|deno\s+(?:test|check|lint)|go\s+(?:test|build|vet)|cargo\s+(?:test|build|check|clippy|run)|python3?\s+-m\s+(?:pytest|unittest)|dotnet\s+(?:test|build)|mvn\s+(?:test|verify|package)|gradlew?\s+(?:test|build|check)|make\s+(?:test|check|build|lint)|ctest|rspec|phpunit|mix\s+test|swift\s+test|flutter\s+test|tsc\b|biome\s+(?:check|lint)|eslint|ruff\s+(?:check|format)|mypy|pyright|black\s+--check|prettier\s+--check|gofmt|rustfmt\s+--check)\b/i;

/** Human-readable evidence line for a verification-shaped tool call, or `null` when it is not one. */
export function describeVerificationEvidence(toolName: string, argsJson: string): string | null {
  if (toolName === "bash") {
    try {
      const command = (JSON.parse(argsJson) as { command?: string }).command ?? "";
      if (VERIFICATION_COMMAND_RE.test(command)) return `bash: ${command.slice(0, 120)}`;
    } catch {
      // malformed args; no evidence either way
    }
    return null;
  }
  if (toolName === "computer_screenshot" || toolName === "computer_snapshot") {
    return `${toolName}: observed rendered output`;
  }
  if (toolName === "task") {
    try {
      const agentName = (JSON.parse(argsJson) as { agent?: string }).agent ?? "";
      if (agentName === "verify" || agentName === "ui-verify" || agentName === "computer") {
        return `task(${agentName}): delegated verification completed`;
      }
    } catch {
      // malformed args; no evidence either way
    }
    return null;
  }
  return null;
}
