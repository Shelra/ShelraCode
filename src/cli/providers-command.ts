import type { CatalogEntry } from "../models/types";
import type { ProviderRegistry } from "../providers/registry";
import { loadFreeAttestations, setFreeModelPatterns, setFreePlanProvider } from "../routing/attestations";
import type { ProviderCatalogStatus } from "../routing/catalog-service";
import { classifyFreeEligibility, type FreeAttestations } from "../routing/eligibility";
import { loadUserSettings } from "../utils/settings";

/** The provider status table, `allow-free` and `deny-free`, and the unified model listing. Pure where it can be. */

export interface ProviderRow {
  providerId: string;
  name: string;
  status: "connected" | "stale" | "unreachable" | "loading" | "not set up";
  models: number | null;
  /** Models Free mode may run now. */
  freeNow: number | null;
  note: string;
}

const STATUS_LABEL: Record<ProviderCatalogStatus["status"], ProviderRow["status"]> = {
  ready: "connected",
  stale: "stale",
  unavailable: "unreachable",
  loading: "loading",
  unconfigured: "not set up",
};

/** One row per provider from the catalog's status, the registry and what the user declared. */
export function buildProviderRows(
  registry: ProviderRegistry,
  statuses: readonly ProviderCatalogStatus[],
  entries: readonly CatalogEntry[],
  attestations: FreeAttestations,
): ProviderRow[] {
  return statuses.map((status) => {
    const definition = registry.get(status.providerId);
    const own = entries.filter((entry) => entry.provider === status.providerId);
    const verdicts = own.map((entry) => classifyFreeEligibility(entry, attestations));
    const freeNow = verdicts.filter((verdict) => verdict.eligible).length;
    const needsDeclaration = verdicts.filter((verdict) => verdict.level === "free-tier" && !verdict.eligible).length;
    const unproven = verdicts.filter((verdict) => verdict.level === "unknown").length;
    let note = "";
    if (status.status === "unconfigured") note = definition ? `${definition.setupHint}` : "";
    else if (status.error) note = status.error;
    else if (needsDeclaration > 0) {
      note = `${needsDeclaration} model(s) are on a free plan Shelra cannot see the billing of: \`shelra providers allow-free ${status.providerId}\` if your key has none`;
    } else if (unproven > 0 && definition?.freePlan === undefined) {
      note = `${unproven} model(s) have no proven price: \`shelra providers allow-free ${status.providerId} <model pattern>\` for the ones you know are free`;
    }
    const configured = status.status !== "unconfigured";
    return {
      providerId: status.providerId,
      name: status.name,
      status: STATUS_LABEL[status.status],
      models: configured && own.length > 0 ? own.length : null,
      freeNow: configured && own.length > 0 ? freeNow : null,
      note,
    };
  });
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

export function formatProviderTable(rows: readonly ProviderRow[]): string {
  const header = ["Provider", "Status", "Models", "Free mode", "Notes"];
  const body = rows.map((row) => [
    row.name,
    row.status,
    row.models === null ? "—" : String(row.models),
    row.freeNow === null ? "—" : String(row.freeNow),
    row.note,
  ]);
  const widths = header.map((title, column) =>
    Math.max(title.length, ...body.map((line) => (line[column] ?? "").length)),
  );
  const render = (cells: readonly string[]) =>
    cells
      .map((cell, column) => (column === cells.length - 1 ? cell : pad(cell, widths[column] ?? 0)))
      .join("  ")
      .trimEnd();
  return [render(header), ...body.map(render)].join("\n");
}

export interface DeclareResult {
  ok: boolean;
  message: string;
}

const MIN_PATTERN_PREFIX = 3;

/** A pattern that names a family of models, never "everything": a bare wildcard would vouch for a gateway's paid ones. */
export function validateFreePattern(pattern: string): string | null {
  const trimmed = pattern.trim();
  if (!trimmed) return "an empty pattern";
  const stem = trimmed.endsWith("*") ? trimmed.slice(0, -1) : trimmed;
  if (stem.includes("*")) return `"${trimmed}": a * may only end a pattern`;
  if (trimmed.endsWith("*") && stem.length < MIN_PATTERN_PREFIX) {
    return `"${trimmed}" would vouch for too many models; name the family (for example opencode-free/*)`;
  }
  return null;
}

/**
 * Declares what Shelra cannot see: that a provider's key has no billing, or that named models are free. Nothing here
 * makes a model free; it records who said so, and `classifyFreeEligibility` still refuses anything priced above zero
 * and every routing alias.
 */
export function allowFree(
  registry: ProviderRegistry,
  providerId: string,
  patterns: readonly string[],
  deps: {
    setPlan: typeof setFreePlanProvider;
    setPatterns: typeof setFreeModelPatterns;
    attestations: () => FreeAttestations;
  } = {
    setPlan: setFreePlanProvider,
    setPatterns: setFreeModelPatterns,
    attestations: () => loadFreeAttestations(loadUserSettings()),
  },
): DeclareResult {
  const id = providerId.trim().toLowerCase();
  const definition = registry.get(id);
  if (!definition)
    return {
      ok: false,
      message: `Unknown provider "${providerId}". Use one of: ${registry
        .list()
        .map((d) => d.id)
        .join(", ")}.`,
    };
  if (definition.selfEnforcing) {
    return {
      ok: true,
      message: `${definition.name}'s free models are known from its own prices; there is nothing to declare.`,
    };
  }
  if (patterns.length > 0) {
    const problem = patterns.map(validateFreePattern).find((issue) => issue !== null);
    if (problem) return { ok: false, message: `Not saved: ${problem}.` };
    const existing = deps.attestations().freeModelPatterns[id] ?? [];
    const merged = [...new Set([...existing, ...patterns.map((pattern) => pattern.trim())])];
    deps.setPatterns(id, merged);
    return {
      ok: true,
      message: `Free mode may now run ${definition.name} models matching ${merged.join(", ")}. A model priced above zero or a routing alias is still refused.`,
    };
  }
  if (!definition.freePlan) {
    return {
      ok: false,
      message: `${definition.name} has no free plan of its own, so there is nothing to declare for it as a whole. Name the models you know are free: shelra providers allow-free ${id} '<provider>/<model>*'.`,
    };
  }
  deps.setPlan(id, true);
  const terms = [definition.freePlan.plan, definition.freePlan.privacy].filter(Boolean).join("; ");
  return {
    ok: true,
    message: `Recorded: your ${definition.name} key has no billing. Free mode may now use its free-plan models (${terms}). Withdraw it with \`shelra providers deny-free ${id}\`.`,
  };
}

export function denyFree(
  registry: ProviderRegistry,
  providerId: string,
  deps: { setPlan: typeof setFreePlanProvider; setPatterns: typeof setFreeModelPatterns } = {
    setPlan: setFreePlanProvider,
    setPatterns: setFreeModelPatterns,
  },
): DeclareResult {
  const id = providerId.trim().toLowerCase();
  const definition = registry.get(id);
  if (!definition) return { ok: false, message: `Unknown provider "${providerId}".` };
  deps.setPlan(id, false);
  deps.setPatterns(id, []);
  return { ok: true, message: `Free mode no longer uses ${definition.name}'s free-plan or vouched models.` };
}

function formatContext(tokens: number): string {
  return tokens >= 1_000_000 ? `${(tokens / 1_000_000).toFixed(1)}M` : `${Math.round(tokens / 1_000)}K`;
}

/** The unified catalog as text: grouped by provider, each model with what it costs and what it can do. */
export function formatModelCatalog(
  registry: ProviderRegistry,
  entries: readonly CatalogEntry[],
  attestations: FreeAttestations,
  limitPerProvider = 40,
): string {
  const lines: string[] = [];
  for (const definition of registry.list()) {
    const own = entries.filter((entry) => entry.provider === definition.id);
    if (own.length === 0) continue;
    const ranked = [...own].sort((a, b) => {
      const aFree = classifyFreeEligibility(a, attestations).eligible;
      const bFree = classifyFreeEligibility(b, attestations).eligible;
      return Number(bFree) - Number(aFree) || a.name.localeCompare(b.name);
    });
    lines.push(`  ${definition.name.toUpperCase()} (${own.length} models):`);
    for (const entry of ranked.slice(0, limitPerProvider)) {
      const verdict = classifyFreeEligibility(entry, attestations);
      const price = verdict.eligible
        ? "free"
        : verdict.level === "paid"
          ? entry.cost.pricingKnown === false || (entry.cost.prompt === 0 && entry.cost.completion === 0)
            ? "paid (router)"
            : `$${(entry.cost.prompt * 1_000_000).toFixed(2)}/M in`
          : verdict.level === "free-tier"
            ? "free plan (not declared)"
            : "price unknown";
      const capabilities = [
        entry.capabilities.tools ? "tools" : undefined,
        entry.capabilities.reasoning ? "reasoning" : undefined,
        entry.capabilities.vision ? "vision" : undefined,
      ]
        .filter(Boolean)
        .join(", ");
      lines.push(
        `    ${entry.id} - ${entry.name} (${price}, ${formatContext(entry.contextWindow)} context${capabilities ? `, ${capabilities}` : ""})`,
      );
    }
    if (ranked.length > limitPerProvider) {
      lines.push(`    ... and ${ranked.length - limitPerProvider} more; use --json for the full catalog`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
