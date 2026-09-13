import type { ProbeCategory } from "./types";

/**
 * The probe catalogue.
 *
 * Every entry is fixed text. It does not vary by request, by domain, or by model, and it was
 * written from the structure of stateful systems rather than from any particular case in the
 * corpus. That independence is the whole mechanism: a probe can surface a decision even when
 * every sample a model draws agrees, because the probe does not come from the model.
 *
 * The catalogue also changes the shape of the task. Asking a model "what is unclear here?" is
 * an enumeration problem, and enumeration is the mode in which language models are measurably
 * weakest — they judge membership far better than they can produce a complete set. Each probe
 * converts that open enumeration into a bounded recognition question: given this one named
 * class of decision, does it apply here, and does the request settle it?
 */

export interface Probe {
  category: ProbeCategory;
  /** Shown to the model as the class of decision under consideration. */
  title: string;
  /** What makes this class exist in any stateful system. */
  rationale: string;
  /** Concrete forms the decision takes. Deliberately generic — no corpus case is referenced. */
  forms: string[];
}

export const PROBES: Probe[] = [
  {
    category: "concurrency",
    title: "Two actors reach the same state at the same time",
    rationale:
      "Any resource that can be held by one party and wanted by another forces a rule about who wins, " +
      "and what the loser is told. Software that never states the rule picks one by accident.",
    forms: [
      "Two requests compete for a single unit of a limited resource.",
      "One party reads a value, decides on it, and writes back after another party has changed it.",
      "An action is taken against state that has been modified since it was displayed.",
      "A long-running operation overlaps with a change to the thing it operates on.",
    ],
  },
  {
    category: "partial_failure",
    title: "A multi-step effect succeeds halfway",
    rationale:
      "Every operation that touches more than one system can stop between them. What survives the " +
      "interruption is a policy decision, not a technical detail.",
    forms: [
      "An external effect (payment, message, third-party call) succeeds but the local record fails.",
      "The local record succeeds but the external effect fails.",
      "A notification cannot be delivered after the operation it describes has committed.",
      "A step is retried after an earlier attempt may already have taken effect.",
    ],
  },
  {
    category: "lifecycle",
    title: "An entity is removed or deactivated while other things still refer to it",
    rationale:
      "Records point at other records. Deletion and deactivation are therefore never local; they " +
      "propagate, or they leave dangling references that surface later as defects.",
    forms: [
      "A person, account or actor is deactivated while work assigned to them is outstanding.",
      "A referenced item is withdrawn while it sits inside someone else's in-progress state.",
      "An owner departs and something they solely owned must go somewhere.",
      "Deletion must decide between removal, recoverable removal, and archival.",
    ],
  },
  {
    category: "temporal",
    title: "Exactly when something counts",
    rationale:
      "Deadlines, effective dates, rate dates and timezones decide outcomes. Time is the most common " +
      "place where two readings of the same sentence produce different software.",
    forms: [
      "A deadline exists before or after which the outcome differs.",
      "A value depends on which date it is read at (a rate, a price, a tax, an address).",
      "Times must be interpreted in somebody's timezone, and it matters whose.",
      "An unattended item needs a rule for what happens as time passes.",
    ],
  },
  {
    category: "authority",
    title: "Who may do this, and to whose data",
    rationale:
      "Almost no real system has a single class of user. Where the request names one actor, it is " +
      "usually hiding at least a second with different powers.",
    forms: [
      "An operator or administrator can do things the ordinary user cannot.",
      "Someone might act on their own request, creating a conflict of interest.",
      "The power to grant a permission is distinct from the permission itself.",
      "An action must be attributable afterwards to a specific person.",
    ],
  },
  {
    category: "money",
    title: "How value is divided, rounded and returned",
    rationale:
      "Money forces exactness. Partial periods, refunds and rounding all have a direction, and the " +
      "direction is a policy with accounting and legal consequences.",
    forms: [
      "A partial period or partial quantity must be priced.",
      "Rounding must fall in a direction, and somebody benefits.",
      "Money already taken must be returned, credited, or kept.",
      "A charge may be attempted more than once for the same obligation.",
    ],
  },
  {
    category: "boundary",
    title: "The first, the last, the empty, the maximum",
    rationale:
      "Requests describe the ordinary case. The rules at the edges are exactly what the ordinary " +
      "description omits, and they are where behaviour is decided by whatever the code happens to do.",
    forms: [
      "The quantity is zero, or the collection is empty.",
      "A limit exists on how many, how large, how far ahead or how far back.",
      "A value could go below zero, and either must not or may.",
      "Two configurations conflict and one must take precedence.",
    ],
  },
  {
    category: "idempotency",
    title: "The same request arrives twice",
    rationale:
      "Networks retry, users double-click, and jobs are re-run. Whether the second arrival is a " +
      "second effect is a decision that is almost never stated and almost always matters.",
    forms: [
      "A submission is repeated because the first response was slow or lost.",
      "A background job re-runs over work it may already have done.",
      "The same underlying real-world item is entered twice by different routes.",
    ],
  },
  {
    category: "visibility",
    title: "Who observes the effect, and how much of it",
    rationale:
      "State is shown to somebody. Which parts of it, to whom, and how promptly are decisions about " +
      "other people's data rather than about presentation.",
    forms: [
      "Data about one party is visible in a view belonging to another.",
      "A list reveals the existence of records the viewer has no right to.",
      "A change made by one party must or must not become visible to another immediately.",
    ],
  },
  {
    category: "reversal",
    title: "Undoing something after the fact",
    rationale:
      "Almost every action a user takes will eventually need to be taken back. Whether reversal is " +
      "possible, who may do it, and what it restores are separate questions from the action itself.",
    forms: [
      "A completed action must be cancelled, recalled or corrected.",
      "A correction must decide between editing in place and issuing a compensating record.",
      "Reversal must decide what it restores, and what it deliberately leaves alone.",
      "A record that others have relied on is changed after they relied on it.",
    ],
  },
];

export function probeByCategory(category: ProbeCategory): Probe | undefined {
  return PROBES.find((probe) => probe.category === category);
}

/** Renders one probe for a prompt. Kept here so the exact wording is auditable in one place. */
export function renderProbe(probe: Probe): string {
  return [
    `CLASS OF DECISION: ${probe.title}`,
    `WHY THIS CLASS EXISTS: ${probe.rationale}`,
    "FORMS IT TAKES:",
    ...probe.forms.map((form) => `  - ${form}`),
  ].join("\n");
}
