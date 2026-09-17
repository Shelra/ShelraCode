export type TurnKind = "conversation" | "repository" | "coding";

/**
 * A cheap, informational reading of what a prompt is about. It decides only how much
 * host-compiled repository context is worth attaching to the turn; it never removes tools or
 * changes the system prompt — the model always works with its full tool set.
 */
export interface TurnClassification {
  kind: TurnKind;
  reason: string;
}

export interface ContextPacket {
  classification: TurnClassification;
  promptAppendix: string;
  files: string[];
  truncated: boolean;
}
