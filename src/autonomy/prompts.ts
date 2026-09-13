/**
 * Role prompts and answer schemas for the intelligence boundary.
 *
 * Two rules govern everything here:
 *  1. Prompts are lean. Replacing the host agent's default preamble with a short,
 *     role-scoped prompt is worth roughly two orders of magnitude in cost per call,
 *     so we never ship a general-purpose agent preamble.
 *  2. Answers are structured. The runtime acts on fields, never on prose, so every
 *     call that drives a decision carries a schema.
 *
 * Check specs are described to the model in a FLAT shape (a `kind` discriminator plus
 * optional siblings) rather than a JSON Schema `oneOf`. Models comply with flat shapes far
 * more reliably, and `narrowCheckSpec` re-establishes the strict union on our side.
 */

import type { AcceptanceCriterion, CheckSpec, ViewportName } from "./types";

export const SYSTEM_INTERPRET =
  "You are the requirements module of an autonomous software engineering runtime. " +
  "You turn a user objective into concrete requirements and machine-checkable acceptance criteria. " +
  "You never write code and never run commands. Answer only with the requested structured data. " +
  "Every check must test the property in its description, not merely a nearby element. " +
  "A file_exists path must name a file, never the workspace directory. " +
  "Use no_console_errors for console errors, no_external_urls for source URL restrictions, " +
  "no_external_requests for runtime network restrictions, and no_horizontal_overflow for responsive layout. " +
  "A DOM selector must be a valid rendered CSS selector; never use @media, console, html/css/js, or other concepts " +
  "that are not elements. Use file_contains or a boolean DOM expression for CSS and source-code properties.";

export const SYSTEM_PLAN =
  "You are the planning module of an autonomous software engineering runtime. " +
  "You turn requirements into a short ordered list of implementation tasks. " +
  "Prefer few, substantial tasks over many trivial ones. Answer only with the requested structured data.";

export const HOST_COMMAND_GUIDANCE =
  process.platform === "win32"
    ? "Commands run on Windows PowerShell 5.1. Use PowerShell syntax such as Get-ChildItem -Force, Get-Content, Set-Location, and New-Item. Do not emit POSIX /d/... paths, ls -la, find, or &&. Prefer no setup command when dedicated runtime file operations are sufficient."
    : "Commands run in a POSIX sh/bash shell. Use POSIX paths and syntax. Prefer no setup command when dedicated runtime file operations are sufficient.";

export const SYSTEM_IMPLEMENT =
  "You are the implementation module of an autonomous software engineering runtime. " +
  "You write complete, working, production-quality code. The runtime applies your file changes verbatim, " +
  "so every file you emit must be complete and syntactically valid — never abbreviate with placeholders " +
  "or comments like 'rest of code here'. " +
  HOST_COMMAND_GUIDANCE +
  " Answer only with the requested structured data.";

export const SYSTEM_DIAGNOSE =
  "You are the diagnosis module of an autonomous software engineering runtime. " +
  "You are given real execution evidence from a failed verification: commands, exit codes, stderr, " +
  "console errors and failing acceptance criteria. Identify the root cause and emit a concrete fix. " +
  "Prefer the smallest change that genuinely fixes the cause rather than suppressing the symptom. " +
  HOST_COMMAND_GUIDANCE +
  " Answer only with the requested structured data.";

export const SYSTEM_JUDGE =
  "You are the adjudication module of an autonomous software engineering runtime. " +
  "You decide whether concrete supplied evidence satisfies one specific criterion. " +
  "Judge only the evidence given; if the evidence is insufficient, fail the criterion. " +
  "Answer only with the requested structured data.";

/** Flat criterion shape presented to the model. Narrowed by `narrowCheckSpec`. */
export const CRITERIA_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    requirements: {
      type: "array",
      description: "Concrete requirements implied by the objective, including reasonable defaults.",
      items: { type: "string" },
    },
    criteria: {
      type: "array",
      description: "Machine-checkable acceptance criteria. Prefer deterministic kinds over 'judge'.",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "Short stable id, e.g. AC1." },
          description: { type: "string" },
          required: { type: "boolean", description: "False only for genuinely optional polish." },
          kind: {
            type: "string",
            enum: [
              "file_exists",
              "files_exist",
              "file_contains",
              "no_external_urls",
              "command_succeeds",
              "http_ok",
              "dom",
              "no_console_errors",
              "no_external_requests",
              "no_horizontal_overflow",
              "judge",
            ],
          },
          path: { type: "string", description: "Workspace-relative path for file_exists/file_contains." },
          paths: {
            type: "array",
            items: { type: "string" },
            description: "File paths for files_exist; use one entry per required file.",
          },
          pattern: { type: "string", description: "Substring or regex for file_contains." },
          command: { type: "string", description: "Shell command for command_succeeds." },
          httpPath: { type: "string", description: "Path relative to the app root for http_ok, e.g. '/'." },
          selector: { type: "string", description: "CSS selector for dom checks." },
          minCount: { type: "integer", description: "Minimum visible matches for a dom selector." },
          textContains: { type: "string", description: "Text that must appear, for dom checks." },
          expression: {
            type: "string",
            description: "A boolean browser expression for dom checks when a selector is insufficient.",
          },
          waitForChangeMs: {
            type: "integer",
            description: "For live UI checks, require the selected element's text to change within this window.",
          },
          viewport: { type: "string", enum: ["mobile", "desktop"] },
          question: { type: "string", description: "Only for kind 'judge'." },
        },
        required: ["id", "description", "required", "kind"],
      },
    },
  },
  required: ["requirements", "criteria"],
};

export const PLAN_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          description: { type: "string", description: "What to implement, specific enough to act on." },
          satisfies: {
            type: "array",
            items: { type: "string" },
            description: "Acceptance criterion ids this task advances.",
          },
        },
        required: ["id", "description", "satisfies"],
      },
    },
  },
  required: ["tasks"],
};

/** Shared by implementation and repair: a set of file changes plus optional setup commands. */
export const CHANGESET_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    summary: { type: "string", description: "One sentence on what this change does." },
    files: {
      description: "Every write/edit entry must include complete content fields; never omit the file body.",
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative path." },
          action: { type: "string", enum: ["write", "edit", "delete"] },
          content: { type: "string", description: "Full file content for action 'write'." },
          oldText: { type: "string", description: "Exact existing text for action 'edit'." },
          newText: { type: "string", description: "Replacement text for action 'edit'." },
        },
        required: ["path", "action", "content", "oldText", "newText"],
      },
    },
    commands: {
      type: "array",
      description: "Setup commands to run, e.g. dependency installs. Omit when none are needed.",
      items: {
        type: "object",
        properties: {
          command: { type: "string" },
          why: { type: "string" },
        },
        required: ["command", "why"],
      },
    },
    startCommand: {
      type: "string",
      description: "Command that serves the app, if this project needs one. Omit for static sites.",
    },
  },
  required: ["summary", "files"],
};

export const DIAGNOSIS_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    rootCause: { type: "string", description: "The actual cause, not the symptom." },
    strategy: { type: "string", description: "How this fix differs from what was already tried." },
    confident: { type: "boolean", description: "False if you are guessing from insufficient evidence." },
    summary: { type: "string" },
    files: {
      description: "Every write/edit entry must include complete content fields; never omit the file body.",
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          action: { type: "string", enum: ["write", "edit", "delete"] },
          content: { type: "string" },
          oldText: { type: "string" },
          newText: { type: "string" },
        },
        required: ["path", "action", "content", "oldText", "newText"],
      },
    },
    commands: {
      type: "array",
      items: {
        type: "object",
        properties: { command: { type: "string" }, why: { type: "string" } },
        required: ["command", "why"],
      },
    },
  },
  required: ["rootCause", "strategy", "confident", "summary", "files"],
};

export const JUDGE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    passed: { type: "boolean" },
    reason: { type: "string" },
  },
  required: ["passed", "reason"],
};

export interface RawCriterion {
  id: string;
  description: string;
  required: boolean;
  kind: string;
  path?: string;
  paths?: string[];
  pattern?: string;
  command?: string;
  httpPath?: string;
  selector?: string;
  minCount?: number;
  textContains?: string;
  expression?: string;
  waitForChangeMs?: number;
  viewport?: string;
  question?: string;
}

function asViewport(value: string | undefined, fallback: ViewportName): ViewportName {
  return value === "mobile" || value === "desktop" ? value : fallback;
}

function containsAny(value: string, terms: readonly string[]): boolean {
  return terms.some((term) => value.includes(term));
}

function mediaQueryExpression(selector: string | undefined, description: string): string {
  const explicitQuery = selector?.startsWith("@media") ? selector.replace(/^@media\s*/iu, "").trim() : undefined;
  const describedQuery = description.match(/\(\s*max-width\s*:\s*[^)]+\)/iu)?.[0];
  const query = explicitQuery || describedQuery || "";
  const wanted = JSON.stringify(query.replace(/\s+/gu, " ").trim());
  return `(() => {
    const wanted = ${wanted};
    const normalize = (value) => value.replace(/\\s+/g, " ").trim();
    const visit = (rules) => Array.from(rules).some((rule) => {
      if (rule.type === 4 && normalize(rule.conditionText || "").includes(normalize(wanted))) return true;
      return rule.cssRules ? visit(rule.cssRules) : false;
    });
    return Array.from(document.styleSheets).some((sheet) => {
      try { return visit(sheet.cssRules); } catch { return false; }
    });
  })()`;
}

function darkInterfaceExpression(): string {
  return `(() => {
    const rgb = (value) => {
      const numbers = value.match(/\\d+(?:\\.\\d+)?/g)?.slice(0, 3).map(Number) || [];
      return numbers.length === 3 ? (299 * numbers[0] + 587 * numbers[1] + 114 * numbers[2]) / 1000 : null;
    };
    const body = getComputedStyle(document.body);
    const root = getComputedStyle(document.documentElement);
    const background = [rgb(body.backgroundColor), rgb(root.backgroundColor)].some((value) => value !== null && value < 128);
    const foreground = rgb(body.color);
    return background && foreground !== null && foreground > 160;
  })()`;
}

function fileNamesFromDescription(description: string): string[] {
  const matches =
    description.match(/\b[a-zA-Z0-9_./-]+\.(?:html?|css|scss|sass|less|js|jsx|mjs|cjs|ts|tsx|json)\b/gu) ?? [];
  return [...new Set(matches.map((value) => value.replace(/^['"`]|['"`.,;:]$/gu, "")))];
}

function displaySelector(selector: string | undefined, description: string): string | undefined {
  const lower = description.toLowerCase();
  const alternatives = containsAny(lower, ["weekday", "day of week"])
    ? ["#clock-weekday", "#weekday_display", "#weekday", ".weekday", "#clock-date", "#date_display", "#date", ".date"]
    : containsAny(lower, ["date display", "date element", "date string"])
      ? ["#clock-date", "#date_display", "#date", ".date"]
      : containsAny(lower, ["time display", "clock display", "clock-time", "hh:mm:ss"])
        ? ["#clock-time", "#clock", "#time", ".clock", ".time"]
        : [];
  if (alternatives.length === 0) return selector;
  return [...new Set([selector, ...alternatives].filter((value): value is string => Boolean(value)))].join(", ");
}

function displayExpression(selector: string | undefined, description: string): string | undefined {
  if (!selector) return undefined;
  const lower = description.toLowerCase();
  const target = JSON.stringify(selector);
  if (containsAny(lower, ["hh:mm:ss", "two digits", "time display"])) {
    return `Array.from(document.querySelectorAll(${target})).some((element) => /^\\d{2}:\\d{2}:\\d{2}$/.test(element.textContent?.trim() || ""))`;
  }
  if (containsAny(lower, ["weekday", "day of week"])) {
    return `Array.from(document.querySelectorAll(${target})).some((element) => /\\b(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\\b/i.test(element.textContent || ""))`;
  }
  if (containsAny(lower, ["month name", "date string", "date display"])) {
    return `Array.from(document.querySelectorAll(${target})).some((element) => /\\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\\b/i.test(element.textContent || "") && /\\d/.test(element.textContent || ""))`;
  }
  return undefined;
}

/**
 * Convert a model-supplied flat criterion into a strict CheckSpec.
 * Returns null when required fields for the declared kind are missing, so a malformed
 * criterion is dropped rather than silently becoming a check that always passes.
 */
export function narrowCheckSpec(raw: RawCriterion): CheckSpec | null {
  switch (raw.kind) {
    case "file_exists":
      return raw.path ? { kind: "file_exists", path: raw.path } : null;
    case "files_exist":
      return raw.paths && raw.paths.length > 0 ? { kind: "files_exist", paths: raw.paths } : null;
    case "file_contains": {
      const description = raw.description.toLowerCase();
      if (
        containsAny(description, ["dark interface", "dark theme", "dark background", "background color must be dark"])
      ) {
        return {
          kind: "dom",
          viewport: "desktop",
          assertion: {
            description: raw.description,
            selector: "body",
            minCount: 1,
            expression: darkInterfaceExpression(),
          },
        };
      }
      return raw.path && raw.pattern ? { kind: "file_contains", path: raw.path, pattern: raw.pattern } : null;
    }
    case "no_external_urls":
      return { kind: "no_external_urls", ...(raw.paths && raw.paths.length > 0 ? { paths: raw.paths } : {}) };
    case "command_succeeds":
      return raw.command ? { kind: "command_succeeds", command: raw.command } : null;
    case "http_ok":
      return { kind: "http_ok", path: raw.httpPath ?? "/" };
    case "dom": {
      const description = raw.description.toLowerCase();
      const selector = raw.selector?.trim();
      if (containsAny(description, ["console error", "console errors", "no console"])) {
        return { kind: "no_console_errors" };
      }
      if (containsAny(description, ["external url", "external urls", "external dependency", "third-party"])) {
        return { kind: "no_external_urls" };
      }
      if (containsAny(description, ["external request", "external network", "network request"])) {
        return { kind: "no_external_requests" };
      }
      if (selector?.startsWith("@media") || description.includes("media query")) {
        return {
          kind: "dom",
          viewport: asViewport(raw.viewport, "desktop"),
          assertion: {
            description: raw.description,
            expression: mediaQueryExpression(selector, raw.description),
          },
        };
      }
      if (
        !description.includes("viewport meta") &&
        containsAny(description, ["horizontal overflow", "responsive", "mobile viewport"])
      ) {
        return { kind: "no_horizontal_overflow", viewport: asViewport(raw.viewport, "mobile") };
      }
      if (
        containsAny(description, ["dark interface", "dark theme", "dark background", "background color must be dark"])
      ) {
        return {
          kind: "dom",
          viewport: asViewport(raw.viewport, "desktop"),
          assertion: {
            description: raw.description,
            selector: selector || "body",
            minCount: 1,
            expression: darkInterfaceExpression(),
          },
        };
      }
      const dynamic = containsAny(description, ["update every second", "updates every second", "each second"]);
      const effectiveSelector = displaySelector(selector, raw.description);
      if (!effectiveSelector && !raw.textContains && !raw.expression) return null;
      const generatedExpression = displayExpression(effectiveSelector, raw.description);
      return {
        kind: "dom",
        viewport: asViewport(raw.viewport, "desktop"),
        assertion: {
          description: raw.description,
          selector: effectiveSelector,
          minCount: raw.minCount ?? (effectiveSelector ? 1 : undefined),
          // Models often put a regular expression or a pipe-separated list in
          // textContains even though the browser assertion is a literal
          // substring check. The host-generated semantic expression is stronger
          // and prevents that malformed hint from masking a valid element.
          textContains: generatedExpression && !raw.expression ? undefined : raw.textContains,
          expression: raw.expression ?? generatedExpression,
          waitForChangeMs: raw.waitForChangeMs ?? (dynamic && effectiveSelector ? 1_500 : undefined),
        },
      };
    }
    case "no_console_errors":
      return { kind: "no_console_errors" };
    case "no_external_requests":
      return { kind: "no_external_requests" };
    case "no_horizontal_overflow":
      return { kind: "no_horizontal_overflow", viewport: asViewport(raw.viewport, "mobile") };
    case "judge":
      return raw.question ? { kind: "judge", question: raw.question } : null;
    default:
      return null;
  }
}

export function narrowCriteria(raws: RawCriterion[]): AcceptanceCriterion[] {
  const seen = new Set<string>();
  const out: AcceptanceCriterion[] = [];
  for (const raw of raws) {
    const describedFiles = raw.kind === "file_exists" ? fileNamesFromDescription(raw.description) : [];
    const check =
      describedFiles.length >= 2
        ? ({ kind: "files_exist", paths: describedFiles } satisfies CheckSpec)
        : narrowCheckSpec(raw);
    if (!check) continue;
    let id = raw.id?.trim() || `AC${out.length + 1}`;
    while (seen.has(id)) id = `${id}_`;
    seen.add(id);
    out.push({ id, description: raw.description, check, required: raw.required !== false });
  }
  return out;
}
