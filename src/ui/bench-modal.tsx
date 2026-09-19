import type { ScrollBoxRenderable } from "@opentui/core";
import { useEffect, useRef } from "react";
import type {
  BenchmarkBehavior,
  BenchmarkDimension,
  BenchmarkJsonObject,
  BenchmarkLeaderboardEntry,
  BenchmarkRunComparison,
  BenchmarkRunDetails,
  BenchmarkRunSummary,
  BenchmarkTaskResult,
} from "../bench/types";
import { scrollbarStyle, type Theme } from "./theme";

export type BenchView = "leaderboard" | "history" | "trend" | "compare" | "tasks" | "live";
export type BenchTrendMetric = BenchmarkDimension | "cost" | "duration";

export interface BenchLiveSnapshot {
  run: BenchmarkRunSummary;
  currentTaskId?: string | null;
  currentTaskLabel?: string | null;
  passed: number;
  failed: number;
  running: number;
  elapsedMs: number;
}

export interface BenchModalProps {
  t: Theme;
  width: number;
  height: number;
  view: BenchView;
  leaderboard: BenchmarkLeaderboardEntry[];
  runs: BenchmarkRunSummary[];
  selectedIndex: number;
  selectedRun: BenchmarkRunSummary | null;
  details: BenchmarkRunDetails | null;
  comparison: BenchmarkRunComparison | null;
  baseline: BenchmarkRunSummary | null;
  filter: string;
  filterActive: boolean;
  trendDimension: BenchTrendMetric;
  loading: boolean;
  error: string | null;
  live: BenchLiveSnapshot | null;
}

export function BenchModal({
  t,
  width,
  height,
  view,
  leaderboard,
  runs,
  selectedIndex,
  selectedRun,
  details,
  comparison,
  baseline,
  filter,
  filterActive,
  trendDimension,
  loading,
  error,
  live,
}: BenchModalProps) {
  const listRef = useRef<ScrollBoxRenderable>(null);
  const didMountRef = useRef(false);
  const selectedId = selectedRun?.runId;

  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    if (selectedId) listRef.current?.scrollChildIntoView(`bench-run-${selectedId}`);
  }, [selectedId]);

  const panelWidth = Math.min(118, Math.max(40, width - 4));
  const panelHeight = Math.max(16, height - 4);
  const content = renderView({
    t,
    view,
    leaderboard,
    runs,
    selectedIndex,
    selectedRun,
    details,
    comparison,
    baseline,
    trendDimension,
    live,
    listRef,
  });

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={width}
      height={height}
      alignItems="center"
      paddingTop={2}
      backgroundColor={t.overlay}
    >
      <box
        width={panelWidth}
        height={panelHeight}
        backgroundColor={t.backgroundPanel}
        border={["top", "right", "bottom", "left"]}
        borderStyle="rounded"
        borderColor={t.borderStrong}
        paddingTop={1}
        paddingBottom={1}
        flexDirection="column"
      >
        <box flexShrink={0} flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2}>
          <text fg={t.primary}>
            <b>{"Shelra Bench"}</b>
            <span style={{ fg: t.textMuted }}>{"  /  Coding Agent Benchmark"}</span>
          </text>
          <text fg={t.textMuted}>{"esc close"}</text>
        </box>
        <box flexShrink={0} paddingLeft={2} paddingRight={2} paddingTop={1}>
          <text fg={t.textSecondary}>{"Real tasks. Real execution. Real verification."}</text>
        </box>
        <box flexShrink={0} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
          <text fg={t.textMuted}>
            {tabLabel("1", "leaderboard", view, t)}
            {"  "}
            {tabLabel("2", "history", view, t)}
            {"  "}
            {tabLabel("3", "trend", view, t)}
            {"  "}
            {tabLabel("4", "compare", view, t)}
            {"  "}
            {tabLabel("5", "tasks", view, t)}
            {"  "}
            {tabLabel("6", "live", view, t)}
          </text>
        </box>
        <box flexShrink={0} paddingLeft={2} paddingRight={2} flexDirection="row" justifyContent="space-between">
          <text fg={filterActive ? t.accent : t.textMuted}>
            {filterActive ? "/" : "filter: "}
            {filter || (filterActive ? "" : "Shelra · compatible runs")}
            {filterActive ? "▌" : ""}
          </text>
          <text fg={loading ? t.accent : t.textMuted}>
            {loading ? "loading…" : "j/k move · enter inspect · r refresh"}
          </text>
        </box>
        <scrollbox scrollbarOptions={scrollbarStyle(t)} ref={listRef} flexGrow={1} minHeight={0} paddingTop={1}>
          {error ? (
            <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
              <text fg={t.danger}>{`Bench data unavailable: ${error}`}</text>
            </box>
          ) : null}
          {content}
        </scrollbox>
        <box flexShrink={0} paddingLeft={2} paddingRight={2} paddingTop={1}>
          <text fg={t.textDim}>
            {"b baseline  c compare  s metric  / search  "}
            <span style={{ fg: t.textMuted }}>
              {"Model is a controlled variable; Shelra harness evolution is primary."}
            </span>
          </text>
        </box>
      </box>
    </box>
  );
}

type BenchViewInput = {
  t: Theme;
  view: BenchView;
  leaderboard: BenchmarkLeaderboardEntry[];
  runs: BenchmarkRunSummary[];
  selectedIndex: number;
  selectedRun: BenchmarkRunSummary | null;
  details: BenchmarkRunDetails | null;
  comparison: BenchmarkRunComparison | null;
  baseline: BenchmarkRunSummary | null;
  trendDimension: BenchTrendMetric;
  live: BenchLiveSnapshot | null;
  listRef: React.RefObject<ScrollBoxRenderable | null>;
};

function renderView(input: BenchViewInput) {
  switch (input.view) {
    case "leaderboard":
      return <LeaderboardView {...input} />;
    case "history":
      return <HistoryView {...input} />;
    case "trend":
      return <TrendView {...input} />;
    case "compare":
      return <CompareView {...input} />;
    case "tasks":
      return <TasksView {...input} />;
    case "live":
      return <LiveView {...input} />;
  }
}

function LeaderboardView({
  t,
  leaderboard,
  runs,
  baseline,
}: Pick<BenchViewInput, "t" | "leaderboard" | "runs" | "baseline">) {
  const completedRuns = runs.filter(
    (run) => run.leaderboardEligible && run.status === "completed" && typeof run.scores.overall === "number",
  );
  const latest = completedRuns[0] ?? null;
  const previous = completedRuns[1] ?? null;
  const best = completedRuns.sort((a, b) => (b.scores.overall ?? -1) - (a.scores.overall ?? -1))[0];
  return (
    <>
      <EvolutionStrip
        t={t}
        latest={latest}
        previous={previous}
        baseline={baseline}
        best={best ?? null}
        comparable={latest !== null && previous !== null && sameComparisonScope(latest, previous)}
      />
      <SectionLabel
        t={t}
        label="Shelra harness configurations"
        detail="Only explicitly eligible suites enter ranking; model/provider stay visible as controlled variables"
      />
      <TableHeader t={t} columns={["#", "harness / model", "overall", "intent", "verify", "cost", "time", "commit"]} />
      {leaderboard.length === 0 ? (
        <EmptyState
          t={t}
          message="No completed Shelra runs yet."
          detail="Run a certified suite to enter the leaderboard; diagnostics remain available in History."
        />
      ) : null}
      {leaderboard.map((entry, index) => (
        <box key={entry.runId} paddingLeft={2} paddingRight={2}>
          <text fg={index === 0 ? t.accent : t.text}>
            {padRight(String(index + 1), 3)}
            {padRight(`${entry.agentName} ${entry.agentVersion ? `v${entry.agentVersion}` : "v?"}`, 20)}
            {padRight(entry.model ?? "model unavailable", 23)}
            {padLeft(score(entry.scores.overall), 8)}
            {padLeft(score(entry.scores.intent), 8)}
            {padLeft(score(entry.scores.verification), 8)}
            {padLeft(cost(entry.cost), 10)}
            {padLeft(duration(entry.durationMs), 10)}
            {`  ${shortCommit(entry.repositoryCommit)}`}
          </text>
        </box>
      ))}
      <box paddingLeft={2} paddingTop={1}>
        <text fg={t.textMuted}>
          {
            "Latest is not Best. Only explicitly eligible completed suites receive a leaderboard score; diagnostics remain historical evidence."
          }
        </text>
      </box>
    </>
  );
}

function EvolutionStrip({
  t,
  latest,
  previous,
  baseline,
  best,
  comparable,
}: {
  t: Theme;
  latest: BenchmarkRunSummary | null;
  previous: BenchmarkRunSummary | null;
  baseline: BenchmarkRunSummary | null;
  best: BenchmarkRunSummary | null;
  comparable: boolean;
}) {
  const delta =
    latest && previous
      ? comparable
        ? signedDelta(deltaBetween(latest.scores.overall, previous.scores.overall))
        : "N/A (method changed)"
      : "—";
  const baselineDelta =
    latest && baseline
      ? sameComparisonScope(latest, baseline)
        ? signedDelta(deltaBetween(latest.scores.overall, baseline.scores.overall))
        : "N/A (scope changed)"
      : "—";
  return (
    <box
      backgroundColor={t.surfaceRaised}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      flexDirection="column"
    >
      <text fg={t.accent}>
        <b>{"SHELRA EVOLUTION"}</b>
        <span style={{ fg: t.textMuted }}>{"  controlled model, changing harness"}</span>
      </text>
      <text fg={t.text}>
        {`Latest ${score(latest?.scores.overall)}  `}
        <span
          style={{
            fg: !latest || !previous || !comparable ? t.textMuted : delta.startsWith("-") ? t.danger : t.success,
          }}
        >{`(${delta} vs previous)`}</span>
        {`    Previous ${score(previous?.scores.overall)}    Baseline ${score(baseline?.scores.overall)}    Best ${score(best?.scores.overall)}`}
      </text>
      <text
        fg={t.textMuted}
      >{`Resolved ${rate(latest?.resolvedRate)}  ·  previous ${rate(previous?.resolvedRate)}`}</text>
      <text fg={t.textMuted}>{`vs baseline ${baselineDelta}`}</text>
    </box>
  );
}

function HistoryView({ t, runs, selectedIndex, selectedRun, baseline }: BenchViewInput) {
  return (
    <>
      <SectionLabel
        t={t}
        label="Run history"
        detail="Every execution is retained; failed and interrupted runs remain visible"
      />
      {runs.length === 0 ? (
        <EmptyState t={t} message="No benchmark runs found." detail="History is empty until a real run is executed." />
      ) : null}
      {runs.map((run, index) => (
        <box
          key={run.runId}
          id={`bench-run-${run.runId}`}
          backgroundColor={index === selectedIndex ? t.selectedBg : undefined}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={index === 0 ? 0 : 1}
        >
          <box flexDirection="row" justifyContent="space-between">
            <text fg={index === selectedIndex ? t.selected : t.text}>
              {index === selectedIndex ? "› " : "  "}
              <b>{`#${run.runNumber}`}</b>
              {`  ${run.agentName}  ${run.model ?? "model unavailable"}`}
            </text>
            <text fg={statusColor(t, run.status)}>{statusLabel(run.status)}</text>
          </box>
          <text fg={index === selectedIndex ? t.textSecondary : t.textMuted}>
            {`${formatDate(run.createdAt)}  ${run.benchmarkVersion}/${run.suite}  overall ${score(run.scores.overall)}  resolved ${rate(run.resolvedRate)}  intent ${score(run.scores.intent)}  verify ${score(run.scores.verification)}  ${cost(run.cost)}  ${duration(run.durationMs)}  ${shortCommit(run.repositoryCommit)}${run.repositoryDirty ? " *dirty" : ""}`}
          </text>
          {baseline?.runId === run.runId ? <text fg={t.accent}>{"baseline"}</text> : null}
        </box>
      ))}
      {selectedRun ? <RunProvenance t={t} run={selectedRun} /> : null}
    </>
  );
}

function TrendView({ t, runs, trendDimension }: BenchViewInput) {
  const points = [...runs]
    .filter((run) => run.status === "completed")
    .reverse()
    .map((run) => ({ run, value: trendValue(run, trendDimension) }))
    .filter((point): point is { run: BenchmarkRunSummary; value: number } => typeof point.value === "number");
  const values = points.map((point) => point.value);
  const min = values.length > 0 ? Math.min(...values) : 0;
  const max = values.length > 0 ? Math.max(...values) : 100;
  const latest = points.at(-1);
  const previous = points.at(-2);
  const comparable = latest && previous ? sameComparisonScope(latest.run, previous.run) : false;
  const latestDelta = comparable && latest && previous ? latest.value - previous.value : undefined;
  const latestIsRegression =
    latestDelta !== undefined &&
    (trendDimension === "cost" || trendDimension === "duration" ? latestDelta > 0 : latestDelta < 0);
  return (
    <>
      <SectionLabel
        t={t}
        label={`Shelra ${trendDimension} over time`}
        detail="One metric at a time; model changes stay visible and deltas need the same scope"
      />
      {points.length === 0 ? (
        <EmptyState
          t={t}
          message={`No ${trendDimension} scores are available.`}
          detail="The evaluator must persist this dimension before it can be plotted."
        />
      ) : null}
      {points.length > 0 ? (
        <box paddingLeft={2} paddingRight={2} flexDirection="column">
          <text fg={t.accent}>{sparkline(values)}</text>
          <text
            fg={t.textMuted}
          >{`range ${trendLabel(trendDimension, min)}–${trendLabel(trendDimension, max)}  ·  ${points.length} point${points.length === 1 ? "" : "s"}`}</text>
          {latest ? (
            <text fg={latestIsRegression ? t.danger : latestDelta === undefined ? t.textMuted : t.success}>
              {`latest #${latest.run.runNumber} ${trendLabel(trendDimension, latest.value)}  ${
                latestDelta === undefined
                  ? previous
                    ? "N/A (scope changed)"
                    : "· first point"
                  : `Δ ${signedDelta(latestDelta)}`
              }`}
            </text>
          ) : null}
          {points.map(({ run, value }) => (
            <text
              key={run.runId}
              fg={t.textSecondary}
            >{`#${run.runNumber}  ${formatDate(run.createdAt)}  ${run.benchmarkVersion}  ${trendLabel(trendDimension, value)}  ${truncateLine(run.model ?? "model N/A", 30)}  ${shortCommit(run.repositoryCommit)}`}</text>
          ))}
        </box>
      ) : null}
    </>
  );
}

function CompareView({ t, comparison }: BenchViewInput) {
  if (!comparison || comparison.runs.length < 2) {
    return (
      <EmptyState
        t={t}
        message="Select two or more runs to compare."
        detail="In history, press c on each run, then return here."
      />
    );
  }
  return (
    <>
      <SectionLabel
        t={t}
        label="Run comparison"
        detail={
          comparison.comparable ? "Compatible benchmark versions" : (comparison.reason ?? "Not directly comparable")
        }
      />
      <TableHeader t={t} columns={["metric", ...comparison.runs.map((run) => `#${run.runNumber}`), "Δ first"]} />
      {comparison.metrics.map((metric) => (
        <box key={metric.dimension} paddingLeft={2} paddingRight={2}>
          <text fg={metric.deltaFromFirst !== null && metric.deltaFromFirst < 0 ? t.danger : t.text}>
            {padRight(metric.dimension, 18)}
            {metric.values.map((value) => padLeft(score(value ?? undefined), 10)).join("")}
            {padLeft(signedDelta(metric.deltaFromFirst ?? undefined), 10)}
          </text>
        </box>
      ))}
      <box paddingLeft={2} paddingTop={1} flexDirection="column">
        <text fg={comparison.comparable ? t.success : t.textMuted}>
          {comparison.comparable
            ? `Tasks improved  ${comparison.taskChanges.improved.length}`
            : "Task deltas N/A (scope changed)"}
        </text>
        <text fg={comparison.comparable ? t.danger : t.textMuted}>
          {comparison.comparable
            ? `Tasks regressed ${comparison.taskChanges.regressed.length}`
            : "Choose runs with the same harness, suite, version and model."}
        </text>
        <text fg={t.textMuted}>
          {comparison.comparable ? `Unchanged       ${comparison.taskChanges.unchanged.length}` : ""}
        </text>
        <text fg={t.textSecondary}>
          {comparison.comparable
            ? `Cost Δ ${signedMoney(comparison.costDeltaMicros)}  ·  Time Δ ${signedDuration(comparison.durationDeltaMs)}`
            : "Cost Δ N/A  ·  Time Δ N/A"}
        </text>
      </box>
      {comparison.taskChanges.regressed.length > 0 ? (
        <box paddingLeft={2} paddingTop={1}>
          <text fg={t.danger}>{`Regressed: ${comparison.taskChanges.regressed.join(", ")}`}</text>
        </box>
      ) : null}
    </>
  );
}

function TasksView({ t, selectedRun, details }: BenchViewInput) {
  if (!selectedRun)
    return <EmptyState t={t} message="Select a run first." detail="Use history and press enter to inspect it." />;
  const tasks = details?.tasks ?? [];
  return (
    <>
      <SectionLabel
        t={t}
        label={`Task explorer · Run #${selectedRun.runNumber}`}
        detail="Acceptance criteria are persisted individually"
      />
      <RunDetailSummary t={t} run={selectedRun} details={details} />
      {tasks.length === 0 ? (
        <EmptyState
          t={t}
          message="No task results were persisted for this run."
          detail="This can be an interrupted run before its first task completed."
        />
      ) : null}
      {tasks.map((task) => (
        <TaskRow key={task.taskId} t={t} task={task} />
      ))}
      {details ? <RunOperationalEvidence t={t} details={details} /> : null}
    </>
  );
}

function RunDetailSummary({
  t,
  run,
  details,
}: {
  t: Theme;
  run: BenchmarkRunSummary;
  details: BenchmarkRunDetails | null;
}) {
  const tasks = details?.tasks ?? [];
  const criteria = tasks.flatMap((task) => task.acceptance);
  const passedCriteria = criteria.filter((criterion) => criterion.status === "passed").length;
  const failedCriteria = criteria.filter((criterion) => criterion.status === "failed").length;
  const verificationAttempts = sumBehavior(tasks, "verificationAttempts");
  const failuresDetected = sumBehavior(tasks, "failuresDetected");
  const repairsAttempted = sumBehavior(tasks, "repairsAttempted");
  const repairsSucceeded = sumBehavior(tasks, "repairsSucceeded");
  return (
    <box
      backgroundColor={t.surfaceRaised}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      flexDirection="column"
    >
      <text fg={t.text}>
        <b>{`Run #${run.runNumber}  ${statusLabel(run.status)}`}</b>
        {`  ${run.agentName}  ·  ${run.model ?? "model unavailable"}`}
      </text>
      <text
        fg={t.textSecondary}
      >{`overall ${score(run.scores.overall)}  coding ${score(run.scores.coding)}  intent ${score(run.scores.intent)}  verify ${score(run.scores.verification)}`}</text>
      <text
        fg={t.textMuted}
      >{`tasks ${run.completedTaskCount}/${run.taskCount}  ·  resolved ${run.resolvedTaskCount}/${run.taskCount} (${rate(run.resolvedRate)})  ·  criteria ${passedCriteria} pass / ${failedCriteria} fail  ·  ${cost(run.cost)}  ·  ${duration(run.durationMs)}  ·  ${tokenCount(run.tokens.totalTokens)}`}</text>
      <text
        fg={t.textMuted}
      >{`commit ${run.repositoryCommit ?? "unavailable"}${run.repositoryDirty ? " (dirty)" : ""}  ·  events ${details?.events.length ?? 0}  ·  artifacts ${details?.artifacts.length ?? 0}`}</text>
      <text
        fg={t.textMuted}
      >{`behavior  llm ${count(sumBehavior(tasks, "llmCalls"))}  ·  tools ${count(sumBehavior(tasks, "toolCalls"))}  ·  verify ${count(verificationAttempts)}  ·  failures detected ${count(failuresDetected)}  ·  repairs ${count(repairsSucceeded)}/${count(repairsAttempted)}`}</text>
      {failureTypeSummary(tasks).length > 0 ? (
        <text fg={t.textSecondary}>{`failure taxonomy  ${failureTypeSummary(tasks).join("  ·  ")}`}</text>
      ) : null}
      {run.failureType ? <text fg={t.warning}>{`run failure type  ${failureTypeLabel(run.failureType)}`}</text> : null}
      {run.failureReason ? <text fg={t.danger}>{run.failureReason}</text> : null}
    </box>
  );
}

function TaskRow({ t, task }: { t: Theme; task: BenchmarkTaskResult }) {
  const passed = task.acceptance.filter((criterion) => criterion.status === "passed").length;
  const failed = task.acceptance.filter((criterion) => criterion.status === "failed").length;
  return (
    <box paddingLeft={2} paddingRight={2} paddingTop={1} flexDirection="column">
      <box flexDirection="row" justifyContent="space-between">
        <text fg={t.text}>
          <b>{task.taskId}</b>
          {`  ${task.category} · ${task.difficulty}`}
        </text>
        <text fg={statusColor(t, task.status)}>{`${statusLabel(task.status)}  ${score(task.scores.intent)}`}</text>
      </box>
      {task.definition?.prompt ? (
        <text fg={t.textSecondary}>{`Request  ${truncateLine(task.definition.prompt, 110)}`}</text>
      ) : null}
      <text
        fg={t.textMuted}
      >{`${passed} acceptance pass  ${failed} fail  · ${cost(task.cost)} · ${duration(task.durationMs)} · ${task.behavior.verificationAttempts ?? 0} verification attempt(s) · ${task.behavior.repairsAttempted ?? 0} repair(s)`}</text>
      {task.failureType ? <text fg={t.warning}>{`failure type  ${failureTypeLabel(task.failureType)}`}</text> : null}
      {task.failureReason ? <text fg={t.danger}>{task.failureReason}</text> : null}
      {task.acceptance.map((criterion) => (
        <text
          key={criterion.id}
          fg={criterion.status === "passed" ? t.success : criterion.status === "failed" ? t.danger : t.warning}
        >
          {`${criterion.status === "passed" ? "✓" : criterion.status === "failed" ? "×" : "·"} ${criterion.id} ${criterion.description}`}
        </text>
      ))}
    </box>
  );
}

function RunOperationalEvidence({ t, details }: { t: Theme; details: BenchmarkRunDetails }) {
  const events = details.events.slice(-12);
  return (
    <>
      <SectionLabel
        t={t}
        label="Operational evidence"
        detail="Structured events and artifact references; no private reasoning"
      />
      {events.length === 0 ? <text fg={t.textMuted}>{"No structured events were recorded."}</text> : null}
      {events.map((event) => (
        <text key={`${event.runId}:${event.sequence}`} fg={event.type === "error" ? t.danger : t.textMuted}>
          {`#${event.sequence}  ${formatDate(event.at)}  ${event.taskId ?? "run"}  ${event.type}  ${truncateLine(event.message, 92)}`}
        </text>
      ))}
      {details.artifacts.length > 0 ? (
        <box paddingTop={1} flexDirection="column">
          <text fg={t.textSecondary}>{"Artifacts"}</text>
          {details.artifacts.slice(0, 12).map((artifact) => (
            <text key={`${artifact.kind}:${artifact.path}:${artifact.sha256 ?? ""}`} fg={t.textMuted}>
              {`${artifact.kind}  ${truncateLine(artifact.label ?? artifact.path, 104)}`}
            </text>
          ))}
        </box>
      ) : null}
    </>
  );
}

function LiveView({ t, live }: BenchViewInput) {
  if (!live)
    return <EmptyState t={t} message="No benchmark is running." detail="Live mode shows only an actual active run." />;
  const total = live.run.taskCount;
  const complete = live.passed + live.failed;
  return (
    <>
      <SectionLabel
        t={t}
        label={`Live run #${live.run.runNumber}`}
        detail={`${live.run.agentName} · ${live.run.suite} · ${live.run.benchmarkVersion}`}
      />
      <box
        backgroundColor={t.surfaceRaised}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        flexDirection="column"
      >
        <text fg={t.accent}>{progressBar(complete, total, 42)}</text>
        <text
          fg={t.text}
        >{`${complete} / ${total} tasks  ·  passed ${live.passed}  ·  failed ${live.failed}  ·  running ${live.running}`}</text>
        <text fg={t.textMuted}>{`elapsed ${formatDuration(live.elapsedMs)}  ·  cost ${cost(live.run.cost)}`}</text>
        {live.currentTaskId ? (
          <text
            fg={t.textSecondary}
          >{`Current  ${live.currentTaskId}${live.currentTaskLabel ? `  ${truncateLine(live.currentTaskLabel, 90)}` : ""}`}</text>
        ) : null}
      </box>
    </>
  );
}

function RunProvenance({ t, run }: { t: Theme; run: BenchmarkRunSummary }) {
  return (
    <box paddingLeft={2} paddingRight={2} paddingTop={1} flexDirection="column">
      <text fg={t.textSecondary}>{`Run #${run.runNumber} provenance`}</text>
      <text fg={run.leaderboardEligible ? t.success : t.warning}>
        {run.leaderboardEligible ? "leaderboard eligible" : "diagnostic only · not ranked"}
      </text>
      <text
        fg={t.textMuted}
      >{`${run.agentName} ${run.agentVersion ? `v${run.agentVersion}` : "version unavailable"}  ·  ${run.model ?? "model unavailable"}  ·  ${run.modelProvider ?? "provider unavailable"}`}</text>
      <text
        fg={t.textMuted}
      >{`${run.benchmarkVersion}/${run.suite}  ·  commit ${run.repositoryCommit ?? "unavailable"}${run.repositoryDirty ? " (dirty)" : ""}  ·  ${run.workspacePath}`}</text>
      <text fg={t.textMuted}>{`${scorePolicyLabel(run.benchmarkConfig)}  ·  seed ${run.seed ?? "not set"}`}</text>
    </box>
  );
}

function SectionLabel({ t, label, detail }: { t: Theme; label: string; detail: string }) {
  return (
    <box paddingLeft={2} paddingTop={1} paddingBottom={1}>
      <text fg={t.accent}>
        <b>{label}</b>
        <span style={{ fg: t.textMuted }}>{`  ${detail}`}</span>
      </text>
    </box>
  );
}

function TableHeader({ t, columns }: { t: Theme; columns: string[] }) {
  return (
    <box paddingLeft={2} paddingRight={2}>
      <text fg={t.textMuted}>
        {columns
          .map((column, index) =>
            index === 0
              ? padRight(column.toUpperCase(), 3)
              : index === 1
                ? padRight(column.toUpperCase(), 43)
                : padLeft(column.toUpperCase(), 10),
          )
          .join("")}
      </text>
    </box>
  );
}

function EmptyState({ t, message, detail }: { t: Theme; message: string; detail: string }) {
  return (
    <box paddingLeft={2} paddingTop={2} paddingBottom={2} flexDirection="column">
      <text fg={t.textSecondary}>{message}</text>
      <text fg={t.textMuted}>{detail}</text>
    </box>
  );
}

function tabLabel(key: string, label: BenchView, current: BenchView, t: Theme) {
  return <span style={{ fg: current === label ? t.accent : t.textMuted }}>{`[${key}] ${label}`}</span>;
}

function statusLabel(status: BenchmarkRunSummary["status"] | BenchmarkTaskResult["status"]): string {
  switch (status) {
    case "completed":
    case "passed":
      return "PASS";
    case "running":
    case "preparing":
    case "verifying":
      return "RUN";
    case "queued":
      return "QUEUE";
    case "failed":
      return "FAIL";
    case "interrupted":
      return "INTERRUPTED";
    case "cancelled":
      return "CANCELLED";
    case "invalid":
      return "INVALID";
    case "skipped":
      return "SKIP";
  }
}

function statusColor(t: Theme, status: BenchmarkRunSummary["status"] | BenchmarkTaskResult["status"]): string {
  if (status === "completed" || status === "passed") return t.success;
  if (status === "failed" || status === "invalid") return t.danger;
  if (status === "interrupted" || status === "cancelled") return t.warning;
  return t.info;
}

function score(value: number | undefined | null): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(1) : "—";
}

function signedDelta(value: number | undefined | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function deltaBetween(current: number | undefined, previous: number | undefined): number | undefined {
  return typeof current === "number" && typeof previous === "number" ? current - previous : undefined;
}

function trendValue(run: BenchmarkRunSummary, metric: BenchTrendMetric): number | undefined {
  if (metric === "cost") return run.cost.micros === null ? undefined : run.cost.micros / 1_000_000;
  if (metric === "duration") return run.durationMs === null ? undefined : run.durationMs / 1_000;
  return run.scores[metric];
}

function trendLabel(metric: BenchTrendMetric, value: number): string {
  if (metric === "cost") return `$${value.toFixed(3)}`;
  if (metric === "duration") return formatDuration(value * 1_000);
  return value.toFixed(1);
}

function sameComparisonScope(first: BenchmarkRunSummary, second: BenchmarkRunSummary): boolean {
  return (
    first.agentName === second.agentName &&
    first.configurationFingerprint === second.configurationFingerprint &&
    first.benchmarkVersion === second.benchmarkVersion &&
    first.suite === second.suite &&
    first.model === second.model &&
    first.modelProvider === second.modelProvider &&
    first.modelVersion === second.modelVersion
  );
}

function cost(value: BenchmarkRunSummary["cost"] | BenchmarkTaskResult["cost"]): string {
  if (value.micros === null) return "cost N/A";
  const label = `$${(value.micros / 1_000_000).toFixed(3)}`;
  return value.kind === "estimated" ? `${label} est.` : label;
}

function tokenCount(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "tokens N/A";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M tokens`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K tokens`;
  return `${Math.round(value)} tokens`;
}

function rate(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "N/A";
}

function duration(value: number | null | undefined): string {
  if (value === null || value === undefined) return "time N/A";
  return formatDuration(value);
}

function formatDuration(value: number): string {
  const totalSeconds = Math.max(0, Math.round(value / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}

function count(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(Math.round(value)) : "N/A";
}

function failureTypeSummary(tasks: readonly BenchmarkTaskResult[]): string[] {
  const counts = new Map<NonNullable<BenchmarkTaskResult["failureType"]>, number>();
  for (const task of tasks) {
    if (task.failureType) counts.set(task.failureType, (counts.get(task.failureType) ?? 0) + 1);
  }
  return [...counts.entries()].map(([type, total]) => `${failureTypeLabel(type)} ${total}`);
}

function failureTypeLabel(type: NonNullable<BenchmarkTaskResult["failureType"]>): string {
  return type.replaceAll("_", " ");
}

function sumBehavior(tasks: readonly BenchmarkTaskResult[], key: keyof BenchmarkBehavior): number | null {
  let total = 0;
  let found = false;
  for (const task of tasks) {
    const value = task.behavior[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      total += value;
      found = true;
    }
  }
  return found ? total : null;
}

function signedMoney(value: number | null): string {
  if (value === null) return "N/A";
  const amount = value / 1_000_000;
  return `${amount > 0 ? "+" : ""}$${amount.toFixed(3)}`;
}

function signedDuration(value: number | null): string {
  if (value === null) return "N/A";
  return `${value > 0 ? "+" : value < 0 ? "-" : ""}${formatDuration(Math.abs(value))}`;
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function shortCommit(value: string | null): string {
  return value ? value.slice(0, 8) : "commit N/A";
}

function scorePolicyLabel(config: BenchmarkJsonObject): string {
  const raw = config.scorePolicy;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return "score policy N/A";
  const id = typeof raw.id === "string" ? raw.id : "unnamed";
  const version = typeof raw.version === "string" ? raw.version : "unversioned";
  return `score policy ${id} v${version}`;
}

function truncateLine(value: string, width: number): string {
  return value.length <= width ? value : `${value.slice(0, Math.max(0, width - 1))}…`;
}

function padRight(value: string, width: number): string {
  return value.length >= width ? `${value.slice(0, Math.max(0, width - 1))}…` : value.padEnd(width, " ");
}

function padLeft(value: string, width: number): string {
  return value.length >= width ? value : value.padStart(width, " ");
}

function sparkline(values: number[]): string {
  const glyphs = "▁▂▃▄▅▆▇█";
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  return values
    .map(
      (value) =>
        glyphs[
          Math.max(
            0,
            Math.min(
              glyphs.length - 1,
              max === min ? glyphs.length - 1 : Math.round(((value - min) / (max - min)) * (glyphs.length - 1)),
            ),
          )
        ],
    )
    .join("");
}

function progressBar(value: number, total: number, width: number): string {
  const ratio = total > 0 ? Math.max(0, Math.min(1, value / total)) : 0;
  const filled = Math.round(ratio * width);
  return `${"█".repeat(filled)}${"░".repeat(Math.max(0, width - filled))}  ${Math.round(ratio * 100)}%`;
}
