import * as fs from "fs";
import * as path from "path";
import { loadInstructionSet } from "../extend/instructions";
import { executeEventHooks } from "../hooks/index";
import type { InstructionsLoadedHookInput } from "../hooks/types";

const instructionsHookFiredFor = new Set<string>();

function canonicalOf(cwd: string): string {
  try {
    return fs.realpathSync.native(cwd);
  } catch {
    return path.resolve(cwd);
  }
}

/** Paths of the instruction files (SHELRA.md, AGENTS.md, rules, overrides) a session in `cwd` loads. */
export function listInstructionFiles(cwd: string): string[] {
  return loadInstructionSet(canonicalOf(cwd))
    .sources.filter((source) => source.applied && source.kind !== "import")
    .map((source) => source.path);
}

/**
 * The text of every instruction file that applies, in load order (`src/extend/instructions.ts` has the order, the
 * imports and the diagnostics). Rebuilt from the files on each call, so it never depends on what survived a summary.
 * `paths` are the files the request is about, which switch on the rules scoped to them.
 */
export function loadCustomInstructions(cwd: string, options: { paths?: string[] } = {}): string | null {
  const canonical = canonicalOf(cwd);
  const set = loadInstructionSet(canonical, options);
  if (set.text === null) return null;

  if (!instructionsHookFiredFor.has(canonical)) {
    instructionsHookFiredFor.add(canonical);
    const hookInput: InstructionsLoadedHookInput = {
      hook_event_name: "InstructionsLoaded",
      files_loaded: set.sources.filter((source) => source.applied && source.kind !== "import").length,
      cwd: canonical,
    };
    executeEventHooks(hookInput, canonical).catch(() => {});
  }

  return set.text;
}
