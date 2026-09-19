/**
 * Keyboard model, in one place. The help overlay and the composer hints read from here so the
 * two can never drift apart. Keys avoid what terminals reserve: nothing depends on Ctrl+I (it is
 * Tab), Ctrl+M (Enter) or Ctrl+[ (Esc), and every action also has a slash command.
 */

export interface Hint {
  key: string;
  label: string;
}

export type ShortcutGroup = "Compose" | "While Shelra works" | "Review" | "Session";

export interface Shortcut {
  group: ShortcutGroup;
  keys: string;
  label: string;
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = ["Compose", "While Shelra works", "Review", "Session"];

export const SHORTCUTS: readonly Shortcut[] = [
  { group: "Compose", keys: "enter", label: "Send the message" },
  { group: "Compose", keys: "shift+enter", label: "Insert a new line" },
  { group: "Compose", keys: "@", label: "Mention a file" },
  { group: "Compose", keys: "/", label: "Open the command list" },
  { group: "Compose", keys: "tab", label: "Next mode: agent, plan, ask" },
  { group: "While Shelra works", keys: "esc", label: "Stop the current run" },
  { group: "While Shelra works", keys: "ctrl+c", label: "Stop the current run" },
  { group: "While Shelra works", keys: "enter", label: "Queue a follow-up" },
  { group: "Review", keys: "alt+1…5", label: "Switch view: Log, Plan, Changes, Checks, Context" },
  { group: "Review", keys: "esc", label: "Back to the log from another view" },
  { group: "Review", keys: "ctrl+o", label: "Show or hide step details" },
  { group: "Review", keys: "ctrl+e", label: "Expand your last message" },
  { group: "Review", keys: "/status", label: "Plan, activity and evidence" },
  { group: "Review", keys: "ctrl+y", label: "Copy the selected text" },
  { group: "Session", keys: "/new", label: "Start a new session" },
  { group: "Session", keys: "ctrl+c", label: "Clear the prompt; twice to exit" },
];

/** Priority order: the composer keeps as many as fit, dropping from the end. */
export const IDLE_HINTS: readonly Hint[] = [
  { key: "?", label: "shortcuts" },
  { key: "ctrl+o", label: "details" },
  { key: "tab", label: "mode" },
  { key: "@", label: "files" },
  { key: "shift+enter", label: "new line" },
];

export const WORKING_HINTS: readonly Hint[] = [
  { key: "esc", label: "stop" },
  { key: "enter", label: "queue" },
  { key: "ctrl+o", label: "details" },
];

export const SUGGESTION_HINTS: readonly Hint[] = [
  { key: "tab", label: "accept" },
  { key: "↑↓", label: "navigate" },
  { key: "esc", label: "dismiss" },
];

const VIEWS_HINT: Hint = { key: "alt+2-5", label: "views" };
const BACK_HINT: Hint = { key: "esc", label: "back to the log" };

/**
 * The views (plan, changes, checks, context) are worth a hint only once one has something to open,
 * and while one is open the way back is the first key shown.
 */
export function withViewHints(hints: readonly Hint[], state: { hasViews: boolean; viewOpen: boolean }): Hint[] {
  if (state.viewOpen) return [BACK_HINT, ...hints.filter((hint) => hint.key !== "esc")];
  if (!state.hasViews) return [...hints];
  const at = hints.findIndex((hint) => hint.key === "ctrl+o");
  const index = at >= 0 ? at + 1 : Math.min(2, hints.length);
  return [...hints.slice(0, index), VIEWS_HINT, ...hints.slice(index)];
}

const SEPARATOR_WIDTH = 3; // " · "

export function hintsWidth(hints: readonly Hint[]): number {
  if (hints.length === 0) return 0;
  return (
    hints.reduce((sum, hint) => sum + hint.key.length + 1 + hint.label.length, 0) + SEPARATOR_WIDTH * (hints.length - 1)
  );
}

/** The longest prefix of `hints` that fits in `room` cells. Never wraps, never overflows. */
export function fitHints(hints: readonly Hint[], room: number): Hint[] {
  let count = hints.length;
  while (count > 0 && hintsWidth(hints.slice(0, count)) > room) count -= 1;
  return hints.slice(0, count);
}
