import { getEffectiveReasoningEffort, getSupportedReasoningEfforts, normalizeModelId } from "../models/catalog";
import type { ModelInfo, ReasoningEffort } from "../types/index";
import { SectionBadge } from "./components/badge";
import {
  AUTO_FREE_ID,
  capabilityWords,
  describeFreeSources,
  HEADER_ROW_LINES,
  MODEL_ROW_LINES,
  type PickerMode,
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
  reasoningEffortByModel: Record<string, ReasoningEffort>;
  switching: boolean;
  error: string | null;
}

function priceColor(t: Theme, model: ModelInfo): string {
  if (model.freeStatus === "free") return t.accent;
  if (model.freeStatus === "paid") return t.warning;
  return t.textDim;
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
  // Borders, the title, the search box and its gaps, the key hints and the error line when there is one.
  const chrome = 8 + (error ? 1 : 0) + infoLines.length + (infoLines.length > 0 ? 1 : 0);
  const panelHeight = Math.max(chrome + 3, Math.min(Math.max(listLines, 2) + chrome, Math.floor(height * 0.85)));
  const capacity = Math.max(2, panelHeight - chrome);
  const selectedKey = selected ? `model-${selected.id}` : undefined;
  const first = windowItems(items, selectedKey, capacity);
  // The "more" marks take a row each, so a window that overflows is taken again with room for them.
  const view = first.above > 0 || first.below > 0 ? windowItems(items, selectedKey, Math.max(2, capacity - 2)) : first;
  const top = Math.max(1, Math.floor((height - panelHeight) / 2));
  const modeLabel = mode === "free" ? "Free · Auto" : mode === "mixed" ? "Mixed" : "";
  const count = models.filter((model) => model.id !== AUTO_FREE_ID).length;

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
            detail={[modeLabel, mode === "free" ? "" : `${count}`].filter(Boolean).join(" · ")}
          />
          <text fg={t.textMuted}>{"esc"}</text>
        </box>
        <box flexShrink={0} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
          <text fg={t.text} wrapMode="none">
            {searchQuery ? (
              clip(searchQuery, room)
            ) : (
              <span style={{ fg: t.textMuted }}>
                {mode === "free" ? "Search..." : "Search provider, model, tools, vision, free..."}
              </span>
            )}
          </text>
        </box>
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
          {models.length === 0 ? (
            <box paddingLeft={2}>
              <text fg={t.textMuted}>{"No models match your search"}</text>
            </box>
          ) : null}
        </box>
        <box flexShrink={0} paddingLeft={2} paddingRight={2} paddingTop={1}>
          {error ? <text fg={t.diffRemovedFg}>{error}</text> : null}
          <text fg={switching ? t.accent : t.textMuted} wrapMode="none">
            {switching
              ? "Preparing model..."
              : clip(
                  `${supportsReasoning ? "left/right reasoning  " : ""}up/down move  pgup/pgdn jump  enter select  esc close`,
                  room,
                )}
          </text>
        </box>
      </box>
    </box>
  );
}
