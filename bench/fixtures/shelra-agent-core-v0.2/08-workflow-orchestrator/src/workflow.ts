export interface WorkflowStep {
  id: string;
  dependsOn?: string[];
  attempts?: number;
}

export type WorkflowStepResult =
  | { status: "succeeded"; value: unknown; attempts: number }
  | { status: "failed"; error: unknown; attempts: number }
  | { status: "skipped"; reason: string; attempts: number };

export interface WorkflowEvent {
  stepId: string;
  type: "started" | "succeeded" | "failed" | "skipped";
  attempt: number;
}

export interface WorkflowOutcome {
  status: "completed" | "failed" | "cancelled";
  results: Record<string, WorkflowStepResult>;
  events: WorkflowEvent[];
}

export interface WorkflowOptions {
  concurrency?: number;
  signal?: AbortSignal;
}

export async function executeWorkflow(
  steps: readonly WorkflowStep[],
  handlers: Record<string, () => Promise<unknown>>,
  _options: WorkflowOptions = {},
): Promise<WorkflowOutcome> {
  const results: Record<string, WorkflowStepResult> = {};
  const events: WorkflowEvent[] = [];
  for (const step of steps) {
    const handler = handlers[step.id];
    if (!handler) {
      results[step.id] = { status: "failed", error: new Error("missing handler"), attempts: 0 };
      continue;
    }
    events.push({ stepId: step.id, type: "started", attempt: 1 });
    try {
      const value = await handler();
      results[step.id] = { status: "succeeded", value, attempts: 1 };
      events.push({ stepId: step.id, type: "succeeded", attempt: 1 });
    } catch (error) {
      results[step.id] = { status: "failed", error, attempts: 1 };
      events.push({ stepId: step.id, type: "failed", attempt: 1 });
    }
  }
  return { status: "failed", results, events };
}
