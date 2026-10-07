import { getEffectiveReasoningEffort, getSupportedReasoningEfforts, normalizeModelId } from "../models/catalog";
import type { ModelInfo, ReasoningEffort } from "../types/index";
import { SectionBadge } from "./components/badge";
import {
  AUTO_FREE_ID,
  capabilityWords,
  describeFreeSources,
  formatProviderTabs,
  HEADER_ROW_LINES,
  MODEL_ROW_LINES,
  type PickerMode,
  type ProviderTab,
  pickerItems,
  priceLabel,
  windowItems,
} from "./model-picker-data";
import type { Theme } from "./theme";

export interface ModelPickerProps {
  t: Theme;
  currentModel: string;
  /** Index in `models` of the highlighted model. */
  selectedIndex: number;
  width: number;
  height: number;
  searchQuery: string;
  /** The models to list, already filtered and ordered (`pickerModels`). */
  models: readonly ModelInfo[];
  /** Everything the catalog holds, for the line saying where Free mode's routes come from. */
  allModels: readonly ModelInfo[];
  mode: PickerMode;
  providerName: (providerId: string) => string;
  /** The provider tabs ("All" first) with what the search finds in each, and the one chosen ("" is All). */
  providerTabs?: readonly ProviderTab[];
  activeProvider?: string;
  /** Nothing matched exactly, so the list shows the closest names. */
  fuzzy?: boolean;
  /** How many models the catalog holds, for "12 of 312". */
  totalModels?: number;
  reasoningEffortByModel: Record<string, ReasoningEffort>;
  switching: boolean;
  error: string | null;
}

function priceColor(t: Theme, model: ModelInfo): string {
  if (model.freeStatus === "free") return t.accent;
  if (model.freeStatus === "paid") return t.warning;
  return t.textDim;
}

/**
 * The key hints on one line: when they do not fit, the least needed ones go (the page keys first, then the reasoning
 * keys), so the line never ends in a cut word.
 */
function fitHints(parts: readonly string[], room: number): string {
  const drop = ["pgup/pgdn jump", "left/right reasoning", "up/down move"];
  let kept = parts.filter(Boolean);
  const join = (list: readonly string[]) => list.join("  ");
  for (const name of drop) {
    if (join(kept).length <= room) break;
    kept = kept.filter((part) => part !== name);
  }
  return clip(join(kept), room);
}

/** Fits `text` in `room` cells, ending in an ellipsis when it must be cut. */
function clip(text: string, room: number): string {
  return text.length > room ? `${text.slice(0, Math.max(1, room - 1))}…` : text;
}

/**
 * /models. Free mode is automatic, so it shows Auto Free and where its routes come from; Mixed lists the models of
 * every provider under the provider's name, searchable by provider, model and capability. Only the rows that fit are
 * drawn, so a catalog of thousands costs the same as one of ten.
 */
export function ModelPickerModal({
  t,
  currentModel,
  selectedIndex,
  width,
  height,
  searchQuery,
  models,
  allModels,
  mode,
  providerName,
  providerTabs = [],
  activeProvider = "",
  fuzzy = false,
  totalModels,
  reasoningEffortByModel,
  switching,
  error,
}: ModelPickerProps) {
  const panelWidth = Math.max(40, Math.min(76, width - 4));
  const room = panelWidth - 6;
  const selected = models[selectedIndex];
  const supportsReasoning = !!selected && getSupportedReasoningEfforts(selected.id).length > 0;

  const infoLines =
    mode === "free"
      ? [
          "Free mode chooses the best free model for each request, from every provider you set up.",
          `Free routes: ${describeFreeSources(allModels, providerName)}`,
          "ctrl+f switches to Mixed to pick a model yourself.",
        ]
      : [];
  const items = pickerItems(models, providerName);
  const listLines = items.reduce((sum, item) => sum + (item.kind === "header" ? HEADER_ROW_LINES : MODEL_ROW_LINES), 0);
  const activeProblem = providerTabs.find((tab) => tab.id === activeProvider && tab.problem !== undefined);
  const activeWarning = providerTabs.find((tab) => tab.id === activeProvider && tab.warning !== undefined);
  // With a single provider the row would read like a label: say where the others come from.
  const oneProvider = providerTabs.length === 2;
  // The provider tabs (a row), a note under them when the list is not exact, and the blank line after, in Mixed only.
  const showTabs = mode !== "free" && providerTabs.length > 1;
  const warningLine = activeWarning !== undefined && mode !== "free";
  const tabLines = (showTabs ? 1 : 0) + (warningLine ? 1 : 0) + (fuzzy ? 1 : 0) + (showTabs || fuzzy ? 1 : 0);
  // Borders, the title, the search box and its gaps, the key hints and the error line when there is one.
  const chrome = 8 + (error ? 1 : 0) + infoLines.length + (infoLines.length > 0 ? 1 : 0) + tabLines;
  const panelHeight = Math.max(chrome + 3, Math.min(Math.max(listLines, 2) + chrome, Math.floor(height * 0.85)));
  const capacity = Math.max(2, panelHeight - chrome);
  const selectedKey = selected ? `model-${selected.id}` : undefined;
  const first = windowItems(items, selectedKey, capacity);
  // The "more" marks take a row each, so a window that overflows is taken again with room for them.
  const view = first.above > 0 || first.below > 0 ? windowItems(items, selectedKey, Math.max(2, capacity - 2)) : first;
  const top = Math.max(1, Math.floor((height - panelHeight) / 2));
  const modeLabel = mode === "free" ? "Free · Auto" : mode === "mixed" ? "Mixed" : "";
  const count = models.filter((model) => model.id !== AUTO_FREE_ID).length;
  const narrowed = Boolean(searchQuery) || activeProvider !== "";
  const countLabel = narrowed && totalModels !== undefined ? `${count} of ${totalModels}` : `${count}`;

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={width}
      height={height}
      alignItems="center"
      paddingTop={top}
      backgroundColor={t.overlay}
    >
      <box
        width={panelWidth}
        height={panelHeight}
        backgroundColor={t.background}
        border={["top", "right", "bottom", "left"]}
        borderStyle="single"
        borderColor={t.border}
        flexDirection="column"
      >
        <box flexShrink={0} flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2}>
          <SectionBadge
            t={t}
            label="Models"
            detail={[modeLabel, mode === "free" ? "" : countLabel].filter(Boolean).join(" · ")}
          />
          <text fg={t.textMuted}>{"esc"}</text>
        </box>
        <box flexShrink={0} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
          <text fg={t.text} wrapMode="none">
            {searchQuery ? (
              clip(searchQuery, room)
            ) : (
              <span style={{ fg: t.textMuted }}>
                {mode === "free" ? "Search..." : "Search a model, or @provider free paid tools vision ctx>100k"}
              </span>
            )}
          </text>
        </box>
        {showTabs ? (
          <box flexShrink={0} paddingLeft={2} paddingRight={2} paddingBottom={fuzzy || warningLine ? 0 : 1}>
            <text fg={t.textMuted} wrapMode="none">
              {oneProvider
                ? clip(`${formatProviderTabs(providerTabs, activeProvider, room)}   more providers: /config`, room)
                : formatProviderTabs(providerTabs, activeProvider, room)}
            </text>
          </box>
        ) : null}
        {warningLine ? (
          <box flexShrink={0} paddingLeft={2} paddingRight={2}>
            <text fg={t.warning} wrapMode="none">
              {clip(
                `! ${activeWarning?.label}: last refresh failed (${activeWarning?.warning}); showing its last list`,
                room,
              )}
            </text>
          </box>
        ) : null}
        {fuzzy ? (
          <box flexShrink={0} paddingLeft={2} paddingRight={2} paddingBottom={1}>
            <text fg={t.warning} wrapMode="none">
              {clip("No exact match: showing the closest names", room)}
            </text>
          </box>
        ) : null}
        {infoLines.length > 0 ? (
          <box flexShrink={0} flexDirection="column" paddingLeft={2} paddingRight={2} paddingBottom={1}>
            {infoLines.map((line) => (
              <text key={line} fg={t.textMuted} wrapMode="none">
                {clip(line, room)}
              </text>
            ))}
          </box>
        ) : null}
        <box flexGrow={1} minHeight={0} flexDirection="column">
          {view.above > 0 ? (
            <box paddingLeft={2}>
              <text fg={t.textDim} wrapMode="none">{`${view.above} more above`}</text>
            </box>
          ) : null}
          {view.items.map((item) => {
            if (item.kind === "header") {
              return (
                <box key={item.key} paddingLeft={2} paddingRight={2} width="100%">
                  <text fg={t.textMuted} wrapMode="none">{`${item.label} · ${item.count}`}</text>
                </box>
              );
            }
            const model = item.model;
            const isSelected = model.id === selected?.id;
            const current = normalizeModelId(model.id) === normalizeModelId(currentModel);
            const efforts = getSupportedReasoningEfforts(model.id);
            const effort =
              getEffectiveReasoningEffort(model.id, reasoningEffortByModel[normalizeModelId(model.id)]) ?? "auto";
            const tag = efforts.length > 0 ? `[${effort}]` : "";
            const provider = model.id === AUTO_FREE_ID || mode === "mixed" ? "" : providerName(model.provider ?? "");
            const meta = [
              priceLabel(model),
              model.category === "local" ? undefined : `${Math.round(model.contextWindow / 1_000)}K ctx`,
              capabilityWords(model).join(", ") || undefined,
            ]
              .filter(Boolean)
              .join(" · ");
            const nameRoom = Math.max(8, room - tag.length - provider.length - 3);
            return (
              <box
                key={item.key}
                backgroundColor={isSelected ? t.selectedBg : undefined}
                paddingLeft={2}
                paddingRight={2}
                width="100%"
              >
                <box width="100%" flexDirection="column">
                  <box width="100%" flexDirection="row" justifyContent="space-between">
                    <text fg={current ? t.accent : isSelected ? t.selected : t.text} wrapMode="none">
                      {`${current ? "● " : ""}${clip(model.name.replace(/^[^:]+:\s+/u, ""), nameRoom - (current ? 2 : 0))}`}
                    </text>
                    <text fg={isSelected ? t.primary : t.textMuted} wrapMode="none">
                      {[provider, tag].filter(Boolean).join(" ")}
                    </text>
                  </box>
                  <text fg={isSelected ? priceColor(t, model) : t.textDim} wrapMode="none">
                    {clip(meta, room)}
                  </text>
                </box>
              </box>
            );
          })}
          {view.below > 0 ? (
            <box paddingLeft={2}>
              <text fg={t.textDim} wrapMode="none">{`${view.below} more below`}</text>
            </box>
          ) : null}
          {models.length === 0 && activeProblem ? (
            <box paddingLeft={2} paddingRight={2} flexDirection="column">
              <text fg={t.warning} wrapMode="word">
                {`${activeProblem.label} is set up but lists no models: ${activeProblem.problem}`}
              </text>
              <text fg={t.textDim} wrapMode="none">
                {clip("tab moves on; it is checked again every few minutes", room)}
              </text>
            </box>
          ) : null}
          {models.length === 0 && !activeProblem ? (
            <box paddingLeft={2} paddingRight={2} flexDirection="column">
              <text fg={t.textMuted} wrapMode="none">
                {clip(searchQuery ? `No models match "${searchQuery}"` : "No models to list", room)}
              </text>
              {mode !== "free" ? (
                <text fg={t.textDim} wrapMode="none">
                  {clip(
                    activeProvider !== ""
                      ? "tab searches every provider; try fewer words or -word to exclude"
                      : "try @provider, free, paid, tools, vision, ctx>100k or fewer words",
                    room,
                  )}
                </text>
              ) : null}
            </box>
          ) : null}
        </box>
        <box flexShrink={0} paddingLeft={2} paddingRight={2} paddingTop={1}>
          {error ? <text fg={t.diffRemovedFg}>{error}</text> : null}
          <text fg={switching ? t.accent : t.textMuted} wrapMode="none">
            {switching
              ? "Preparing model..."
              : fitHints(
                  [
                    mode === "free" ? "" : "tab provider",
                    supportsReasoning ? "left/right reasoning" : "",
                    "up/down move",
                    "pgup/pgdn jump",
                    "enter select",
                    "esc close",
                  ],
                  room,
                )}
          </text>
        </box>
      </box>
    </box>
  );
}
