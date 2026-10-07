import type { Defaults } from "../../config/preferences";
import type { ConnectInput, ProviderAdminRow } from "../../config/provider-admin";
import type { ModelInfo } from "../../types/index";
import { type PickerItem, pickerItems, pickerModels } from "../model-picker-data";

/*
 * The first-run setup and `/config` as one state machine, with no rendering and no side effects: `step` takes a state
 * and what happened (a key, a paste, an effect finishing) and returns the next state and, when something must be done
 * outside (test a key, save a default), the effect to run. The view draws the state; the effects are run by the
 * services (src/config/services.ts). That keeps the whole flow testable key by key.
 *
 * The setup (onboarding) walks: welcome, providers, a billing question for each free-plan provider just connected,
 * the default mode, and for Mixed the default provider and model, then a summary. `/config` is a menu over the same
 * screens: every change is saved as soon as it is made, the way Claude Code's `/config` does.
 */
export type Variant = "onboarding" | "config";

export interface ConfigData {
  providers: ProviderAdminRow[];
  defaults: Defaults;
  /** Who is signed in to ShelraCode, when known. */
  account: { email: string | null } | null;
  /** The models Mixed mode can list (the catalog), for the default-model screen. */
  models: ModelInfo[];
}

export type Screen =
  | { id: "welcome" }
  | { id: "hub"; index: number }
  | { id: "providers"; index: number; warnedNone?: boolean }
  | { id: "provider"; providerId: string; index: number }
  | {
      id: "input";
      providerId: string;
      fieldIndex: number;
      values: ConnectInput;
      buffer: string;
      error?: string;
      /** Fields the provider could not work out from the key, which the person is now asked for. */
      needs?: string[];
    }
  | { id: "billing"; providerId: string; index: number }
  | { id: "mode"; index: number }
  | { id: "default-provider"; index: number }
  | { id: "default-model"; query: string; index: number }
  | { id: "summary" }
  | { id: "confirm-signout"; index: number };

export interface ConfigState {
  variant: Variant;
  stack: Screen[];
  data: ConfigData;
  /** What is being waited for ("Testing the key…"); keys other than escape are ignored meanwhile. */
  busy?: string;
  /** One line of feedback about the last thing that happened. */
  notice?: string;
  /** Providers whose billing question was already answered in this run, so it is asked once. */
  billingAsked?: string[];
  /** True once the setup was left (finished or skipped) or `/config` closed. */
  done?: { skipped: boolean; signedOut?: boolean };
}

export type Effect =
  | { type: "connect"; providerId: string; input: ConnectInput }
  | { type: "disconnect"; providerId: string }
  | { type: "declare-free-plan"; providerId: string; declared: boolean }
  | { type: "set-mode"; mode: "free" | "mixed" }
  | { type: "set-provider"; providerId: string | undefined }
  | { type: "set-model"; modelId: string | undefined }
  | { type: "refresh-models" }
  | { type: "sign-out" }
  | { type: "finish"; skipped: boolean };

export interface KeyInput {
  name?: string;
  sequence?: string;
  ctrl?: boolean;
  meta?: boolean;
}

export type Action =
  | { type: "key"; key: KeyInput }
  | { type: "paste"; text: string }
  | { type: "data"; data: ConfigData }
  | { type: "done"; effect: Effect; ok: boolean; message?: string; data?: ConfigData; needs?: string };

export interface Step {
  state: ConfigState;
  effect?: Effect;
}

/** `start: "confirm-signout"` opens `/config` on the sign-out question (`/logout`), with the menu behind it. */
export function initialState(variant: Variant, data: ConfigData, start?: "confirm-signout"): ConfigState {
  if (variant === "config" && start === "confirm-signout") {
    return {
      variant,
      data,
      stack: [
        { id: "hub", index: 0 },
        { id: "confirm-signout", index: 0 },
      ],
    };
  }
  return { variant, data, stack: [variant === "onboarding" ? { id: "welcome" } : { id: "hub", index: 0 }] };
}

export function current(state: ConfigState): Screen {
  return state.stack[state.stack.length - 1] as Screen;
}

const MIN_INDEX = 0;
const clamp = (value: number, length: number) => Math.max(MIN_INDEX, Math.min(Math.max(0, length - 1), value));

// ── what each screen lists ──────────────────────────────────────────────────────────────────────────────────────

export interface Row {
  id: string;
  label: string;
  value?: string;
  hint?: string;
}

export function providerName(data: ConfigData, providerId: string): string {
  return data.providers.find((row) => row.id === providerId)?.name ?? providerId;
}

function modelLabel(data: ConfigData, modelId: string | undefined): string {
  if (!modelId) return "none";
  const model = data.models.find((item) => item.id === modelId);
  return model ? model.name.replace(/^[^:]+:\s+/u, "") : modelId;
}

export function hubRows(data: ConfigData): Row[] {
  const connected = data.providers.filter((row) => row.connected);
  const preferred = data.defaults.provider;
  return [
    {
      id: "mode",
      label: "Default mode",
      value: data.defaults.mode === "free" ? "Free · Auto" : "Mixed",
      hint: "Enter switches. Free picks the best free model for you; Mixed lets you choose any model.",
    },
    {
      id: "provider",
      label: "Default provider",
      value: preferred ? providerName(data, preferred) : "none",
      hint: "Where Mixed mode starts. Free mode is automatic and does not use it.",
    },
    {
      id: "model",
      label: "Default model",
      value: modelLabel(data, data.defaults.model),
      hint: "The model Mixed mode starts on.",
    },
    {
      id: "providers",
      label: "Providers and keys",
      value: `${connected.length} connected`,
      hint: "Add, replace or remove a key; say whether a free plan has billing.",
    },
    { id: "setup", label: "Run the setup again", hint: "The same steps as the first start." },
    {
      id: "signout",
      label: "Sign out of ShelraCode",
      value: data.account?.email ?? undefined,
      hint: "Revokes this machine's login. Your provider keys stay.",
    },
  ];
}

export function providerRows(state: ConfigState): Row[] {
  const rows: Row[] = state.data.providers.map((row) => ({
    id: row.id,
    label: row.name,
    value: row.connected
      ? row.hasFreePlan && !row.freePlanDeclared
        ? "connected · free plan not declared"
        : "connected"
      : "not set up",
  }));
  rows.push({ id: "__done", label: state.variant === "onboarding" ? "Continue" : "Back" });
  return rows;
}

export interface ProviderAction {
  id: string;
  label: string;
  hint?: string;
}

export function providerActions(row: ProviderAdminRow): ProviderAction[] {
  const actions: ProviderAction[] = [];
  actions.push({ id: "connect", label: row.connected ? "Replace the key" : "Connect" });
  if (row.stored) actions.push({ id: "remove", label: "Remove the saved key" });
  if (row.hasFreePlan && row.connected) {
    actions.push({
      id: "free-plan",
      label: row.freePlanDeclared
        ? "Free plan: no billing (Free mode uses it)"
        : "Free plan: not declared (Free mode skips it)",
      hint: "Enter changes it. Say yes only if this key has no billing turned on.",
    });
  }
  actions.push({ id: "back", label: "Back" });
  return actions;
}

export function modeRows(): Row[] {
  return [
    {
      id: "free",
      label: "Free (recommended)",
      hint: "Shelra picks the best free model of your providers for each request, and never runs a paid one.",
    },
    { id: "mixed", label: "Mixed", hint: "You choose any model of any provider, paid or free." },
  ];
}

export function defaultProviderRows(data: ConfigData): Row[] {
  return [
    { id: "", label: "No preference", hint: "Mixed starts on the first connected provider's router." },
    ...data.providers.filter((row) => row.connected).map((row) => ({ id: row.id, label: row.name })),
  ];
}

export interface ModelChoice {
  items: PickerItem[];
  /** The model ids in the order the cursor moves through them; "" is "no default". */
  ids: string[];
}

export function modelChoices(data: ConfigData, query: string): ModelChoice {
  const names = new Map(data.providers.map((row) => [row.id, row.name]));
  const providerName_ = (id: string) => names.get(id) ?? id;
  const models = pickerModels(data.models, {
    mode: "mixed",
    query,
    providerName: providerName_,
    providerOrder: data.providers.map((row) => row.id),
  }).filter((model) => model.id !== "shelra/free");
  const items = pickerItems(models, providerName_);
  const ids = [
    "",
    ...items.filter((item) => item.kind === "model").map((item) => (item as { model: ModelInfo }).model.id),
  ];
  return { items, ids };
}

// ── transitions ─────────────────────────────────────────────────────────────────────────────────────────────────

function replaceTop(state: ConfigState, screen: Screen): ConfigState {
  return { ...state, stack: [...state.stack.slice(0, -1), screen] };
}

function push(state: ConfigState, screen: Screen): ConfigState {
  return { ...state, stack: [...state.stack, screen] };
}

function pop(state: ConfigState): ConfigState {
  return state.stack.length > 1 ? { ...state, stack: state.stack.slice(0, -1) } : state;
}

function setNotice(state: ConfigState, notice: string | undefined): ConfigState {
  return notice === undefined ? { ...state, notice: undefined } : { ...state, notice };
}

/** The billing question for each connected free-plan provider with no answer yet, that was not asked already. */
function unansweredBilling(state: ConfigState): string[] {
  const asked = new Set(state.billingAsked ?? []);
  return state.data.providers
    .filter((row) => row.connected && row.hasFreePlan && !row.freePlanDeclared && !asked.has(row.id))
    .map((row) => row.id);
}

function markAsked(state: ConfigState, providerId: string): ConfigState {
  return { ...state, billingAsked: [...new Set([...(state.billingAsked ?? []), providerId])] };
}

function toModeScreen(state: ConfigState): ConfigState {
  return push(state, { id: "mode", index: state.data.defaults.mode === "mixed" ? 1 : 0 });
}

/** The setup moves on from the providers: billing questions first, then the mode. */
function afterProviders(state: ConfigState): ConfigState {
  const next = unansweredBilling(state)[0];
  return next ? push(markAsked(state, next), { id: "billing", providerId: next, index: 1 }) : toModeScreen(state);
}

function movement(key: KeyInput): -1 | 0 | 1 {
  if (key.name === "up") return -1;
  if (key.name === "down") return 1;
  return 0;
}

const isEscape = (key: KeyInput) => key.name === "escape" || (key.ctrl === true && key.name === "c");
const isEnter = (key: KeyInput) => key.name === "return" || key.name === "enter";
const isPrintable = (key: KeyInput) =>
  Boolean(key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta && key.sequence >= " ");

/** What the person is asked for: every provider's key alone, plus a field it could not work out from the key. */
export function inputFields(row: ProviderAdminRow | undefined, needs?: readonly string[]) {
  return (row?.fields ?? []).filter((item) => !item.derived || needs?.includes(item.name));
}

function field(state: ConfigState, screen: Extract<Screen, { id: "input" }>) {
  const row = state.data.providers.find((item) => item.id === screen.providerId);
  return inputFields(row, screen.needs)[screen.fieldIndex];
}

export function step(state: ConfigState, action: Action): Step {
  if (state.done) return { state };

  if (action.type === "data") return { state: { ...state, data: action.data } };

  if (action.type === "done") return onDone(state, action);

  const screen = current(state);

  if (action.type === "paste") {
    if (screen.id === "input" && !state.busy) {
      const text = action.text.replace(/[\r\n]+/gu, "").slice(0, 400);
      return {
        state: replaceTop(state, { ...screen, buffer: (screen.buffer + text).slice(0, 400), error: undefined }),
      };
    }
    if (screen.id === "default-model") {
      const text = action.text.replace(/[\r\n]+/gu, " ").slice(0, 80);
      return { state: replaceTop(state, { ...screen, query: screen.query + text, index: 0 }) };
    }
    return { state };
  }

  const key = action.key;
  if (state.busy) {
    // Only leaving is allowed while something is being checked.
    return isEscape(key) ? { state: { ...pop(state), busy: undefined } } : { state };
  }
  const baseState = setNotice(state, undefined);

  switch (screen.id) {
    case "welcome":
      if (isEnter(key)) return { state: push(baseState, { id: "providers", index: 0 }) };
      if (isEscape(key)) return finish(baseState, true);
      return { state };

    case "hub": {
      const rows = hubRows(state.data);
      if (isEscape(key)) return finish(baseState, false);
      const move = movement(key);
      if (move) return { state: replaceTop(baseState, { id: "hub", index: clamp(screen.index + move, rows.length) }) };
      if (!isEnter(key)) return { state };
      const row = rows[screen.index];
      if (row?.id === "mode") {
        const mode = state.data.defaults.mode === "free" ? "mixed" : "free";
        return { state: baseState, effect: { type: "set-mode", mode } };
      }
      if (row?.id === "provider") {
        const options = defaultProviderRows(state.data);
        const at = Math.max(
          0,
          options.findIndex((option) => option.id === (state.data.defaults.provider ?? "")),
        );
        return { state: push(baseState, { id: "default-provider", index: at }) };
      }
      if (row?.id === "model") {
        const ids = modelChoices(state.data, "").ids;
        const at = Math.max(0, ids.indexOf(state.data.defaults.model ?? ""));
        return {
          state: push(baseState, { id: "default-model", query: "", index: at }),
          effect: { type: "refresh-models" },
        };
      }
      if (row?.id === "providers") return { state: push(baseState, { id: "providers", index: 0 }) };
      if (row?.id === "setup") return { state: { ...baseState, variant: "onboarding", stack: [{ id: "welcome" }] } };
      if (row?.id === "signout") return { state: push(baseState, { id: "confirm-signout", index: 1 }) };
      return { state };
    }

    case "providers": {
      const rows = providerRows(state);
      if (isEscape(key)) return { state: pop(baseState) };
      const move = movement(key);
      if (move) return { state: replaceTop(baseState, { ...screen, index: clamp(screen.index + move, rows.length) }) };
      if (!isEnter(key)) return { state };
      const row = rows[screen.index];
      if (!row) return { state };
      if (row.id !== "__done") return { state: push(baseState, { id: "provider", providerId: row.id, index: 0 }) };
      if (state.variant === "config") return { state: pop(baseState) };
      // The setup: a person with no provider is told once what that means, and may go on anyway.
      if (!state.data.providers.some((item) => item.connected) && !screen.warnedNone) {
        return {
          state: setNotice(
            replaceTop(baseState, { ...screen, warnedNone: true }),
            "No provider is connected, so Shelra has nothing to run on yet (a local model with --local aside). Enter again to go on anyway.",
          ),
        };
      }
      return { state: afterProviders(baseState) };
    }

    case "provider": {
      const row = state.data.providers.find((item) => item.id === screen.providerId);
      if (!row) return { state: pop(baseState) };
      const actions = providerActions(row);
      if (isEscape(key)) return { state: pop(baseState) };
      const move = movement(key);
      if (move)
        return { state: replaceTop(baseState, { ...screen, index: clamp(screen.index + move, actions.length) }) };
      if (!isEnter(key)) return { state };
      const action_ = actions[screen.index];
      if (action_?.id === "connect") {
        return { state: push(baseState, { id: "input", providerId: row.id, fieldIndex: 0, values: {}, buffer: "" }) };
      }
      if (action_?.id === "remove") return { state: baseState, effect: { type: "disconnect", providerId: row.id } };
      if (action_?.id === "free-plan") {
        return {
          state: baseState,
          effect: { type: "declare-free-plan", providerId: row.id, declared: !row.freePlanDeclared },
        };
      }
      return { state: pop(baseState) };
    }

    case "input": {
      if (isEscape(key)) return { state: pop(baseState) };
      const def = field(state, screen);
      if (!def) return { state: pop(baseState) };
      if (key.name === "backspace")
        return { state: replaceTop(baseState, { ...screen, buffer: screen.buffer.slice(0, -1), error: undefined }) };
      if (isEnter(key)) {
        const value = screen.buffer.trim();
        if (!value && !def.optional)
          return { state: replaceTop(baseState, { ...screen, error: `${def.label} is required.` }) };
        const values: ConnectInput = { ...screen.values, ...(value ? { [def.name]: value } : {}) };
        const row = state.data.providers.find((item) => item.id === screen.providerId);
        const last = screen.fieldIndex >= inputFields(row, screen.needs).length - 1;
        if (!last) {
          return {
            state: replaceTop(baseState, {
              ...screen,
              fieldIndex: screen.fieldIndex + 1,
              values,
              buffer: "",
              error: undefined,
            }),
          };
        }
        return {
          state: {
            ...replaceTop(baseState, { ...screen, values, buffer: "" }),
            busy: "Checking it with the provider…",
          },
          effect: { type: "connect", providerId: screen.providerId, input: values },
        };
      }
      if (isPrintable(key))
        return {
          state: replaceTop(baseState, {
            ...screen,
            buffer: (screen.buffer + key.sequence).slice(0, 400),
            error: undefined,
          }),
        };
      return { state };
    }

    case "billing": {
      if (isEscape(key)) return { state: pop(baseState) };
      const move = movement(key);
      if (move) return { state: replaceTop(baseState, { ...screen, index: clamp(screen.index + move, 2) }) };
      if (!isEnter(key)) return { state };
      // Index 0 is "no billing"; 1 is "yes, or not sure", the safe answer, which is the default.
      const declared = screen.index === 0;
      const next = pop(markAsked(baseState, screen.providerId));
      // In the setup the next question (or the mode) follows; from `/config` the person is back where they were.
      const afterwards =
        state.variant === "onboarding" && current(next).id === "providers" ? afterProviders(next) : next;
      return {
        state: afterwards,
        effect: { type: "declare-free-plan", providerId: screen.providerId, declared },
      };
    }

    case "mode": {
      if (isEscape(key)) return { state: pop(baseState) };
      const move = movement(key);
      if (move) return { state: replaceTop(baseState, { ...screen, index: clamp(screen.index + move, 2) }) };
      if (!isEnter(key)) return { state };
      const mode: "free" | "mixed" = screen.index === 1 ? "mixed" : "free";
      const defaults: Defaults = { ...state.data.defaults, mode };
      const withMode = { ...baseState, data: { ...state.data, defaults } };
      const onward =
        mode === "mixed" ? push(withMode, { id: "default-provider", index: 0 }) : push(withMode, { id: "summary" });
      return { state: onward, effect: { type: "set-mode", mode } };
    }

    case "default-provider": {
      const options = defaultProviderRows(state.data);
      if (isEscape(key)) return { state: pop(baseState) };
      const move = movement(key);
      if (move)
        return { state: replaceTop(baseState, { ...screen, index: clamp(screen.index + move, options.length) }) };
      if (!isEnter(key)) return { state };
      const chosen = options[screen.index]?.id || undefined;
      const { provider: _previous, ...others } = state.data.defaults;
      const defaults: Defaults = chosen ? { ...others, provider: chosen } : others;
      const withProvider = { ...baseState, data: { ...state.data, defaults } };
      const onward =
        state.variant === "onboarding"
          ? push(pop(withProvider), { id: "default-model", query: "", index: 0 })
          : pop(withProvider);
      return {
        state: onward,
        effect: { type: "set-provider", providerId: chosen },
      };
    }

    case "default-model": {
      const choices = modelChoices(state.data, screen.query);
      if (isEscape(key)) {
        // Leaving the setup's model step without choosing is skipping it; `/config` just goes back.
        return { state: state.variant === "onboarding" ? replaceTop(baseState, { id: "summary" }) : pop(baseState) };
      }
      const move = movement(key);
      if (move)
        return { state: replaceTop(baseState, { ...screen, index: clamp(screen.index + move, choices.ids.length) }) };
      if (key.name === "pageup" || key.name === "pagedown") {
        const jump = key.name === "pageup" ? -6 : 6;
        return { state: replaceTop(baseState, { ...screen, index: clamp(screen.index + jump, choices.ids.length) }) };
      }
      if (key.name === "backspace")
        return { state: replaceTop(baseState, { ...screen, query: screen.query.slice(0, -1), index: 0 }) };
      if (isEnter(key)) {
        const id = choices.ids[screen.index] || undefined;
        const { model: _previous, ...others } = state.data.defaults;
        const defaults: Defaults = id ? { ...others, model: id } : others;
        const withModel = { ...baseState, data: { ...state.data, defaults } };
        const onward = state.variant === "onboarding" ? replaceTop(withModel, { id: "summary" }) : pop(withModel);
        return { state: onward, effect: { type: "set-model", modelId: id } };
      }
      if (isPrintable(key))
        return { state: replaceTop(baseState, { ...screen, query: screen.query + key.sequence, index: 0 }) };
      return { state };
    }

    case "summary":
      if (isEnter(key)) return finish(baseState, false);
      if (isEscape(key)) return { state: pop(baseState) };
      return { state };

    case "confirm-signout": {
      if (isEscape(key)) return { state: pop(baseState) };
      const move = movement(key);
      if (move) return { state: replaceTop(baseState, { ...screen, index: clamp(screen.index + move, 2) }) };
      if (!isEnter(key)) return { state };
      return screen.index === 0
        ? { state: { ...baseState, busy: "Signing out…" }, effect: { type: "sign-out" } }
        : { state: pop(baseState) };
    }
  }
}

function finish(state: ConfigState, skipped: boolean): Step {
  return { state: { ...state, done: { skipped } }, effect: { type: "finish", skipped } };
}

function onDone(state: ConfigState, action: Extract<Action, { type: "done" }>): Step {
  const withData = action.data ? { ...state, data: action.data } : state;
  const cleared: ConfigState = { ...withData, busy: undefined };
  const { effect } = action;

  if (effect.type === "sign-out") {
    if (!action.ok) return { state: setNotice(pop(cleared), action.message ?? "Could not sign out.") };
    return { state: { ...cleared, done: { skipped: false, signedOut: true } } };
  }

  if (effect.type === "connect") {
    const screen = current(cleared);
    if (!action.ok) {
      if (screen.id !== "input") return { state: setNotice(cleared, action.message) };
      const needs = action.needs ? [...new Set([...(screen.needs ?? []), action.needs])] : screen.needs;
      const visible = inputFields(
        cleared.data.providers.find((row) => row.id === screen.providerId),
        needs,
      );
      // A field the key could not give is asked for next; any other failure is the key's, so it is typed again.
      const at = visible.findIndex((item) => item.name === (action.needs ?? "apiKey"));
      const { apiKey: _rejected, ...keptValues } = screen.values;
      return {
        state: replaceTop(cleared, {
          ...screen,
          ...(needs ? { needs } : {}),
          fieldIndex: Math.max(0, at),
          // A rejected key is typed again with the other fields kept; a missing field keeps the key just typed.
          values: action.needs ? screen.values : keptValues,
          buffer: "",
          error: action.message ?? "That did not work.",
        }),
      };
    }
    const ownScreen = screen.id === "input" && screen.providerId === effect.providerId;
    const popped = ownScreen ? pop(cleared) : cleared;
    const row = cleared.data.providers.find((item) => item.id === effect.providerId);
    const note = action.message ?? `Connected${row ? ` ${row.name}` : ""}.`;
    // A free plan is only used by Free mode once the person says their key has no billing: ask right away.
    const asked =
      ownScreen && row?.hasFreePlan && !row.freePlanDeclared
        ? push(markAsked(popped, row.id), { id: "billing", providerId: row.id, index: 1 })
        : popped;
    return { state: setNotice(asked, note) };
  }

  if (!action.ok) return { state: setNotice(cleared, action.message ?? "That did not work.") };
  if (effect.type === "disconnect") return { state: setNotice(cleared, "Removed.") };
  return { state: cleared };
}
