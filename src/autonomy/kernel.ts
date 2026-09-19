import { randomUUID } from "node:crypto";
import type {
  BrowserObservation,
  CommandOutcome,
  DomAssertion,
  FileChange,
  HttpProbe,
  ManagedProcess,
  ProcessStartOptions,
} from "../exec/types";
import { commandSucceeded, summarizeCommand } from "../exec/types";
import type { IntelligenceProvider } from "../intelligence/types";
import { emptyLedger, recordUsage } from "../intelligence/types";
import { type AcceptanceDeps, evaluateAcceptance, failingRequired, failureFingerprint } from "./acceptance";
import { renderFailureContext, renderTaskContext, renderTree, scanWorkspace } from "./context";
import { ExecutionJournal, objectiveRunDir } from "./journal";
import {
  CHANGESET_SCHEMA,
  CRITERIA_SCHEMA,
  DIAGNOSIS_SCHEMA,
  narrowCriteria,
  PLAN_SCHEMA,
  type RawCriterion,
  SYSTEM_DIAGNOSE,
  SYSTEM_IMPLEMENT,
  SYSTEM_INTERPRET,
  SYSTEM_PLAN,
} from "./prompts";
import {
  type AcceptanceCriterion,
  type Action,
  type CheckSpec,
  type ExecutableSpecification,
  type Objective,
  type ObjectiveOutcome,
  type ObjectivePhase,
  PHASE_LABELS,
  type RepairAttempt,
  type StopReason,
  type Task,
  type VerificationReport,
} from "./types";

/**
 * The autonomy kernel.
 *
 * This is the loop that makes an objective finish. It owns the decision about what happens
 * next, calls intelligence only for the steps that genuinely need judgement, executes
 * everything else deterministically, and refuses to declare completion until the
 * verification engine agrees.
 *
 * Ordinary engineering failures — a failing build, a 500, a missing import — are not
 * terminal here. They are the input to the next cycle. The runtime only stops for the
 * reasons enumerated in `StopReason`.
 *
 * DELIBERATELY SEPARATE FROM `src/agent/agent.ts` + `src/agent/kernel.ts` (docs/architecture/
 * 14-AGENT-HARNESS-RECONSTRUCTION.md §2.1, §14 Phase 0). This is not neglected duplication —
 * it is a different product for a different mode: an unattended, single-command, one-shot
 * objective runner (`shelra --autonomous`), versus `agent.ts`'s interactive, tool-calling,
 * multi-turn chat loop. Verified by tracing the real call path (2026-09-13): `--autonomous`
 * never calls `Agent.processMessage()` — `src/index.ts`'s `runAutonomousHeadless` only uses
 * `Agent` to resolve a provider/model, then hands off entirely to `runObjective()` (this
 * file's `KernelDeps`, wired in `src/autonomy/runtime.ts#createKernelDeps` to raw primitives:
 * `runCommand`, `applyFileWrite`/`applyFileEdit`/`deleteFile` from `../exec/files`,
 * `observePage` from `../exec/browser`). Its own verification design — a deterministic
 * `CheckSpec` union with an explicitly-flagged `modelJudged: true` escape hatch — is arguably
 * *more* rigorous than `agent.ts`'s heuristic evidence detector, not a worse copy of it.
 *
 * Concretely, this means an `--autonomous` run does NOT get anything added to the interactive
 * path since (docs §9-§13): no completion/verification gate, no checkpoint/revert (file
 * mutations here — `applyFileWrite` et al. — are never snapshotted, so there is no `/revert`
 * for an autonomous run today), no `memory_write`/`memory_list`/`memory_read` tools, no
 * delegated-verification-evidence credit, no raised verification-retry ceiling, no
 * reasoning-effort control, no shell/OS-awareness fix. Anyone extending one path should check
 * whether the other needs the same fix rather than assuming they share plumbing — they don't.
 */

export interface RuntimeEvent {
  type: "phase" | "detail" | "specification" | "plan" | "task" | "verification" | "complete";
  phase?: ObjectivePhase;
  /** Short user-facing line, already plain-language. */
  message: string;
  /** Emitted as soon as intent has become an executable contract. */
  specification?: ExecutableSpecification;
  /** Initial ordered work list, including the criteria each task advances. */
  plan?: Task[];
  /** A point-in-time task status update. */
  task?: Task;
  report?: VerificationReport;
  outcome?: ObjectiveOutcome;
}

/** Everything the kernel needs from the outside world. All side effects arrive through here. */
export interface KernelDeps {
  intelligence: IntelligenceProvider;
  runCommand(
    command: string,
    options: { cwd: string; timeoutMs?: number; signal?: AbortSignal; env?: Record<string, string> },
  ): Promise<CommandOutcome>;
  writeFile(workspace: string, path: string, content: string): Promise<FileChange>;
  editFile(workspace: string, path: string, oldText: string, newText: string): Promise<FileChange>;
  deleteFile(workspace: string, path: string): Promise<FileChange>;
  startProcess(options: ProcessStartOptions): Promise<ManagedProcess>;
  stopProcess(id: string): Promise<void>;
  probeHttp(url: string): Promise<HttpProbe>;
  observePage(
    url: string,
    options: { viewport: { width: number; height: number }; assertions: DomAssertion[]; screenshotPath?: string },
  ): Promise<BrowserObservation>;
  /** Serves a directory of static files and resolves to its base URL. Used when a project has no dev server. */
  serveStatic(dir: string): Promise<ManagedProcess>;
  /**
   * Called every time the objective's durable state changes (phase, stop reason, tasks).
   * This is the kernel's only hook into cross-run/cross-session indexing (see
   * `docs/architecture/14-AGENT-HARNESS-RECONSTRUCTION.md` §5-6) — the kernel stays free of any
   * storage import; the composition root in `runtime.ts` decides what "change" means to persist.
   */
  onObjectiveChange?(objective: Objective): void;
}

export interface KernelOptions {
  workspace: string;
  request: string;
  signal?: AbortSignal;
  /** Hard ceiling on repair cycles before the runtime reports an honest blocker. */
  maxRepairAttempts?: number;
  /** Stop spending once intelligence has cost this much. Absent means no cap. */
  maxCostUsd?: number;
  /** Per-intelligence-call ceiling. Zero is strict zero-cost for that call. */
  maxRequestCostUsd?: number;
  /** Bounded, host-collected external research; never treated as executable instructions. */
  researchContext?: string;
  /** Immutable benchmark-owned checks. When present, model-derived criteria are ignored. */
  acceptanceCriteria?: AcceptanceCriterion[];
  /** Repository root used to resolve benchmark-owned oracle commands. */
  benchmarkRoot?: string;
  maxTaskAttempts?: number;
}

interface ChangeSet {
  summary: string;
  files: Array<{
    path: string;
    action: "write" | "edit" | "delete";
    content?: string;
    oldText?: string;
    newText?: string;
  }>;
  commands?: Array<{ command: string; why: string }>;
  startCommand?: string;
}

interface Diagnosis extends ChangeSet {
  rootCause: string;
  strategy: string;
  confident: boolean;
}

function validateChangeSet(changes: ChangeSet): string | undefined {
  if (!changes || !Array.isArray(changes.files)) return "The model did not return a file change list.";
  for (const [index, file] of changes.files.entries()) {
    if (!file || typeof file.path !== "string" || !file.path.trim()) {
      return `File change ${index + 1} has no path.`;
    }
    if (file.action === "write") {
      if (typeof file.content !== "string" || file.content.trim().length === 0) {
        return `Write for ${file.path} did not include non-empty complete content.`;
      }
    } else if (file.action === "edit") {
      if (typeof file.oldText !== "string" || file.oldText.length === 0) {
        return `Edit for ${file.path} did not include the exact oldText to replace.`;
      }
      if (typeof file.newText !== "string") return `Edit for ${file.path} did not include newText.`;
    } else if (file.action !== "delete") {
      return `File change ${index + 1} has an unsupported action.`;
    }
  }
  for (const [index, command] of (changes.commands ?? []).entries()) {
    if (!command || typeof command.command !== "string" || !command.command.trim()) {
      return `Command ${index + 1} is empty.`;
    }
  }
  return undefined;
}

function normalizeCriterionId(value: string): string {
  return value.trim().replace(/^\[|\]$/gu, "");
}

function taskSnapshot(task: Task): Task {
  return { ...task, satisfies: [...task.satisfies] };
}

const DEFAULT_MAX_REPAIRS = 6;
/** How many times an identical failure may recur before the runtime concludes it is stuck. */
const IDENTICAL_FAILURE_LIMIT = 3;

export class AutonomyKernel {
  private readonly objective: Objective;
  private readonly journal: ExecutionJournal;
  private readonly deps: KernelDeps;
  private readonly options: Required<Pick<KernelOptions, "maxRepairAttempts" | "maxTaskAttempts">> & KernelOptions;
  private readonly startedAt = Date.now();
  private appProcessId?: string;
  private detectedStartCommand?: string;

  constructor(deps: KernelDeps, options: KernelOptions) {
    this.deps = deps;
    this.options = {
      ...options,
      maxRepairAttempts: options.maxRepairAttempts ?? DEFAULT_MAX_REPAIRS,
      maxTaskAttempts: Math.max(1, options.maxTaskAttempts ?? 2),
    };
    const id = randomUUID().replace(/-/gu, "").slice(0, 12);
    const runDir = objectiveRunDir(options.workspace, id);
    this.journal = new ExecutionJournal(runDir);
    this.objective = {
      id,
      request: options.request,
      workspace: options.workspace,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      phase: "interpreting",
      requirements: [],
      acceptance: cloneAcceptanceCriteria(options.acceptanceCriteria),
      plan: [],
      actions: [],
      observations: [],
      verifications: [],
      repairs: [],
      app: { ready: false },
      ledger: emptyLedger(),
      runDir,
    };
  }

  getObjective(): Objective {
    return this.objective;
  }

  /** Drives the objective to a stop condition, yielding progress the UI can render. */
  async *run(): AsyncGenerator<RuntimeEvent, void, void> {
    this.journal.record("objective_started", this.objective.request, { workspace: this.objective.workspace });

    try {
      yield* this.phase("interpreting");
      const understood = await this.interpret();
      if (!understood) {
        yield* this.finish("impossible_environment", "Could not interpret the objective into checkable requirements.");
        return;
      }
      this.persistState();
      yield {
        type: "specification",
        message: `Specification ready: ${this.objective.requirements.length} requirement(s), ${this.objective.acceptance.length} acceptance criteria`,
        specification: {
          goal: this.objective.request,
          requirements: [...this.objective.requirements],
          acceptance: this.objective.acceptance.map((criterion) => ({
            ...criterion,
            check: { ...criterion.check },
          })),
        },
      };

      yield* this.phase("planning");
      await this.buildPlan();
      this.persistState();
      yield {
        type: "plan",
        message: `Execution plan ready: ${this.objective.plan.length} task(s)`,
        plan: this.objective.plan.map(taskSnapshot),
      };

      yield* this.phase("implementing");
      for (const task of this.objective.plan) {
        if (this.cancelled()) {
          yield* this.finish("user_cancelled", "Cancelled.");
          return;
        }
        let completed = false;
        for (let attempt = 0; attempt < this.options.maxTaskAttempts; attempt += 1) {
          yield {
            type: "task",
            message:
              attempt === 0 ? `Starting ${task.id}: ${task.description}` : `Retrying ${task.id}: ${task.description}`,
            task: { ...taskSnapshot(task), status: "active", attempts: task.attempts + 1 },
          };
          await this.executeTask(task);
          this.persistState();
          yield {
            type: "task",
            message: `${task.id} ${task.status}: ${task.description}${task.lastError ? ` (${task.lastError})` : ""}`,
            task: taskSnapshot(task),
          };
          if (task.status === "done") {
            completed = true;
            break;
          }
        }
        if (!completed) yield this.detail(`Task did not produce an actionable change: ${task.description}`);
      }

      // Verify, then repair, then verify again, until the gate opens or we run out of
      // materially different things to try.
      let attempt = 0;
      let repairs = 0;
      const fingerprintCounts = new Map<string, number>();

      while (true) {
        if (this.cancelled()) {
          yield* this.finish("user_cancelled", "Cancelled.");
          return;
        }
        if (this.overBudget()) {
          yield* this.finish("retry_exhausted", "Stopped: intelligence budget for this objective was exhausted.");
          return;
        }

        attempt += 1;
        yield* this.phase("running");
        await this.ensureAppRunning();
        if (this.objective.app.url) yield this.detail(`Application serving at ${this.objective.app.url}`);
        await this.runDeclaredSelfChecks();

        yield* this.phase("verifying");
        const report = await this.verify(attempt);
        this.objective.verifications.push(report);
        this.journal.recordVerification(report);
        yield { type: "verification", message: this.describeReport(report), report };

        if (report.passed) {
          yield* this.finish("verified_success", "All acceptance criteria passed.");
          return;
        }

        const failures = failingRequired(report, this.objective.acceptance);
        const fingerprint = failureFingerprint(failures);
        const seen = (fingerprintCounts.get(fingerprint) ?? 0) + 1;
        fingerprintCounts.set(fingerprint, seen);

        if (repairs >= this.options.maxRepairAttempts) {
          yield* this.finish(
            "retry_exhausted",
            `Stopped after ${repairs} repair attempts. Unresolved: ${failures.map((f) => f.id).join(", ")}`,
          );
          return;
        }
        if (seen > IDENTICAL_FAILURE_LIMIT) {
          // Repeating the same failure means the current line of attack is dead.
          yield* this.finish(
            "retry_exhausted",
            `Stopped: the same failure recurred ${seen} times despite different repair strategies (${failures
              .map((f) => f.id)
              .join(", ")}).`,
          );
          return;
        }

        repairs += 1;
        yield* this.phase("diagnosing");
        yield this.detail(
          failures
            .map((f) => f.description)
            .join("; ")
            .slice(0, 160),
        );

        const repaired = await this.repair(failures, repairs, fingerprint, seen);
        if (!repaired) {
          yield* this.finish(
            "retry_exhausted",
            "Stopped: no further repair could be derived from the available evidence.",
          );
          return;
        }
        yield* this.phase("repairing");
        yield this.detail(repaired.strategy);
      }
    } catch (err) {
      this.objective.blocker = err instanceof Error ? err.message : String(err);
      yield* this.finish("impossible_environment", `Stopped: ${this.objective.blocker}`);
    } finally {
      await this.cleanup();
      this.journal.saveState(this.objective);
      this.deps.onObjectiveChange?.(this.objective);
    }
  }

  // ---------------------------------------------------------------- phases

  private async interpret(): Promise<boolean> {
    const providedAcceptance = this.options.acceptanceCriteria;
    if (providedAcceptance && providedAcceptance.length > 0) {
      this.objective.requirements = [this.objective.request];
      this.objective.acceptance = cloneAcceptanceCriteria(providedAcceptance);
      this.journal.record("requirements_derived", "1 requirement from supplied contract", {
        source: "supplied",
        requirements: this.objective.requirements,
      });
      this.journal.record("acceptance_derived", `${this.objective.acceptance.length} supplied criteria`, {
        source: "supplied",
        criteria: this.objective.acceptance,
      });
      return true;
    }

    const snapshot = scanWorkspace(this.objective.workspace);
    const existing = snapshot.files.length > 0;
    const response = await this.think<{ requirements: string[]; criteria: RawCriterion[] }>({
      role: "interpret",
      system: SYSTEM_INTERPRET,
      prompt:
        `USER OBJECTIVE:\n${this.objective.request}\n\n` +
        `WORKSPACE: ${this.objective.workspace}\n` +
        (existing
          ? `EXISTING FILES:\n${renderTree(snapshot, 120)}\n`
          : "The workspace is empty; this is a new project.\n") +
        (Object.keys(snapshot.manifests).length
          ? `MANIFESTS:\n${Object.entries(snapshot.manifests)
              .map(([k, v]) => `--- ${k} ---\n${v.slice(0, 1500)}`)
              .join("\n")}\n`
          : "") +
        (this.options.researchContext ? `\n${this.options.researchContext}\n` : "") +
        "\nDerive the concrete requirements and the acceptance criteria that prove them. " +
        "Favour criteria a machine can check without judgement: files, commands, HTTP routes and DOM assertions. " +
        "Use 'judge' only where no deterministic check could decide. " +
        "If the objective implies a web page, include DOM criteria for each required section, " +
        "a no_console_errors criterion, and a mobile no_horizontal_overflow criterion. " +
        "Never encode a console, media query, URL policy, or overflow requirement as a DOM selector. " +
        "For a live value that must change, use its element selector plus waitForChangeMs. " +
        "For a CSS media query, use a boolean expression or describe the query precisely. " +
        "For a collection of required files, use kind files_exist with one path per file.",
      schema: CRITERIA_SCHEMA,
      tier: "balanced",
    });

    if (!response.ok || !response.data) return false;
    this.objective.requirements = response.data.requirements ?? [];
    const benchmarkAcceptance = this.options.acceptanceCriteria;
    if (benchmarkAcceptance && benchmarkAcceptance.length > 0) {
      this.objective.acceptance = cloneAcceptanceCriteria(benchmarkAcceptance);
    } else {
      this.objective.acceptance = narrowCriteria(response.data.criteria ?? []);
      if (this.objective.acceptance.length > 0 && !this.objective.acceptance.some((criterion) => criterion.required)) {
        this.objective.acceptance = this.objective.acceptance.map((criterion) => ({ ...criterion, required: true }));
      }
    }
    this.journal.record("requirements_derived", `${this.objective.requirements.length} requirements`, {
      requirements: this.objective.requirements,
    });
    this.journal.record("acceptance_derived", `${this.objective.acceptance.length} criteria`, {
      source: benchmarkAcceptance && benchmarkAcceptance.length > 0 ? "benchmark" : "agent",
      criteria: this.objective.acceptance,
    });
    return this.objective.acceptance.length > 0;
  }

  private async buildPlan(): Promise<void> {
    if (this.options.acceptanceCriteria && this.options.acceptanceCriteria.length > 0) {
      this.objective.plan = [
        {
          id: "T1",
          description: this.objective.request,
          satisfies: this.objective.acceptance.map((criterion) => criterion.id),
          status: "pending",
          attempts: 0,
        },
      ];
      this.journal.record("plan_created", "1 deterministic task from supplied contract", {
        source: "supplied",
        plan: this.objective.plan,
      });
      return;
    }

    const snapshot = scanWorkspace(this.objective.workspace);
    const response = await this.think<{ tasks: Array<{ id: string; description: string; satisfies: string[] }> }>({
      role: "plan",
      system: SYSTEM_PLAN,
      prompt:
        `OBJECTIVE:\n${this.objective.request}\n\n` +
        `REQUIREMENTS:\n${this.objective.requirements.map((r) => `- ${r}`).join("\n")}\n\n` +
        `ACCEPTANCE CRITERIA:\n${this.objective.acceptance.map((c) => `- [${c.id}] ${c.description}`).join("\n")}\n\n` +
        (this.options.researchContext ? `${this.options.researchContext}\n\n` : "") +
        `EXISTING FILES:\n${renderTree(snapshot, 120)}\n\n` +
        "Produce an ordered task list. Each task should be a coherent unit of implementation " +
        "that the runtime can carry out in one pass. Prefer 1-4 tasks for a small project.",
      schema: PLAN_SCHEMA,
      tier: "balanced",
    });

    const tasks = response.data?.tasks ?? [];
    const criterionIds = new Set(this.objective.acceptance.map((criterion) => criterion.id));
    const usedTaskIds = new Set<string>();
    this.objective.plan = tasks.map<Task>((t, i) => {
      const baseId = t.id?.trim() || `T${i + 1}`;
      let id = baseId;
      let suffix = 2;
      while (usedTaskIds.has(id)) {
        id = `${baseId}-${suffix}`;
        suffix += 1;
      }
      usedTaskIds.add(id);
      return {
        id,
        description: t.description,
        satisfies: (t.satisfies ?? []).map(normalizeCriterionId).filter((criterionId) => criterionIds.has(criterionId)),
        status: "pending",
        attempts: 0,
      };
    });

    if (this.objective.plan.length === 0) {
      // A plan is a convenience, not a requirement — fall back to one task for the whole objective.
      this.objective.plan = [
        {
          id: "T1",
          description: this.objective.request,
          satisfies: this.objective.acceptance.map((c) => c.id),
          status: "pending",
          attempts: 0,
        },
      ];
    }
    const mappedCriteria = new Set(this.objective.plan.flatMap((task) => task.satisfies));
    const unmappedRequired = this.objective.acceptance
      .filter((criterion) => criterion.required && !mappedCriteria.has(criterion.id))
      .map((criterion) => criterion.id);
    if (unmappedRequired.length > 0) {
      this.objective.plan.at(-1)?.satisfies.push(...unmappedRequired);
    }
    this.journal.record("plan_created", `${this.objective.plan.length} tasks`, { plan: this.objective.plan });
  }

  private async executeTask(task: Task): Promise<void> {
    task.status = "active";
    task.attempts += 1;
    this.journal.record("task_started", task.description, { taskId: task.id });
    this.persistState();

    const snapshot = scanWorkspace(this.objective.workspace);
    const criteria = this.objective.acceptance.filter((c) => task.satisfies.includes(c.id));
    const response = await this.think<ChangeSet>({
      role: "implement",
      system: SYSTEM_IMPLEMENT,
      prompt:
        `OBJECTIVE:\n${this.objective.request}\n\n` +
        `CURRENT TASK:\n${task.description}\n\n` +
        (criteria.length
          ? `CRITERIA THIS TASK MUST SATISFY:\n${criteria.map((c) => `- [${c.id}] ${c.description}`).join("\n")}\n\n`
          : "") +
        (this.options.researchContext ? `${this.options.researchContext}\n\n` : "") +
        `${renderTaskContext(this.objective, task, snapshot)}\n\n` +
        (task.attempts > 1 && task.lastError
          ? `PREVIOUS ATTEMPT FAILED:\n${task.lastError}\nCorrect that failure; do not repeat the same response.\n\n`
          : "") +
        "Emit the complete file contents for every file you create or change. " +
        "For an edit, give oldText exactly as it appears in the file. " +
        "Do not emit read-only inspection commands; the relevant files are already included above. " +
        "If the objective says tests are protected, never modify test files. " +
        "If the project needs a command to serve it, set startCommand.",
      schema: CHANGESET_SCHEMA,
      tier: "deep",
    });

    if (!response.ok || !response.data) {
      task.status = "failed";
      task.lastError = response.error ?? "no change set produced";
      this.journal.record("task_finished", `failed: ${task.lastError}`, { taskId: task.id });
      return;
    }

    const invalid = validateChangeSet(response.data);
    if (invalid) {
      task.status = "failed";
      task.lastError = invalid;
      this.journal.record("task_finished", `failed: ${invalid}`, { taskId: task.id });
      return;
    }

    const applied = await this.applyChangeSet(response.data, task.id);
    task.status = applied.attempted > 0 && applied.failed === 0 ? "done" : "failed";
    if (applied.changed === 0) task.lastError = "change set applied no changes";
    else if (task.status === "done") delete task.lastError;
    if (response.data.startCommand) this.detectedStartCommand = response.data.startCommand;
    this.journal.record("task_finished", `${task.status}: ${applied.changed} file change(s)`, { taskId: task.id });
  }

  private async applyChangeSet(
    changes: ChangeSet,
    taskId?: string,
  ): Promise<{ changed: number; attempted: number; failed: number }> {
    let changed = 0;
    let attempted = 0;
    let failed = 0;
    for (const file of changes.files ?? []) {
      attempted += 1;
      const t0 = Date.now();
      let change: FileChange;
      try {
        const protectedReason = this.protectedPathReason(file.path);
        if (protectedReason) {
          change = {
            path: file.path,
            operation: "noop",
            changed: false,
            linesAdded: 0,
            linesRemoved: 0,
            bytesAfter: 0,
            error: protectedReason,
          };
        } else if (file.action === "write") {
          change = await this.deps.writeFile(this.objective.workspace, file.path, file.content ?? "");
        } else if (file.action === "edit") {
          change = await this.deps.editFile(
            this.objective.workspace,
            file.path,
            file.oldText ?? "",
            file.newText ?? "",
          );
        } else {
          change = await this.deps.deleteFile(this.objective.workspace, file.path);
        }
      } catch (err) {
        change = {
          path: file.path,
          operation: "noop",
          changed: false,
          linesAdded: 0,
          linesRemoved: 0,
          bytesAfter: 0,
          error: err instanceof Error ? err.message : String(err),
        };
      }
      if (change.changed) changed += 1;
      if (change.error) failed += 1;
      this.addAction({
        kind: file.action === "write" ? "write_file" : file.action === "edit" ? "edit_file" : "delete_file",
        taskId,
        summary: `${file.action} ${file.path}`,
        startedAt: t0,
        ok: change.changed && !change.error,
        fileChange: change,
        detail: change.error,
      });
    }

    for (const cmd of changes.commands ?? []) {
      attempted += 1;
      const t0 = Date.now();
      const outcome = await this.deps.runCommand(cmd.command, {
        cwd: this.objective.workspace,
        timeoutMs: 300_000,
        signal: this.options.signal,
      });
      this.addAction({
        kind: "run_command",
        taskId,
        summary: cmd.command,
        startedAt: t0,
        ok: commandSucceeded(outcome),
        command: outcome,
      });
      if (!commandSucceeded(outcome)) {
        failed += 1;
        this.observe(`Setup command failed: ${summarizeCommand(outcome, 600)}`);
      }
    }

    return { changed, attempted, failed };
  }

  /**
   * Run deterministic, user-visible verification commands before the independent
   * acceptance gate. This is Shelra checking its own work; benchmark-owned oracle
   * commands remain excluded and are still executed only by the acceptance engine.
   */
  private async runDeclaredSelfChecks(): Promise<void> {
    const checks = this.objective.acceptance
      .map((criterion) => criterion.check)
      .filter((check): check is Extract<CheckSpec, { kind: "command_succeeds" }> => check.kind === "command_succeeds")
      .filter((check) => !check.command.includes("{{benchmarkRoot}}"));
    const seen = new Set<string>();
    for (const check of checks) {
      if (seen.has(check.command)) continue;
      seen.add(check.command);
      const startedAt = Date.now();
      const outcome = await this.deps.runCommand(check.command, {
        cwd: this.objective.workspace,
        timeoutMs: check.timeoutMs ?? 180_000,
        signal: this.options.signal,
      });
      const expectedExitCode = check.expectExitCode ?? 0;
      const ok = outcome.state === "completed" && outcome.exitCode === expectedExitCode && !outcome.timedOut;
      this.addAction({
        kind: "run_command",
        summary: `self-check: ${check.command}`,
        startedAt,
        ok,
        command: outcome,
        detail: ok ? undefined : `Expected exit ${expectedExitCode}; observed ${outcome.exitCode ?? outcome.state}.`,
      });
      if (!ok) this.observe(`Self-check failed: ${summarizeCommand(outcome, 600)}`);
    }
  }

  private protectedPathReason(relativePath: string): string | undefined {
    if (!/(?:do not|don't|never)\s+(?:modify|edit|change)\s+(?:the\s+)?tests?/iu.test(this.objective.request)) {
      return undefined;
    }
    const normalized = relativePath.replaceAll("\\", "/").replace(/^\.\//u, "");
    const isTest =
      /(^|\/)(?:test|tests|__tests__)(\/|$)/iu.test(normalized) ||
      /(^|\/)[^/]+\.(?:test|spec)\.[^/]+$/iu.test(normalized);
    return isTest ? `Protected by the objective: test file ${relativePath} must not be modified.` : undefined;
  }

  /**
   * Make sure something is actually serving the software, if any criterion needs it.
   * A project with a start command gets its dev server; a static site gets a static server.
   */
  private async ensureAppRunning(): Promise<void> {
    const needsApp = this.objective.acceptance.some(
      (c) =>
        c.check.kind === "http_ok" ||
        c.check.kind === "dom" ||
        c.check.kind === "no_console_errors" ||
        c.check.kind === "no_horizontal_overflow",
    );
    if (!needsApp) return;

    if (this.appProcessId && this.objective.app.ready && this.objective.app.url) {
      const probe = await this.deps.probeHttp(this.objective.app.url);
      if (probe.ok) return;
      // The server died or stopped responding; restart it below.
      await this.stopApp();
    }

    const startCommand = this.detectedStartCommand;
    const snapshot = scanWorkspace(this.objective.workspace);
    // A standalone HTML project does not need to trust a model-proposed
    // process command. The in-process server is deterministic and gives the
    // browser observer a real URL without requiring Python/npm to exist.
    const useStaticServer = !startCommand || Object.keys(snapshot.manifests).length === 0;
    const processStartedAt = Date.now();
    let proc: ManagedProcess | undefined;

    if (!useStaticServer && startCommand) {
      const t0 = Date.now();
      try {
        proc = await this.deps.startProcess({
          command: startCommand,
          cwd: this.objective.workspace,
          readyTimeoutMs: 30_000,
          signal: this.options.signal,
        });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        this.addAction({ kind: "start_process", summary: startCommand, startedAt: t0, ok: false, detail });
        this.observe(`Could not start ${startCommand}; falling back to the static server: ${detail}`);
      }
    }

    if (!proc) {
      const t0 = Date.now();
      try {
        proc = await this.deps.serveStatic(this.objective.workspace);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        this.objective.app = { ready: false };
        this.addAction({ kind: "start_process", summary: "serve static files", startedAt: t0, ok: false, detail });
        this.observe(`Could not start the application: ${detail}`);
        return;
      }
    }

    this.appProcessId = proc.id;
    this.objective.app = {
      processId: proc.id,
      url: proc.url,
      port: proc.port,
      startCommand: proc.command,
      ready: proc.state === "ready",
    };
    this.addAction({
      kind: "start_process",
      summary: proc.command,
      startedAt: processStartedAt,
      ok: proc.state === "ready",
      detail: proc.state === "ready" ? `ready at ${proc.url}` : (proc.failureReason ?? proc.state),
    });
    if (proc.state !== "ready") this.observe(`Application did not become ready: ${proc.failureReason ?? proc.state}`);
  }

  private async verify(attempt: number): Promise<VerificationReport> {
    const deps: AcceptanceDeps = {
      runCommand: (command, options) => this.deps.runCommand(command, { ...options, signal: this.options.signal }),
      probeHttp: (url) => this.deps.probeHttp(url),
      observePage: (url, options) => this.deps.observePage(url, options),
      intelligence: this.deps.intelligence,
      artifactPath: (name) => this.journal.artifactPath(name),
    };
    return evaluateAcceptance(
      this.objective.acceptance,
      {
        workspace: this.objective.workspace,
        benchmarkRoot: this.options.benchmarkRoot,
        appUrl: this.objective.app.url,
        attempt,
        signal: this.options.signal,
      },
      deps,
    );
  }

  private async repair(
    failures: ReturnType<typeof failingRequired>,
    attempt: number,
    fingerprint: string,
    repeatCount: number,
  ): Promise<RepairAttempt | null> {
    const snapshot = scanWorkspace(this.objective.workspace);
    const relevantContext = renderTaskContext(
      this.objective,
      {
        id: "repair",
        description: failures.map((f) => f.description).join("; "),
        satisfies: [],
        status: "active",
        attempts: attempt,
      },
      snapshot,
    );

    // Repeated failures get a stronger model and an explicit instruction to change approach,
    // because trying the same idea harder is how autonomous loops waste money.
    const escalate = repeatCount > 1;
    const response = await this.think<Diagnosis>({
      role: "diagnose",
      system: SYSTEM_DIAGNOSE,
      prompt:
        `OBJECTIVE:\n${this.objective.request}\n\n` +
        `${renderFailureContext(this.objective, failures)}\n\n` +
        (this.options.researchContext ? `${this.options.researchContext}\n\n` : "") +
        `${relevantContext}\n\n` +
        (escalate
          ? `IMPORTANT: this exact failure has now occurred ${repeatCount} times. Previous strategies did not work. ` +
            "Do not repeat them. Identify a materially different explanation and fix.\n\n"
          : "") +
        "Diagnose the root cause and emit the file changes that fix it.",
      schema: DIAGNOSIS_SCHEMA,
      tier: escalate ? "deep" : "balanced",
    });

    if (!response.ok || !response.data) return null;
    const diagnosis = response.data;
    const applied = await this.applyChangeSet(diagnosis, "repair");
    if (diagnosis.startCommand) this.detectedStartCommand = diagnosis.startCommand;

    const record: RepairAttempt = {
      attempt,
      targets: failures.map((f) => f.id),
      diagnosis: diagnosis.rootCause,
      strategy: diagnosis.strategy,
      failureFingerprint: fingerprint,
      changedFiles: (diagnosis.files ?? []).map((f) => f.path),
      resolved: false,
    };
    this.objective.repairs.push(record);
    this.journal.recordRepair(record);

    if (applied.changed === 0) {
      this.observe("Repair produced no actual file changes.");
      return null;
    }
    return record;
  }

  // ---------------------------------------------------------------- helpers

  private async think<T>(request: {
    role: Parameters<IntelligenceProvider["complete"]>[0]["role"];
    system: string;
    prompt: string;
    schema: Record<string, unknown>;
    tier: "fast" | "balanced" | "deep";
  }) {
    const t0 = Date.now();
    const response = await this.deps.intelligence.complete<T>({
      role: request.role,
      system: request.system,
      prompt: request.prompt,
      schema: request.schema,
      tier: request.tier,
      ...this.remainingBudget(request.tier),
      signal: this.options.signal,
      cwd: this.objective.workspace,
    });
    recordUsage(this.objective.ledger, request.role, response.usage);
    this.journal.record("intelligence", `${request.role} (${request.tier})`, {
      ok: response.ok,
      model: response.usage.model,
      routingReasons: response.usage.routingReasons,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      costUsd: response.usage.costAvailable ? response.usage.costUsd : null,
      durationMs: response.usage.durationMs,
      error: response.error,
    });
    this.addAction({
      kind: "intelligence_call",
      summary: `${request.role} call`,
      startedAt: t0,
      ok: response.ok,
      detail: response.error,
    });
    return response;
  }

  private remainingBudget(_tier: "fast" | "balanced" | "deep"): { maxBudgetUsd?: number } {
    const limits = [this.options.maxCostUsd, this.options.maxRequestCostUsd].filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value),
    );
    if (limits.length === 0) return {};
    const objectiveRemaining =
      this.options.maxCostUsd === undefined
        ? Number.POSITIVE_INFINITY
        : Math.max(0, this.options.maxCostUsd - this.objective.ledger.costUsd);
    return { maxBudgetUsd: Math.min(objectiveRemaining, ...limits) };
  }

  private addAction(input: Omit<Action, "id" | "durationMs"> & { startedAt: number }): void {
    const action: Action = {
      id: randomUUID().slice(0, 8),
      durationMs: Date.now() - input.startedAt,
      ...input,
    };
    this.objective.actions.push(action);
    this.objective.updatedAt = Date.now();
    this.journal.recordAction(action);
  }

  private observe(text: string): void {
    const observation = { at: Date.now(), phase: this.objective.phase, text: text.slice(0, 1000) };
    this.objective.observations.push(observation);
    this.journal.recordObservation(observation);
  }

  private persistState(): void {
    this.objective.updatedAt = Date.now();
    this.journal.saveState(this.objective);
    this.deps.onObjectiveChange?.(this.objective);
  }

  private *phase(phase: ObjectivePhase): Generator<RuntimeEvent> {
    this.objective.phase = phase;
    this.objective.updatedAt = Date.now();
    this.journal.record("phase_changed", phase);
    this.journal.saveState(this.objective);
    this.deps.onObjectiveChange?.(this.objective);
    yield { type: "phase", phase, message: PHASE_LABELS[phase] };
  }

  private detail(message: string): RuntimeEvent {
    return { type: "detail", message };
  }

  private *finish(stopReason: StopReason, message: string): Generator<RuntimeEvent> {
    this.objective.phase = stopReason === "verified_success" ? "complete" : "stopped";
    this.objective.stopReason = stopReason;
    if (stopReason !== "verified_success") this.objective.blocker ??= message;
    const last = this.objective.verifications[this.objective.verifications.length - 1];
    const outcome: ObjectiveOutcome = {
      objective: this.objective,
      stopReason,
      verified: stopReason === "verified_success",
      finalReport: last,
      durationMs: Date.now() - this.startedAt,
      humanInterventions: 0,
    };
    this.journal.record("objective_stopped", `${stopReason}: ${message}`, {
      verified: outcome.verified,
      costUsd: this.objective.ledger.costAvailable ? this.objective.ledger.costUsd : null,
      calls: this.objective.ledger.calls,
    });
    this.journal.saveState(this.objective);
    this.deps.onObjectiveChange?.(this.objective);
    yield { type: "complete", phase: this.objective.phase, message, outcome };
  }

  private describeReport(report: VerificationReport): string {
    const passed = report.results.filter((r) => r.passed).length;
    const total = report.results.length;
    if (report.passed) return `Verification passed (${passed}/${total} criteria)`;
    const failures = report.results.filter((r) => !r.passed);
    return `Verification failed (${passed}/${total} passed) — ${failures.map((f) => f.id).join(", ")}`;
  }

  private cancelled(): boolean {
    return this.options.signal?.aborted === true;
  }

  private overBudget(): boolean {
    const cap = this.options.maxCostUsd;
    if (cap === undefined) return false;
    // Equality at zero is expected for a strict Free run: every structured call
    // may legitimately report $0 and the objective still needs to plan, act and
    // verify. The provider-side reservation check blocks the next paid request;
    // the loop stops here only after observed spend actually exceeds the cap.
    return this.objective.ledger.costAvailable && this.objective.ledger.costUsd > cap;
  }

  private async stopApp(): Promise<void> {
    if (!this.appProcessId) return;
    try {
      await this.deps.stopProcess(this.appProcessId);
    } catch {
      // Best effort.
    }
    this.appProcessId = undefined;
    this.objective.app = { ...this.objective.app, ready: false };
  }

  private async cleanup(): Promise<void> {
    await this.stopApp();
  }
}

function cloneAcceptanceCriteria(criteria: readonly AcceptanceCriterion[] | undefined): AcceptanceCriterion[] {
  return (criteria ?? []).map((criterion) => ({
    ...criterion,
    check: cloneCheckSpec(criterion.check),
  }));
}

function cloneCheckSpec(check: AcceptanceCriterion["check"]): AcceptanceCriterion["check"] {
  if (check.kind === "files_exist" || check.kind === "no_external_urls") {
    return { ...check, ...(check.paths ? { paths: [...check.paths] } : {}) };
  }
  if (check.kind === "dom") return { ...check, assertion: { ...check.assertion } };
  return { ...check };
}
