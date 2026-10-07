/**
 * Turning a skill or an agent on or off without editing its file: an override in the person's local settings
 * (`.shelra/settings.local.json`). One service for the model's tool and the person's commands, with one difference of
 * authority: a model may restrict, and lift only a restriction that sits in that same local file; a person may do both.
 */
import { join } from "node:path";
import { getAgent, invalidateAgents } from "./agents";
import { ensureGitignored } from "./instructions";
import { effectiveOverride, invalidateSettingsCache, layerPath, readAllLayers, type SettingsLayer } from "./settings";
import { getSkill, invalidateSkills } from "./skills";
import { contentHash, readTextIfExists, writeDefinition } from "./store";

export type OverrideValue = "on" | "explicit" | "off";

export type OverrideOutcome =
  | {
      ok: true;
      kind: "skill" | "agent";
      name: string;
      requested: OverrideValue;
      effective: string;
      file: string;
      hash: string;
      snapshot: string | null;
      appliesFrom: string;
    }
  | { ok: false; reason: string };

export function setOverride(
  root: string,
  kind: "skill" | "agent",
  name: string,
  value: OverrideValue,
  by: "model" | "person",
): OverrideOutcome {
  if (kind === "agent" && value === "explicit") return { ok: false, reason: "agents are on or off" };
  const exists = kind === "skill" ? getSkill(root, name) !== undefined : getAgent(root, name) !== undefined;
  if (!exists) return { ok: false, reason: `No ${kind} named "${name}".` };
  const key = kind === "skill" ? "skillOverrides" : "agentOverrides";
  const layers = readAllLayers(root);
  if (value === "on" && by === "model") {
    // Relaxing is allowed only when nothing outside the local file restricts it: the person's own `off` stands.
    const outside = (["project", "user"] as SettingsLayer[])
      .map((layer) => (layers[layer].data[key] as Record<string, string> | undefined)?.[name])
      .find((entry) => entry === "off" || entry === "explicit");
    if (outside)
      return {
        ok: false,
        reason: `"${name}" is restricted in the project or user settings (${outside}); only the person can lift that.`,
      };
  }
  const path = layerPath("local", root);
  const text = readTextIfExists(path);
  let json: Record<string, unknown> = {};
  if (text !== null) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) json = parsed as Record<string, unknown>;
      else return { ok: false, reason: `${path} is not a JSON object` };
    } catch {
      return { ok: false, reason: `${path} is not valid JSON; fix it first` };
    }
  }
  const table = { ...((json[key] as Record<string, string> | undefined) ?? {}) };
  if (value === "on") delete table[name];
  else table[name] = value;
  const written = writeDefinition({
    path,
    content: `${JSON.stringify({ ...json, [key]: table }, null, 2)}\n`,
    kind: "rule",
    name: "settings.local",
    scopeDir: join(root, ".shelra"),
    ...(text !== null ? { expectedHash: contentHash(text) } : {}),
  });
  if (!written.ok) return { ok: false, reason: written.reason };
  // The local file is the person's own: it must not be committed.
  ensureGitignored(root, ".shelra/settings.local.json");
  invalidateSettingsCache();
  invalidateSkills(root);
  invalidateAgents(root);
  const effective = effectiveOverride(
    readAllLayers(root),
    key,
    name,
    kind === "skill" ? ["on", "explicit", "off"] : ["on", "off"],
  );
  return {
    ok: true,
    kind,
    name,
    requested: value,
    effective: effective.value ?? "on",
    file: path,
    hash: written.hash,
    snapshot: written.snapshot,
    appliesFrom: "now: the registry reads settings on its next lookup",
  };
}
