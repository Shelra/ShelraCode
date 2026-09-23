import type { MouseEvent } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { useMemo } from "react";
import type { HardwareProfile } from "../hardware/profile";
import { formatDownloadSize, formatDownloadSpeed } from "../models/huggingface";
import type { ModelRecommendation } from "../models/recommendation";
import { PRODUCT_NAME } from "../product/identity";
import type { LocalRuntimeDiscovery } from "../runtimes/types";
import type { StartupProgress } from "../startup/types";
import { SectionBadge } from "./components/badge";
import { resolveTheme, type Theme } from "./theme";

interface StartupScreenProps {
  progress: StartupProgress;
  hardware: HardwareProfile;
  discovery: LocalRuntimeDiscovery;
  onRetry: () => void;
  onInstall?: () => void;
  onExit: () => void;
  recommendation?: ModelRecommendation;
  installing?: boolean;
  canInstall?: boolean;
  canBootstrapRuntime?: boolean;
}

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes.toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

function StartupAction({
  t,
  label,
  onPress,
  disabled = false,
  highlighted = false,
}: {
  t: Theme;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  highlighted?: boolean;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: intentional startup mouse action
    <box
      backgroundColor={highlighted && !disabled ? t.brand : t.background}
      border={highlighted && !disabled ? false : ["top", "bottom", "left", "right"]}
      borderStyle="single"
      borderColor={t.border}
      paddingLeft={2}
      paddingRight={2}
      onMouseUp={(event: MouseEvent) => {
        if (event.button === 0 && !disabled) onPress();
      }}
    >
      <text fg={disabled ? t.disabled : highlighted ? t.onAccent : t.brand}>
        {highlighted && !disabled ? <b>{label}</b> : label}
      </text>
    </box>
  );
}

function Stage({ t, label, complete, active }: { t: Theme; label: string; complete: boolean; active: boolean }) {
  return (
    <box flexDirection="row" height={1}>
      <text fg={complete || active ? t.brand : t.textMuted}>{complete ? "✓ " : active ? "● " : "○ "}</text>
      <text fg={complete || active ? t.text : t.textMuted}>{label}</text>
    </box>
  );
}

function ProgressBar({ t, progress }: { t: Theme; progress: StartupProgress }) {
  if (progress.percent === undefined && progress.completed === undefined) return null;
  const percent = progress.percent ?? (progress.total ? ((progress.completed ?? 0) / progress.total) * 100 : 0);
  const filled = Math.round(Math.max(0, Math.min(100, percent)) / 5);
  const bytes = progress.completed !== undefined ? formatDownloadSize(progress.completed) : undefined;
  const total = progress.total !== undefined ? formatDownloadSize(progress.total) : undefined;
  const speed = formatDownloadSpeed(progress.speedBytesPerSecond);
  const eta = progress.etaSeconds !== undefined ? `ETA ${formatElapsed(progress.etaSeconds)}` : "Preparing";
  return (
    <box flexDirection="column" marginTop={1}>
      <box flexDirection="row">
        <text>
          <span style={{ fg: t.brand }}>{"█".repeat(filled)}</span>
          <span style={{ fg: t.border }}>{"░".repeat(20 - filled)}</span>
        </text>
        <text fg={t.brand}>{`  ${Math.round(percent)}%`}</text>
      </box>
      <text fg={t.textMuted}>{bytes && total ? `${bytes} / ${total} · ${speed} · ${eta}` : `${speed} · ${eta}`}</text>
    </box>
  );
}

export function StartupScreen({
  progress,
  hardware,
  discovery,
  onRetry,
  onInstall,
  onExit,
  recommendation,
  installing,
  canInstall = Boolean(onInstall),
  canBootstrapRuntime = false,
}: StartupScreenProps) {
  const { width, height } = useTerminalDimensions();
  const t = resolveTheme();
  const gpu = useMemo(() => {
    const gpu = hardware.gpu?.[0];
    if (!gpu && ["booting", "detecting-runtime", "detecting-hardware"].includes(progress.state)) {
      return { name: "Scanning graphics acceleration...", vram: "checking" };
    }
    if (!gpu) return { name: "CPU mode", vram: "no dedicated VRAM" };
    return {
      name: `${gpu.vendor} ${gpu.model}`,
      vram: gpu.vramTotalGb ? `${gpu.vramTotalGb.toFixed(1)} GB` : "detected",
    };
  }, [hardware.gpu, progress.state]);
  const failed = ["onboarding", "recoverable-error", "fatal-error"].includes(progress.state);
  const modelReady = discovery.models.length > 0;
  const runtimeReady = discovery.runtimes.length > 0;
  const runtimeActive = progress.state === "detecting-runtime" || progress.state === "preparing-runtime";
  const modelActive = ["detecting-models", "recommending-model", "onboarding", "downloading-model"].includes(
    progress.state,
  );
  const readinessActive = ["validating-model", "loading-model", "health-check"].includes(progress.state);
  const panelWidth = Math.min(100, Math.max(54, width - 6));
  const panelHeight = Math.min(Math.max(20, height - 3), 32);
  const statusTitle = progress.state === "onboarding" ? "One step to a private coding session" : progress.message;

  return (
    <box width={width} height={height} backgroundColor={t.background} alignItems="center" justifyContent="center">
      <box
        width={panelWidth}
        height={panelHeight}
        border={["top", "bottom", "left", "right"]}
        borderStyle="single"
        borderColor={t.border}
        paddingLeft={3}
        paddingRight={3}
        paddingTop={1}
        flexDirection="column"
      >
        <box flexDirection="row" justifyContent="space-between">
          <text fg={t.primary}>
            <b>{PRODUCT_NAME}</b>
          </text>
          <SectionBadge t={t} label="Private" />
        </box>
        <text fg={t.textMuted}>A local coding environment that prepares itself</text>
        <box height={1} />
        <box flexDirection="row" gap={3}>
          <box flexDirection="column" width={22}>
            <SectionBadge t={t} label="Startup" />
            <box height={1} />
            <Stage
              t={t}
              label="Hardware"
              complete={!["booting", "detecting-runtime", "detecting-hardware"].includes(progress.state)}
              active={progress.state === "detecting-hardware"}
            />
            <Stage t={t} label="Local engine" complete={runtimeReady} active={runtimeActive} />
            <Stage t={t} label="Model" complete={modelReady} active={modelActive} />
            <Stage t={t} label="Readiness" complete={progress.state === "ready"} active={readinessActive} />
          </box>
          <box flexDirection="column" flexGrow={1}>
            <text fg={t.brand}>{statusTitle}</text>
            {progress.detail ? <text fg={t.textMuted}>{progress.detail}</text> : null}
            <ProgressBar t={t} progress={progress} />
            <box height={1} />
            <box
              backgroundColor={t.surface}
              paddingLeft={2}
              paddingRight={2}
              paddingTop={1}
              paddingBottom={1}
              flexDirection="column"
            >
              <SectionBadge t={t} label="This computer" />
              <text fg={t.text}>{gpu.name}</text>
              <text fg={t.textMuted}>{`VRAM ${gpu.vram} · ${hardware.memoryGb.toFixed(1)} GB RAM`}</text>
              <text
                fg={t.textMuted}
              >{`${discovery.models.length} local model${discovery.models.length === 1 ? "" : "s"} detected`}</text>
            </box>
            {progress.state === "onboarding" && recommendation ? (
              <box marginTop={1} border={["left"]} borderColor={t.brand} paddingLeft={2} flexDirection="column">
                <SectionBadge t={t} label="Recommended" />
                <text fg={t.primary}>
                  <b>{recommendation.name}</b>
                </text>
                <text fg={t.textMuted}>{recommendation.reason}</text>
                <text fg={t.textMuted}>{`Approx. ${recommendation.estimatedMemoryGb.toFixed(1)} GB memory`}</text>
                <text fg={t.textMuted}>Downloaded from Hugging Face</text>
              </box>
            ) : null}
          </box>
        </box>
        <box flexGrow={1} minHeight={0} />
        {progress.state === "onboarding" ? (
          <box flexDirection="row" gap={1} marginTop={1}>
            {onInstall ? (
              <StartupAction
                t={t}
                label={
                  canInstall
                    ? "Install recommended · enter"
                    : canBootstrapRuntime
                      ? "Prepare engine · enter"
                      : "Try again · enter"
                }
                onPress={onInstall}
                disabled={installing}
                highlighted
              />
            ) : null}
            <StartupAction t={t} label="Scan again · r" onPress={onRetry} />
            <StartupAction t={t} label="Exit · esc" onPress={onExit} />
          </box>
        ) : failed ? (
          <box flexDirection="column" marginTop={1}>
            <text fg={progress.state === "fatal-error" ? t.danger : t.brand}>
              {installing
                ? "Preparing your local model..."
                : progress.detail || "Shelra could not prepare a local model."}
            </text>
            <box flexDirection="row" gap={1} marginTop={1}>
              {!installing ? <StartupAction t={t} label="Scan again · r" onPress={onRetry} /> : null}
              <StartupAction t={t} label="Exit · esc" onPress={onExit} />
            </box>
          </box>
        ) : null}
        <box height={1} />
        <text fg={t.textDim}>
          {progress.state === "ready"
            ? "Local model ready · chat opens next"
            : "No account, API key, or remote provider is required"}
        </text>
      </box>
    </box>
  );
}

export function CloudStartupScreen({
  progress,
  onRetry,
  onExit,
}: {
  progress: StartupProgress;
  onRetry: () => void;
  onExit: () => void;
}) {
  const { width, height } = useTerminalDimensions();
  const t = resolveTheme();
  const failed = progress.state === "recoverable-error" || progress.state === "fatal-error";
  const panelWidth = Math.min(92, Math.max(58, width - 6));
  const panelHeight = Math.min(Math.max(16, height - 5), 24);
  return (
    <box width={width} height={height} backgroundColor={t.background} alignItems="center" justifyContent="center">
      <box
        width={panelWidth}
        height={panelHeight}
        border={["top", "bottom", "left", "right"]}
        borderStyle="single"
        borderColor={t.border}
        paddingLeft={3}
        paddingRight={3}
        paddingTop={1}
        flexDirection="column"
      >
        <box flexDirection="row" justifyContent="space-between">
          <text fg={t.primary}>
            <b>{PRODUCT_NAME}</b>
          </text>
          <SectionBadge t={t} label="Cloud" />
        </box>
        <text fg={t.textMuted}>OpenRouter Free is the primary model route.</text>
        <box height={2} />
        <text fg={t.brand}>{progress.message}</text>
        {progress.detail ? <text fg={t.textMuted}>{progress.detail}</text> : null}
        {progress.state === "detecting-models" ? (
          <text fg={t.textMuted}>Discovering current models, prices, context and tool capabilities...</text>
        ) : null}
        <box flexGrow={1} minHeight={0} />
        {failed ? (
          <box flexDirection="column">
            <text fg={t.danger}>{progress.detail || "OpenRouter could not be prepared."}</text>
            <box flexDirection="row" gap={1} marginTop={1}>
              <StartupAction t={t} label="Retry · r" onPress={onRetry} highlighted />
              <StartupAction t={t} label="Exit · esc" onPress={onExit} />
            </box>
          </box>
        ) : (
          <box flexDirection="row" gap={1}>
            <StartupAction t={t} label="Exit · esc" onPress={onExit} />
          </box>
        )}
        <box height={1} />
        <text fg={t.textDim}>Use --local only for explicit offline/private local inference.</text>
      </box>
    </box>
  );
}
