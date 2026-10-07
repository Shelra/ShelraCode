import { useRenderer, useTerminalDimensions } from "@opentui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ConfigServices } from "../../config/services";
import { SectionBadge } from "../components/badge";
import { HEADER_ROW_LINES, MODEL_ROW_LINES, windowItems } from "../model-picker-data";
import { resolveTheme, type Theme } from "../theme";
import {
  type Action,
  type ConfigState,
  current,
  defaultProviderRows,
  type Effect,
  hubRows,
  initialState,
  inputFields,
  modelChoices,
  modeRows,
  providerActions,
  providerName,
  providerRows,
  type Row,
  type Screen,
  step,
  type Variant,
} from "./flow";

/*
 * The first-run setup and `/config`, drawn. All the logic is in flow.ts; this file shows the current screen, feeds it
 * keys and pastes, and runs the effects it asks for through the services. A secret is typed or pasted and shown only
 * as dots.
 */
export interface ConfigViewProps {
  variant: Variant;
  /** `/logout` opens the settings on the sign-out question. */
  start?: "confirm-signout";
  services: ConfigServices;
  /** Called once, when the setup is finished or skipped or `/config` is closed. */
  onClose: (result: { skipped: boolean; signedOut: boolean }) => void;
  theme?: Theme;
}

const PANEL_WIDTH = 76;

function clip(text: string, room: number): string {
  return text.length > room ? `${text.slice(0, Math.max(1, room - 1))}…` : text;
}

function stepTitle(variant: Variant, screen: Screen): string {
  if (variant === "config") {
    switch (screen.id) {
      case "providers":
      case "provider":
      case "input":
      case "billing":
        return "Providers and keys";
      case "default-provider":
        return "Default provider";
      case "default-model":
        return "Default model";
      case "confirm-signout":
        return "Sign out";
      case "welcome":
      case "mode":
      case "summary":
        return "Setup";
      default:
        return "Settings";
    }
  }
  switch (screen.id) {
    case "welcome":
      return "Welcome";
    case "providers":
    case "provider":
    case "input":
    case "billing":
      return "Providers";
    case "mode":
      return "Mode";
    case "default-provider":
    case "default-model":
      return "Defaults";
    case "summary":
      return "Ready";
    default:
      return "Setup";
  }
}

function hintsFor(screen: Screen): string {
  const move = "up/down move  enter select";
  switch (screen.id) {
    case "welcome":
      return "enter start  esc skip the setup";
    case "hub":
      return `${move}  esc close`;
    case "input":
      return "enter next  esc cancel";
    case "default-model":
      return "type to search  up/down move  pgdn jump  enter choose  esc back";
    case "summary":
      return "enter start using Shelra  esc back";
    default:
      return `${move}  esc back`;
  }
}

export function ConfigView({ variant, start, services, onClose, theme }: ConfigViewProps) {
  const { width, height } = useTerminalDimensions();
  const t = theme ?? resolveTheme();
  const renderer = useRenderer();
  const [state, setState] = useState<ConfigState>(() => initialState(variant, services.data(), start));
  const latest = useRef(state);
  const closed = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const dispatch = useCallback(
    (action: Action) => {
      const result = step(latest.current, action);
      latest.current = result.state;
      setState(result.state);
      const effect = result.effect;
      if (!effect) return;
      void (async () => {
        const outcome = await services.run(effect);
        const settled = step(latest.current, {
          type: "done",
          effect: effect as Effect,
          ok: outcome.ok,
          ...(outcome.message ? { message: outcome.message } : {}),
          data: outcome.data ?? services.data(),
          ...(outcome.needs ? { needs: outcome.needs } : {}),
        });
        latest.current = settled.state;
        setState(settled.state);
        if (settled.state.done && !closed.current) {
          closed.current = true;
          onCloseRef.current({ skipped: settled.state.done.skipped, signedOut: settled.state.done.signedOut === true });
        }
      })();
    },
    [services],
  );

  // Escape and the end of the flow close it; `finish` has no wait, so it closes at the moment it is asked for.
  useEffect(() => {
    if (state.done && !closed.current && !state.done.signedOut) {
      closed.current = true;
      onCloseRef.current({ skipped: state.done.skipped, signedOut: false });
    }
  }, [state.done]);

  useEffect(() => {
    const onKey = (key: { name?: string; sequence?: string; ctrl?: boolean; meta?: boolean }) => {
      dispatch({ type: "key", key });
    };
    const onPaste = (event: { bytes: Uint8Array; preventDefault?: () => void }) => {
      event.preventDefault?.();
      dispatch({ type: "paste", text: new TextDecoder().decode(event.bytes) });
    };
    renderer.keyInput.on("keypress", onKey as never);
    renderer.keyInput.on("paste", onPaste as never);
    return () => {
      renderer.keyInput.off("keypress", onKey as never);
      renderer.keyInput.off("paste", onPaste as never);
    };
  }, [renderer, dispatch]);

  const screen = current(state);
  const panelWidth = Math.max(40, Math.min(PANEL_WIDTH, width - 4));
  const room = panelWidth - 6;
  const panelHeight = Math.min(height - 2, 26);
  const top = Math.max(0, Math.floor((height - panelHeight) / 3));

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
            label={variant === "onboarding" ? "Setup" : "Config"}
            detail={stepTitle(variant, screen)}
          />
          <text fg={t.textMuted}>{variant === "config" ? "esc" : ""}</text>
        </box>
        <box flexGrow={1} minHeight={0} flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1}>
          <Body t={t} state={state} screen={screen} room={room} lines={panelHeight - 7} />
        </box>
        <box flexShrink={0} flexDirection="column" paddingLeft={2} paddingRight={2}>
          {state.busy ? (
            <text fg={t.accent} wrapMode="none">
              {clip(state.busy, room)}
            </text>
          ) : state.notice ? (
            <text fg={t.textMuted} wrapMode="word">
              {state.notice}
            </text>
          ) : null}
          <text fg={t.textDim} wrapMode="none">
            {clip(hintsFor(screen), room)}
          </text>
        </box>
      </box>
    </box>
  );
}

function RowList({ t, rows, index, room }: { t: Theme; rows: readonly Row[]; index: number; room: number }) {
  const selected = rows[index];
  return (
    <box flexDirection="column">
      {rows.map((row, position) => {
        const isSelected = position === index;
        return (
          <box
            key={row.id || "__none"}
            backgroundColor={isSelected ? t.selectedBg : undefined}
            flexDirection="row"
            justifyContent="space-between"
          >
            <text fg={isSelected ? t.selected : t.text} wrapMode="none">
              {clip(row.label, Math.max(10, room - (row.value?.length ?? 0) - 2))}
            </text>
            {row.value ? (
              <text fg={isSelected ? t.primary : t.textMuted} wrapMode="none">
                {row.value}
              </text>
            ) : null}
          </box>
        );
      })}
      {selected?.hint ? (
        <box paddingTop={1}>
          <text fg={t.textMuted} wrapMode="word">
            {selected.hint}
          </text>
        </box>
      ) : null}
    </box>
  );
}

function Body({
  t,
  state,
  screen,
  room,
  lines,
}: {
  t: Theme;
  state: ConfigState;
  screen: Screen;
  room: number;
  lines: number;
}) {
  const data = state.data;
  switch (screen.id) {
    case "welcome":
      return (
        <box flexDirection="column">
          <text fg={t.text} wrapMode="word">
            Welcome to ShelraCode. This takes about a minute: connect the model providers you use, then choose how
            Shelra picks models.
          </text>
          <box paddingTop={1} flexDirection="column">
            <text fg={t.textMuted} wrapMode="word">
              Free mode runs only free models, picked for you from every provider you connect, and never a paid one.
              Mixed mode lets you choose any model.
            </text>
          </box>
          <box paddingTop={1}>
            <text fg={t.textMuted} wrapMode="word">
              You can change all of this later with /config.
            </text>
          </box>
        </box>
      );

    case "hub":
      return <RowList t={t} rows={hubRows(data)} index={screen.index} room={room} />;

    case "providers":
      return (
        <box flexDirection="column">
          {state.variant === "onboarding" ? (
            <box paddingBottom={1}>
              <text fg={t.textMuted} wrapMode="word">
                Connect at least one provider. OpenRouter and Groq have free models; a key is all you need.
              </text>
            </box>
          ) : null}
          <RowList t={t} rows={providerRows(state)} index={screen.index} room={room} />
        </box>
      );

    case "provider": {
      const row = data.providers.find((item) => item.id === screen.providerId);
      if (!row) return null;
      const actions = providerActions(row).map((action) => ({ id: action.id, label: action.label, hint: action.hint }));
      return (
        <box flexDirection="column">
          <text fg={t.text} wrapMode="none">
            {row.name}
            <span
              style={{ fg: row.connected ? t.accent : t.textMuted }}
            >{`  ${row.connected ? "connected" : "not set up"}`}</span>
          </text>
          {row.fromEnvironment ? (
            <text fg={t.textMuted} wrapMode="word">
              {`Set in the environment (${row.source}); it wins over a saved key.`}
            </text>
          ) : row.source ? (
            <text fg={t.textMuted} wrapMode="none">{`Key from ${row.source}.`}</text>
          ) : null}
          {row.plan ? (
            <text fg={t.textMuted} wrapMode="word">{`Plan: ${row.plan}${row.privacy ? `; ${row.privacy}` : ""}.`}</text>
          ) : null}
          <box paddingTop={1}>
            <RowList t={t} rows={actions} index={screen.index} room={room} />
          </box>
        </box>
      );
    }

    case "input": {
      const row = data.providers.find((item) => item.id === screen.providerId);
      const field = inputFields(row, screen.needs)[screen.fieldIndex];
      if (!row || !field) return null;
      const shown = field.secret ? "●".repeat(Math.min(screen.buffer.length, room - 4)) : clip(screen.buffer, room - 4);
      return (
        <box flexDirection="column">
          <text fg={t.text} wrapMode="none">{`${row.name} · ${field.label}`}</text>
          {row.keyUrl && field.name === "apiKey" ? (
            <text fg={t.textMuted} wrapMode="word">{`Get one at ${row.keyUrl}`}</text>
          ) : null}
          {field.hint ? (
            <text fg={t.textMuted} wrapMode="word">
              {field.hint}
            </text>
          ) : null}
          <box paddingTop={1}>
            <text fg={t.text} wrapMode="none">{`> ${shown}`}</text>
          </box>
          {field.secret ? (
            <text fg={t.textDim} wrapMode="none">
              Paste it: it is never shown, and it is tested before it is kept.
            </text>
          ) : null}
          {screen.error ? (
            <box paddingTop={1}>
              <text fg={t.warning} wrapMode="word">
                {screen.error}
              </text>
            </box>
          ) : null}
        </box>
      );
    }

    case "billing": {
      const row = data.providers.find((item) => item.id === screen.providerId);
      const rows: Row[] = [
        {
          id: "no",
          label: "No: it is a free plan with no billing",
          hint: "Free mode may use this provider's free models.",
        },
        {
          id: "yes",
          label: "Yes, billing is on, or I am not sure",
          hint: "Free mode will skip it, so nothing can be charged. Mixed mode still uses it.",
        },
      ];
      return (
        <box flexDirection="column">
          <text fg={t.text} wrapMode="word">
            {`Does your ${row?.name ?? "provider"} key have billing turned on?`}
          </text>
          <text fg={t.textMuted} wrapMode="word">
            {`${row?.plan ?? "Its free plan stops at a quota"}; a key on a billed account is charged beyond it, and Shelra cannot see that. ${row?.privacy ? `Note: ${row.privacy}.` : ""}`}
          </text>
          <box paddingTop={1}>
            <RowList t={t} rows={rows} index={screen.index} room={room} />
          </box>
        </box>
      );
    }

    case "mode":
      return (
        <box flexDirection="column">
          <text fg={t.text} wrapMode="word">
            How should Shelra pick models?
          </text>
          <box paddingTop={1}>
            <RowList t={t} rows={modeRows()} index={screen.index} room={room} />
          </box>
        </box>
      );

    case "default-provider":
      return (
        <box flexDirection="column">
          <text fg={t.text} wrapMode="word">
            Which provider should Mixed mode start on?
          </text>
          <text fg={t.textMuted} wrapMode="word">
            Free mode is automatic and ignores this.
          </text>
          <box paddingTop={1}>
            <RowList t={t} rows={defaultProviderRows(data)} index={screen.index} room={room} />
          </box>
        </box>
      );

    case "default-model":
      return <ModelList t={t} state={state} screen={screen} room={room} lines={lines} />;

    case "summary":
      return (
        <box flexDirection="column">
          <text fg={t.accent} wrapMode="none">
            ✓ You are set up
          </text>
          <box paddingTop={1} flexDirection="column">
            <text
              fg={t.text}
              wrapMode="none"
            >{`Mode      ${data.defaults.mode === "free" ? "Free · Auto" : "Mixed"}`}</text>
            <text fg={t.text} wrapMode="none">
              {`Providers ${
                data.providers
                  .filter((row) => row.connected)
                  .map((row) => row.name)
                  .join(", ") || "none yet"
              }`}
            </text>
            {data.defaults.mode === "mixed" ? (
              <text fg={t.text} wrapMode="none">
                {clip(
                  `Starts on ${data.defaults.model ?? (data.defaults.provider ? providerName(data, data.defaults.provider) : "the first provider's router")}`,
                  room,
                )}
              </text>
            ) : null}
          </box>
          <box paddingTop={1}>
            <text fg={t.textMuted} wrapMode="word">
              Change any of this later with /config.
            </text>
          </box>
        </box>
      );

    case "confirm-signout": {
      const rows: Row[] = [
        { id: "yes", label: "Yes, sign out" },
        { id: "no", label: "No, stay signed in" },
      ];
      return (
        <box flexDirection="column">
          <text fg={t.text} wrapMode="word">
            {`Sign out${data.account?.email ? ` ${data.account.email}` : ""}?`}
          </text>
          <text fg={t.textMuted} wrapMode="word">
            This machine's login is revoked. Your provider keys stay, and the setup runs again at the next start.
          </text>
          <box paddingTop={1}>
            <RowList t={t} rows={rows} index={screen.index} room={room} />
          </box>
        </box>
      );
    }
  }
}

function ModelList({
  t,
  state,
  screen,
  room,
  lines,
}: {
  t: Theme;
  state: ConfigState;
  screen: Extract<Screen, { id: "default-model" }>;
  room: number;
  lines: number;
}) {
  const choices = modelChoices(state.data, screen.query);
  const selectedId = choices.ids[screen.index] ?? "";
  // The first row is "no default"; the models below it are windowed, so a catalog of thousands costs the same as ten.
  const capacity = Math.max(MODEL_ROW_LINES, lines - 6);
  const view = windowItems(choices.items, selectedId ? `model-${selectedId}` : undefined, capacity);
  return (
    <box flexDirection="column">
      <text fg={t.text} wrapMode="none">
        {screen.query ? `Search: ${clip(screen.query, room - 9)}` : "Search provider, model, tools, vision, free..."}
      </text>
      <box paddingTop={1} flexDirection="column">
        <box backgroundColor={selectedId === "" ? t.selectedBg : undefined}>
          <text fg={selectedId === "" ? t.selected : t.text} wrapMode="none">
            No default (Mixed starts on the provider's router)
          </text>
        </box>
        {view.above > 0 ? <text fg={t.textDim} wrapMode="none">{`${view.above} more above`}</text> : null}
        {view.items.map((item) => {
          if (item.kind === "header") {
            return <text key={item.key} fg={t.textMuted} wrapMode="none">{`${item.label} · ${item.count}`}</text>;
          }
          const selected = item.model.id === selectedId;
          const label =
            item.model.freeStatus === "free"
              ? "free"
              : item.model.freeStatus === "free-plan"
                ? "free plan"
                : item.model.freeStatus === "paid"
                  ? "paid"
                  : "";
          return (
            <box
              key={item.key}
              backgroundColor={selected ? t.selectedBg : undefined}
              flexDirection="row"
              justifyContent="space-between"
            >
              <text fg={selected ? t.selected : t.text} wrapMode="none">
                {clip(item.model.name.replace(/^[^:]+:\s+/u, ""), room - label.length - 2)}
              </text>
              <text fg={selected ? t.primary : t.textMuted} wrapMode="none">
                {label}
              </text>
            </box>
          );
        })}
        {view.below > 0 ? <text fg={t.textDim} wrapMode="none">{`${view.below} more below`}</text> : null}
        {choices.ids.length === 1 && screen.query ? (
          <text fg={t.textMuted} wrapMode="none">
            No models match your search
          </text>
        ) : null}
        {choices.items.length === 0 && !screen.query ? (
          <text fg={t.textMuted} wrapMode="word">
            The catalog is empty: connect a provider, or wait a moment while the lists load.
          </text>
        ) : null}
      </box>
    </box>
  );
}

export { HEADER_ROW_LINES };
