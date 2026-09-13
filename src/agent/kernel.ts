import { randomUUID } from "crypto";

export type KernelPhase =
  | "frame"
  | "discover"
  | "analyze"
  | "plan"
  | "act"
  | "observe"
  | "reflect"
  | "verify"
  | "review"
  | "complete"
  | "blocked"
  | "cancelled";

export interface KernelState {
  taskId: string;
  objective: string;
  phase: KernelPhase;
  scope: string[];
  mutations: string[];
  observations: string[];
  verificationDetails?: string;
  attemptCount: number;
  verificationPassed: boolean;
  reviewPassed: boolean;
  blockedReason?: string;
}

export interface CompletionInput {
  verificationPassed: boolean;
  reviewPassed: boolean;
  requiredPaths?: string[];
}

/** Small host-owned lifecycle state used as the migration seam for Shelra's kernel. */
export class AgentKernel {
  private state: KernelState;

  constructor(objective: string, taskId: string = randomUUID()) {
    this.state = {
      taskId,
      objective,
      phase: "frame",
      scope: [],
      mutations: [],
      observations: [],
      attemptCount: 0,
      verificationPassed: false,
      reviewPassed: false,
    };
  }

  static fromSnapshot(snapshot: KernelState): AgentKernel {
    const kernel = new AgentKernel(snapshot.objective, snapshot.taskId);
    kernel.state = {
      ...snapshot,
      scope: [...snapshot.scope],
      mutations: [...snapshot.mutations],
      observations: [...snapshot.observations],
    };
    return kernel;
  }

  snapshot(): KernelState {
    return {
      ...this.state,
      scope: [...this.state.scope],
      mutations: [...this.state.mutations],
      observations: [...this.state.observations],
    };
  }

  transition(phase: KernelPhase): void {
    if (this.state.phase === "complete" || this.state.phase === "blocked" || this.state.phase === "cancelled") return;
    this.state.phase = phase;
  }

  setScope(paths: string[]): void {
    this.state.scope = [...new Set(paths)];
  }

  recordMutation(path: string): void {
    if (!this.state.mutations.includes(path)) this.state.mutations.push(path);
    this.state.phase = "observe";
    this.state.attemptCount += 1;
  }

  recordObservation(observation: string): void {
    const trimmed = observation.trim();
    if (trimmed) this.state.observations.push(trimmed.slice(0, 500));
    this.state.phase = "observe";
  }

  recordVerification(success: boolean, details?: string): void {
    this.state.verificationPassed = success;
    this.state.verificationDetails = details?.slice(0, 500);
    this.state.phase = success ? "review" : "blocked";
  }

  evaluateCompletion(input: CompletionInput): boolean {
    this.state.verificationPassed = input.verificationPassed;
    this.state.reviewPassed = input.reviewPassed;
    const required = input.requiredPaths ?? [];
    const scopeSatisfied = required.every((path) => this.state.mutations.includes(path));
    if (!input.verificationPassed || !input.reviewPassed || !scopeSatisfied) {
      this.state.phase = "blocked";
      this.state.blockedReason = !input.verificationPassed
        ? "Host verification has not passed."
        : !input.reviewPassed
          ? "Host diff review has not passed."
          : "Required scoped mutations are not complete.";
      return false;
    }
    this.state.phase = "complete";
    this.state.blockedReason = undefined;
    return true;
  }

  cancel(reason = "Task cancelled."): void {
    this.state.phase = "cancelled";
    this.state.blockedReason = reason;
  }
}
