import { useRenderer, useTerminalDimensions } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import { SectionBadge } from "./components/badge";
import { resolveTheme, type Theme } from "./theme";

/*
 * The sign-in screen, shown when the account is required and this machine has no valid login. It does what Claude
 * Code does: the browser is opened on the website (the address is printed in case it did not open), the person
 * signs in and approves, and the browser hands the terminal a code. Where the browser cannot reach the terminal
 * (SSH, WSL, a container) the page shows the code and it is pasted here.
 */

export type AccountLoginPhase = "starting" | "waiting" | "exchanging" | "error" | "signed-in";

export interface AccountLoginProps {
  phase: AccountLoginPhase;
  /** Why the screen is up ("Sign in to use ShelraCode", "Your login has expired…"). */
  reason: string;
  /** The sign-in address, always shown in full so it can be copied. */
  url?: string;
  /** Whether the browser was opened for the person. */
  opened?: boolean;
  /** What went wrong, in the person's terms. */
  error?: string;
  email?: string | null;
  onSubmitCode: (code: string) => void;
  onRetry: () => void;
  onExit: () => void;
  theme?: Theme;
}

/** The headline for a phase. */
export function phaseTitle(phase: AccountLoginPhase): string {
  switch (phase) {
    case "starting":
      return "Opening your browser";
    case "waiting":
      return "Waiting for you to sign in";
    case "exchanging":
      return "Signing in";
    case "signed-in":
      return "Signed in";
    case "error":
      return "Sign-in did not finish";
  }
}

export function AccountLoginScreen({
  phase,
  reason,
  url,
  opened,
  error,
  email,
  onSubmitCode,
  onRetry,
  onExit,
  theme,
}: AccountLoginProps) {
  const { width, height } = useTerminalDimensions();
  const t = theme ?? resolveTheme();
  const renderer = useRenderer();
  const [pasted, setPasted] = useState("");
  const latest = useRef({ phase, pasted, onSubmitCode, onRetry, onExit });
  latest.current = { phase, pasted, onSubmitCode, onRetry, onExit };

  useEffect(() => {
    const onKey = (key: { name?: string; sequence?: string; ctrl?: boolean; meta?: boolean }) => {
      const now = latest.current;
      if (key.name === "escape" || (key.ctrl && key.name === "c")) return now.onExit();
      if (key.name === "return") {
        if (now.phase === "error") return now.onRetry();
        const code = now.pasted.trim();
        if (code && (now.phase === "waiting" || now.phase === "starting")) {
          setPasted("");
          now.onSubmitCode(code);
        }
        return;
      }
      if (now.phase === "error") {
        if (key.name === "r") now.onRetry();
        return;
      }
      if (key.name === "backspace") return setPasted((value) => value.slice(0, -1));
      if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        setPasted((value) => (value + key.sequence).slice(0, 400));
      }
    };
    const onPaste = (event: { bytes: Uint8Array; preventDefault?: () => void }) => {
      event.preventDefault?.();
      const text = new TextDecoder().decode(event.bytes).replace(/\s+/g, "");
      if (text) setPasted((value) => (value + text).slice(0, 400));
    };
    renderer.keyInput.on("keypress", onKey as never);
    renderer.keyInput.on("paste", onPaste as never);
    return () => {
      renderer.keyInput.off("keypress", onKey as never);
      renderer.keyInput.off("paste", onPaste as never);
    };
  }, [renderer]);

  const room = Math.max(24, Math.min(76, width - 6));
  const waiting = phase === "waiting" || phase === "starting";
  const hints =
    phase === "error"
      ? "enter try again  esc quit"
      : phase === "signed-in"
        ? ""
        : pasted
          ? "enter use this code  esc quit"
          : "esc quit";
  return (
    <box width={width} height={height} alignItems="center" paddingTop={Math.max(1, Math.floor((height - 18) / 3))}>
      <box width={room} flexDirection="column" paddingLeft={2} paddingRight={2}>
        <SectionBadge t={t} label="Sign in" />
        <box paddingTop={1} flexDirection="column">
          <text fg={t.text} wrapMode="word">
            {reason}
          </text>
        </box>
        <box paddingTop={1} flexDirection="column">
          <text fg={phase === "error" ? t.warning : t.accent} wrapMode="none">
            {`${phase === "signed-in" ? "✓" : phase === "error" ? "!" : "●"} ${phaseTitle(phase)}${email && phase === "signed-in" ? ` as ${email}` : ""}`}
          </text>
        </box>
        {waiting && url ? (
          <box paddingTop={1} flexDirection="column">
            <text fg={t.textMuted} wrapMode="word">
              {opened
                ? "Your browser should be open on the ShelraCode sign-in page. If it is not, open this address:"
                : "Open this address in a browser to sign in:"}
            </text>
            <box paddingTop={1}>
              <text fg={t.text} wrapMode="char">
                {url}
              </text>
            </box>
          </box>
        ) : null}
        {waiting ? (
          <box paddingTop={1} flexDirection="column">
            <text fg={t.textMuted} wrapMode="word">
              The browser cannot reach this terminal (SSH, WSL, a container)? Paste the code the page shows:
            </text>
            <text fg={t.text} wrapMode="none">
              {pasted ? `> ${pasted.length > room - 6 ? `…${pasted.slice(-(room - 8))}` : pasted}` : "> "}
            </text>
          </box>
        ) : null}
        {phase === "error" && error ? (
          <box paddingTop={1}>
            <text fg={t.warning} wrapMode="word">
              {error}
            </text>
          </box>
        ) : null}
        <box paddingTop={1}>
          <text fg={t.textDim} wrapMode="none">
            {hints}
          </text>
        </box>
      </box>
    </box>
  );
}
