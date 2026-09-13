export type TurnKind = "conversation" | "repository" | "coding";
export type ToolPolicy = "none" | "read" | "mutate";

export interface TurnClassification {
  kind: TurnKind;
  toolPolicy: ToolPolicy;
  reason: string;
  /** Broad review requests can be answered from host-compiled evidence. */
  hostEvidenceOnly?: boolean;
}

export interface ContextPacket {
  classification: TurnClassification;
  promptAppendix: string;
  files: string[];
  truncated: boolean;
}
