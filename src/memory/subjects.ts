import type { MemoryRecord, MemorySource, MemorySubject } from "./types";

/** No alias, language or environment equivalence is guessed. These are opaque declared names. */
export function normalizeMemorySubject(value: unknown): MemorySubject | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid memory subject.");
  const input = value as { entity?: unknown; environment?: unknown };
  const name = (value: unknown, limit: number): string => {
    if (typeof value !== "string" || !value.trim() || value.length > limit || /\p{Cc}/u.test(value))
      throw new Error("Invalid memory subject name.");
    const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
    if (normalized.length > limit) throw new Error("Invalid memory subject name.");
    return normalized;
  };
  return {
    entity: name(input.entity, 80),
    ...(input.environment !== undefined ? { environment: name(input.environment, 40) } : {}),
  };
}

const USE_STATEMENT =
  /^(?:we use|this project uses|the project uses|usamos|el proyecto usa|en este proyecto usamos|(?:please )?use|(?:por favor )?(?:usa|utiliza)|we (?:moved|migrated|switched)|migramos|we (?:don't|do not|no longer) use|ya no usamos|dejamos de usar)\b/iu;
const COMPONENT_STATEMENT = /^([\p{L}\p{N}_./-]+(?:\s+[\p{L}\p{N}_./-]+){0,3})\s+(?:uses|usa)\s+.+$/iu;
const QUALIFIER = /\s+(?:for|para)\s+(.+)$/iu;
const COMPOUND = /\b(?:and|or|y|o|except|excepto)\b|[,;:?!]/iu;
const DECLARED_NAME = /^[\p{L}\p{N}_./-]+(?:\s+[\p{L}\p{N}_./-]+){0,3}$/u;

/** Small explicit grammar only; unknown/compound prose is not assigned to an invented component. */
export function subjectFromStatement(statement: string): MemorySubject | undefined {
  const text = statement.trim().replace(/[.!]+$/u, "");
  let qualifier: string | undefined;
  if (USE_STATEMENT.test(text)) qualifier = QUALIFIER.exec(text)?.[1];
  else qualifier = COMPONENT_STATEMENT.exec(text)?.[1];
  if (!qualifier || COMPOUND.test(qualifier)) return undefined;
  const parts = qualifier.split(/\s+(?:in|en)\s+/iu);
  if (parts.length > 2 || !parts.every((part) => DECLARED_NAME.test(part))) return undefined;
  try {
    return normalizeMemorySubject({ entity: parts[0], ...(parts[1] ? { environment: parts[1] } : {}) });
  } catch {
    return undefined;
  }
}

export function subjectFor(input: {
  subject?: MemorySubject;
  hook: string;
  source?: MemorySource;
}): MemorySubject | undefined {
  const declared = subjectFromStatement(input.hook);
  // Human provenance must come from the user's words, not a model's subject attached to a valid quote.
  if (input.source === "human" && declared) return declared;
  const provided = normalizeMemorySubject(input.subject);
  if (provided && declared && !sameSubject(provided, declared))
    throw new Error("Memory subject contradicts its statement.");
  return provided ?? declared;
}

export function recordSubject(record: MemoryRecord): MemorySubject | undefined {
  return normalizeMemorySubject(record.entry.frontmatter.metadata.subject) ?? subjectFromStatement(record.index.hook);
}

/** Two unknown legacy scopes preserve their old compatibility; known and unknown never silently merge. */
export function sameSubject(a: MemorySubject | undefined, b: MemorySubject | undefined): boolean {
  return a?.entity === b?.entity && a?.environment === b?.environment;
}

export function memorySubjectNote(meta: {
  subject?: MemorySubject;
  conflictsWith?: string[];
  conflictCount?: number;
}): string {
  const scope = meta.subject
    ? `subject: ${meta.subject.entity}${meta.subject.environment ? ` in ${meta.subject.environment}` : ""}`
    : "";
  const conflicts = meta.conflictsWith ?? [];
  const count = Math.max(meta.conflictCount ?? 0, conflicts.length);
  const conflict =
    count > 0
      ? `UNRESOLVED MEMORY CONFLICT with ${conflicts.slice(0, 3).join(", ")}${count > 3 ? ` and ${count - 3} more (memory_list)` : ""}; verify scope and current sources before relying on either claim`
      : "";
  return [scope, conflict].filter(Boolean).join("; ");
}
