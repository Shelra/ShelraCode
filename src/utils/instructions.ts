import * as fs from "fs";
import * as path from "path";
import { executeEventHooks } from "../hooks/index";
import type { InstructionsLoadedHookInput } from "../hooks/types";
import { getProductUserDir } from "../product/identity";
import { findGitRoot } from "./git-root";

const instructionsHookFiredFor = new Set<string>();

function readNonEmptyFile(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const text = fs.readFileSync(filePath, "utf-8").trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

function directoryChain(fromRoot: string, toCwd: string): string[] {
  const rel = path.relative(fromRoot, toCwd);
  if (rel === "") return [fromRoot];
  if (rel.startsWith("..")) return [toCwd];

  const segments = rel.split(path.sep).filter(Boolean);
  const chain: string[] = [];
  let acc = fromRoot;
  chain.push(acc);
  for (const segment of segments) {
    acc = path.join(acc, segment);
    chain.push(acc);
  }
  return chain;
}

/** The instruction files that apply to `canonicalCwd`, in load order: user-wide first, then root to cwd. */
function instructionFiles(canonicalCwd: string): Array<{ file: string; text: string }> {
  const found: Array<{ file: string; text: string }> = [];

  const globalFile = path.join(getProductUserDir(), "AGENTS.md");
  const globalAgents = readNonEmptyFile(globalFile);
  if (globalAgents) found.push({ file: globalFile, text: globalAgents });

  const root = findGitRoot(canonicalCwd) ?? canonicalCwd;
  for (const dir of directoryChain(root, canonicalCwd)) {
    const overridePath = path.join(dir, "AGENTS.override.md");
    if (fs.existsSync(overridePath)) {
      const text = readNonEmptyFile(overridePath);
      if (text) found.push({ file: overridePath, text });
      continue;
    }
    const file = path.join(dir, "AGENTS.md");
    const text = readNonEmptyFile(file);
    if (text) found.push({ file, text });
  }

  return found;
}

function loadAgentsSegments(canonicalCwd: string): string[] {
  return instructionFiles(canonicalCwd).map((entry) => entry.text);
}

/** Paths of the instruction files (AGENTS.md and overrides) a session in `cwd` loads. */
export function listInstructionFiles(cwd: string): string[] {
  let canonical: string;
  try {
    canonical = fs.realpathSync.native(cwd);
  } catch {
    canonical = path.resolve(cwd);
  }
  return instructionFiles(canonical).map((entry) => entry.file);
}

export function loadCustomInstructions(cwd: string): string | null {
  let canonical: string;
  try {
    canonical = fs.realpathSync.native(cwd);
  } catch {
    canonical = path.resolve(cwd);
  }

  const parts: string[] = [...loadAgentsSegments(canonical)];

  if (parts.length === 0) return null;

  if (parts.length > 0 && !instructionsHookFiredFor.has(canonical)) {
    instructionsHookFiredFor.add(canonical);
    const hookInput: InstructionsLoadedHookInput = {
      hook_event_name: "InstructionsLoaded",
      files_loaded: parts.length,
      cwd: canonical,
    };
    executeEventHooks(hookInput, canonical).catch(() => {});
  }

  return parts.join("\n\n");
}
