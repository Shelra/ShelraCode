import type { IntelligenceProvider, IntelligenceTier } from "../intelligence/types";
import { PROBES, renderProbe } from "./probes";
import type { ArmResult, CorpusCase, Decision, DivergenceRecord, SurfacedItem } from "./types";

/**
 * The four detection strategies.
 *
 * Every arm sees exactly the same thing: the short request. None of them sees the withheld
 * specification, the ground-truth decisions, or the discriminating scenarios. The only
 * difference between arms is the shape of the question put to the model.
 */

const ARM_TIER: IntelligenceTier = "balanced";

interface Budget {
  costUsd: number;
  costAvailable: boolean;
  calls: number;
}

function newBudget(): Budget {
  return { costUsd: 0, costAvailable: true, calls: 0 };
}

async function ask<T>(
  provider: IntelligenceProvider,
  budget: Budget,
  system: string,
  prompt: string,
  schema: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T | null> {
  const response = await provider.complete<T>({
    role: "interpret",
    system,
    prompt,
    schema,
    tier: ARM_TIER,
    ...(signal ? { signal } : {}),
  });
  budget.calls += 1;
  if (response.usage.costAvailable && typeof response.usage.costUsd === "number") {
    budget.costUsd += response.usage.costUsd;
  } else {
    budget.costAvailable = false;
  }
  return response.ok && response.data ? response.data : null;
}

const LIST_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          why_it_matters: { type: "string" },
        },
        required: ["question", "why_it_matters"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
} as const;

/**
 * Arm A — direct implementation.
 *
 * What a coding agent does today: read the request, decide how the system behaves, and build.
 * The arm is scored on what it raises as genuinely undetermined, not on what it silently chose,
 * because a choice the user never sees is precisely the thing this study is measuring.
 */
export async function runDirect(
  provider: IntelligenceProvider,
  corpusCase: CorpusCase,
  signal?: AbortSignal,
): Promise<ArmResult> {
  const budget = newBudget();
  const startedAt = Date.now();

  const data = await ask<{ behaviours: string[]; items: { question: string; why_it_matters: string }[] }>(
    provider,
    budget,
    "You are a senior engineer who builds what is asked, promptly and competently. You answer in JSON.",
    [
      "A client has asked for the following software.",
      "",
      `REQUEST: ${corpusCase.request}`,
      "",
      "Write the behavioural specification you would build to: the concrete statements about how the",
      "system behaves that you would hand to an implementer. Then, separately, list only those points",
      "you would genuinely stop and go back to the client about before writing code.",
      "Be realistic. Do not pad the second list to look thorough.",
    ].join("\n"),
    {
      type: "object",
      properties: {
        behaviours: { type: "array", items: { type: "string" } },
        items: LIST_SCHEMA.properties.items,
      },
      required: ["behaviours", "items"],
      additionalProperties: false,
    },
    signal,
  );

  return {
    arm: "direct",
    caseId: corpusCase.id,
    items: (data?.items ?? []).map((item) => ({ text: `${item.question} — ${item.why_it_matters}` })),
    costUsd: budget.costUsd,
    costAvailable: budget.costAvailable,
    calls: budget.calls,
    durationMs: Date.now() - startedAt,
    ...(data ? {} : { error: "no answer" }),
  };
}

/**
 * Arm B — clarification generation.
 *
 * The standard practice, and the shape used by published clarification systems: ask the model
 * to enumerate what is unclear. This is an open enumeration task.
 */
export async function runAsk(
  provider: IntelligenceProvider,
  corpusCase: CorpusCase,
  signal?: AbortSignal,
): Promise<ArmResult> {
  const budget = newBudget();
  const startedAt = Date.now();

  const data = await ask<{ items: { question: string; why_it_matters: string }[] }>(
    provider,
    budget,
    "You are a senior engineer eliciting requirements. You answer in JSON.",
    [
      "A client has asked for the following software.",
      "",
      `REQUEST: ${corpusCase.request}`,
      "",
      "List the questions you would ask the client before building, covering everything the request",
      "leaves undetermined that would change how the software behaves. Be thorough and specific.",
      "Do not ask about visual design, technology choices, or anything that does not change behaviour.",
    ].join("\n"),
    LIST_SCHEMA as unknown as Record<string, unknown>,
    signal,
  );

  return {
    arm: "ask",
    caseId: corpusCase.id,
    items: (data?.items ?? []).map((item) => ({ text: `${item.question} — ${item.why_it_matters}` })),
    costUsd: budget.costUsd,
    costAvailable: budget.costAvailable,
    calls: budget.calls,
    durationMs: Date.now() - startedAt,
    ...(data ? {} : { error: "no answer" }),
  };
}

/**
 * Arm C — divergence sampling.
 *
 * The mechanism behind the current state of the art in behavioural ambiguity detection:
 * interpret the request several times independently, and treat disagreement between the
 * interpretations as evidence of ambiguity.
 *
 * It is generalised here from pure functions to stateful systems by building a shared scenario
 * space from the request first, so that independent interpretations can be compared on the same
 * questions. The scenario space is generated from the request alone; no ground truth touches it.
 */
export async function runDivergence(
  provider: IntelligenceProvider,
  corpusCase: CorpusCase,
  samples: number,
  signal?: AbortSignal,
): Promise<ArmResult> {
  const budget = newBudget();
  const startedAt = Date.now();

  const space = await ask<{ scenarios: string[] }>(
    provider,
    budget,
    "You enumerate concrete situations a system will encounter. You answer in JSON.",
    [
      `REQUEST: ${corpusCase.request}`,
      "",
      "List 16 concrete situations this system would encounter in real operation, each stated as a",
      "specific event with enough detail that the system's response to it is a definite fact.",
      "Cover ordinary use and unusual-but-real situations. Do not answer them.",
    ].join("\n"),
    {
      type: "object",
      properties: { scenarios: { type: "array", items: { type: "string" } } },
      required: ["scenarios"],
      additionalProperties: false,
    },
    signal,
  );

  const scenarios = space?.scenarios ?? [];
  if (scenarios.length === 0) {
    return {
      arm: "divergence",
      caseId: corpusCase.id,
      items: [],
      costUsd: budget.costUsd,
      costAvailable: budget.costAvailable,
      calls: budget.calls,
      durationMs: Date.now() - startedAt,
      error: "no scenario space",
    };
  }

  const answerSchema = {
    type: "object",
    properties: {
      answers: {
        type: "array",
        items: {
          type: "object",
          properties: { index: { type: "integer" }, outcome: { type: "string" } },
          required: ["index", "outcome"],
          additionalProperties: false,
        },
      },
    },
    required: ["answers"],
    additionalProperties: false,
  } as const;

  const numbered = scenarios.map((scenario, index) => `${index}. ${scenario}`).join("\n");
  const runs = await Promise.all(
    Array.from({ length: samples }, () =>
      ask<{ answers: { index: number; outcome: string }[] }>(
        provider,
        budget,
        "You specify precisely how a described system behaves. You answer in JSON.",
        [
          `REQUEST: ${corpusCase.request}`,
          "",
          "For each situation below, state in one short sentence exactly what this system does.",
          "Commit to a definite behaviour for every one. Do not hedge and do not ask questions.",
          "",
          numbered,
        ].join("\n"),
        answerSchema as unknown as Record<string, unknown>,
        signal,
      ),
    ),
  );

  const answersByScenario = new Map<number, string[]>();
  for (const run of runs) {
    for (const answer of run?.answers ?? []) {
      const bucket = answersByScenario.get(answer.index) ?? [];
      bucket.push(answer.outcome);
      answersByScenario.set(answer.index, bucket);
    }
  }

  // Disagreement is judged semantically in one batched call: differently worded answers that mean
  // the same thing are agreement, and that distinction is the point of comparing behaviour rather
  // than prose.
  const comparable = [...answersByScenario.entries()].filter(([, answers]) => answers.length >= 2);
  const verdict = await ask<{ divergent: { index: number; disagreement: string }[] }>(
    provider,
    budget,
    "You compare statements about system behaviour and decide whether they agree. You answer in JSON.",
    [
      "Below are situations, each followed by several independent statements of what the system does.",
      "Report only the situations where the statements describe genuinely different behaviour — a",
      "different observable outcome, not different wording. For each, say what the disagreement is.",
      "",
      comparable
        .map(([index, answers]) =>
          [`SITUATION ${index}: ${scenarios[index]}`, ...answers.map((answer, n) => `  (${n + 1}) ${answer}`)].join(
            "\n",
          ),
        )
        .join("\n\n"),
    ].join("\n"),
    {
      type: "object",
      properties: {
        divergent: {
          type: "array",
          items: {
            type: "object",
            properties: { index: { type: "integer" }, disagreement: { type: "string" } },
            required: ["index", "disagreement"],
            additionalProperties: false,
          },
        },
      },
      required: ["divergent"],
      additionalProperties: false,
    },
    signal,
  );

  const items: SurfacedItem[] = (verdict?.divergent ?? []).map((entry) => ({
    text: `${scenarios[entry.index] ?? `situation ${entry.index}`} — interpretations differ: ${entry.disagreement}`,
    origin: `scenario:${entry.index}`,
  }));

  return {
    arm: "divergence",
    caseId: corpusCase.id,
    items,
    costUsd: budget.costUsd,
    costAvailable: budget.costAvailable,
    calls: budget.calls,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Arm D — structural probing.
 *
 * The catalogue supplies the classes of decision; the model only has to recognise which of them
 * are live in this request and left open by it. Each probe is an independent bounded question,
 * so a decision can surface even where the model, asked openly, would never have raised it.
 */
export async function runProbe(
  provider: IntelligenceProvider,
  corpusCase: CorpusCase,
  signal?: AbortSignal,
): Promise<ArmResult> {
  const budget = newBudget();
  const startedAt = Date.now();

  const perProbe = await Promise.all(
    PROBES.map((probe) =>
      ask<{ decisions: { question: string; why_it_matters: string }[] }>(
        provider,
        budget,
        "You identify decisions a request leaves open, within one named class. You answer in JSON.",
        [
          `REQUEST: ${corpusCase.request}`,
          "",
          renderProbe(probe),
          "",
          "Considering only this class of decision, identify the specific decisions that this request",
          "raises and does not settle. A decision qualifies only if it could reasonably be answered in",
          "more than one way and the answers would produce different observable behaviour.",
          "If the request settles it, or the class does not apply here, return an empty list.",
          "Do not stretch to fill the list.",
        ].join("\n"),
        {
          type: "object",
          properties: {
            decisions: {
              type: "array",
              items: {
                type: "object",
                properties: { question: { type: "string" }, why_it_matters: { type: "string" } },
                required: ["question", "why_it_matters"],
                additionalProperties: false,
              },
            },
          },
          required: ["decisions"],
          additionalProperties: false,
        },
        signal,
      ).then((data) => ({ probe, data })),
    ),
  );

  const items: SurfacedItem[] = [];
  for (const { probe, data } of perProbe) {
    for (const decision of data?.decisions ?? []) {
      items.push({
        text: `${decision.question} — ${decision.why_it_matters}`,
        origin: probe.category,
      });
    }
  }

  return {
    arm: "probe",
    caseId: corpusCase.id,
    items,
    costUsd: budget.costUsd,
    costAvailable: budget.costAvailable,
    calls: budget.calls,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Silent-consensus measurement.
 *
 * Independent of every arm, and run after them: fresh interpretations of the request answer the
 * discriminating scenario for each ground-truth decision, without ever seeing the decision, its
 * options, or the withheld specification. Where all of them land on the same behaviour, no
 * sampling-based method could have flagged that decision, however it were implemented.
 */
export async function measureDivergenceOnDecisions(
  provider: IntelligenceProvider,
  corpusCase: CorpusCase,
  samples: number,
  signal?: AbortSignal,
): Promise<{ records: DivergenceRecord[]; costUsd: number; costAvailable: boolean; calls: number }> {
  const budget = newBudget();
  const decisions: Decision[] = corpusCase.decisions;
  const numbered = decisions.map((decision, index) => `${index}. ${decision.discriminator}`).join("\n");

  const answerSchema = {
    type: "object",
    properties: {
      answers: {
        type: "array",
        items: {
          type: "object",
          properties: { index: { type: "integer" }, outcome: { type: "string" } },
          required: ["index", "outcome"],
          additionalProperties: false,
        },
      },
    },
    required: ["answers"],
    additionalProperties: false,
  } as const;

  const runs = await Promise.all(
    Array.from({ length: samples }, () =>
      ask<{ answers: { index: number; outcome: string }[] }>(
        provider,
        budget,
        "You specify precisely how a described system behaves. You answer in JSON.",
        [
          `REQUEST: ${corpusCase.request}`,
          "",
          "For each situation below, state in one short sentence exactly what this system does.",
          "Commit to a definite behaviour for every one. Do not hedge and do not ask questions.",
          "",
          numbered,
        ].join("\n"),
        answerSchema as unknown as Record<string, unknown>,
        signal,
      ),
    ),
  );

  const collected = new Map<number, string[]>();
  for (const run of runs) {
    for (const answer of run?.answers ?? []) {
      const bucket = collected.get(answer.index) ?? [];
      bucket.push(answer.outcome);
      collected.set(answer.index, bucket);
    }
  }

  // Classification is batched and semantic: the question is whether the independent samples chose
  // the same behaviour, not whether they used the same words.
  const classified = await ask<{ groups: { index: number; distinct: number; unanimous: boolean }[] }>(
    provider,
    budget,
    "You group statements about behaviour by what they actually claim. You answer in JSON.",
    [
      "Below are situations, each followed by several independent statements of what a system does.",
      "For each situation, count how many genuinely different behaviours are described — different",
      "observable outcomes, not different wording — and say whether all statements agree.",
      "",
      decisions
        .map((decision, index) => {
          const answers = collected.get(index) ?? [];
          return [
            `SITUATION ${index}: ${decision.discriminator}`,
            ...answers.map((answer, n) => `  (${n + 1}) ${answer}`),
          ].join("\n");
        })
        .join("\n\n"),
    ].join("\n"),
    {
      type: "object",
      properties: {
        groups: {
          type: "array",
          items: {
            type: "object",
            properties: {
              index: { type: "integer" },
              distinct: { type: "integer" },
              unanimous: { type: "boolean" },
            },
            required: ["index", "distinct", "unanimous"],
            additionalProperties: false,
          },
        },
      },
      required: ["groups"],
      additionalProperties: false,
    },
    signal,
  );

  const byIndex = new Map((classified?.groups ?? []).map((group) => [group.index, group]));
  const records: DivergenceRecord[] = decisions.map((decision, index) => {
    const group = byIndex.get(index);
    const answers = collected.get(index) ?? [];
    return {
      decisionId: decision.id,
      answers,
      unanimous: group ? group.unanimous : false,
      distinct: group ? group.distinct : answers.length,
    };
  });

  return { records, costUsd: budget.costUsd, costAvailable: budget.costAvailable, calls: budget.calls };
}

/**
 * Arm B10 — repeated open enumeration.
 *
 * The control that separates mechanism from compute. It runs the open clarification question
 * ten times independently and unions the results, matching the ten calls the probe arm makes.
 * If the probe catalogue is worth anything, it has to beat this; otherwise the effect is only
 * that ten samples of an open question cover more than one.
 */
export async function runAskRepeated(
  provider: IntelligenceProvider,
  corpusCase: CorpusCase,
  repeats: number,
  signal?: AbortSignal,
): Promise<ArmResult> {
  const budget = newBudget();
  const startedAt = Date.now();

  const runs = await Promise.all(
    Array.from({ length: repeats }, () =>
      ask<{ items: { question: string; why_it_matters: string }[] }>(
        provider,
        budget,
        "You are a senior engineer eliciting requirements. You answer in JSON.",
        [
          "A client has asked for the following software.",
          "",
          `REQUEST: ${corpusCase.request}`,
          "",
          "List the questions you would ask the client before building, covering everything the request",
          "leaves undetermined that would change how the software behaves. Be thorough and specific.",
          "Do not ask about visual design, technology choices, or anything that does not change behaviour.",
        ].join("\n"),
        LIST_SCHEMA as unknown as Record<string, unknown>,
        signal,
      ),
    ),
  );

  const items: SurfacedItem[] = [];
  runs.forEach((run, index) => {
    for (const item of run?.items ?? []) {
      items.push({ text: `${item.question} — ${item.why_it_matters}`, origin: `run:${index}` });
    }
  });

  return {
    arm: "ask10",
    caseId: corpusCase.id,
    items,
    costUsd: budget.costUsd,
    costAvailable: budget.costAvailable,
    calls: budget.calls,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Uniform deduplication.
 *
 * Applied identically to every arm before scoring. Arms that make many calls naturally repeat
 * themselves, and counting the same question twice would distort both how much they raised and
 * how much of it landed. Collapsing repeats is therefore a fairness requirement, not a tidy-up.
 */
export async function dedupeItems(
  provider: IntelligenceProvider,
  result: ArmResult,
  signal?: AbortSignal,
): Promise<{ result: ArmResult; costUsd: number; costAvailable: boolean }> {
  if (result.items.length < 2) return { result, costUsd: 0, costAvailable: true };

  const response = await provider.complete<{ groups: number[][] }>({
    role: "summarize",
    system: "You group questions that ask the same thing. You answer in JSON.",
    prompt: [
      "Below is a numbered list of questions raised about a software request.",
      "Group together the numbers of questions that ask the same underlying thing, however differently",
      "they are worded. A question that raises a genuinely different decision belongs in its own group.",
      "Every number must appear in exactly one group.",
      "",
      result.items.map((item, index) => `${index + 1}. ${item.text}`).join("\n"),
    ].join("\n"),
    schema: {
      type: "object",
      properties: {
        groups: { type: "array", items: { type: "array", items: { type: "integer" } } },
      },
      required: ["groups"],
      additionalProperties: false,
    },
    tier: "balanced",
    ...(signal ? { signal } : {}),
  });

  const costUsd = response.usage.costAvailable ? (response.usage.costUsd ?? 0) : 0;
  const groups = response.data?.groups ?? [];
  if (groups.length === 0) return { result, costUsd, costAvailable: response.usage.costAvailable };

  // One representative per group: the longest text, which carries the most detail for the judge.
  const kept: SurfacedItem[] = [];
  const seen = new Set<number>();
  for (const group of groups) {
    const valid = group.filter((n) => n >= 1 && n <= result.items.length && !seen.has(n));
    if (valid.length === 0) continue;
    for (const n of valid) seen.add(n);
    let best = result.items[valid[0]! - 1]!;
    for (const n of valid) {
      const candidate = result.items[n - 1];
      if (candidate && candidate.text.length > best.text.length) best = candidate;
    }
    kept.push(best);
  }
  // Anything the grouper failed to place is kept rather than silently dropped.
  for (let index = 0; index < result.items.length; index += 1) {
    if (!seen.has(index + 1)) kept.push(result.items[index]!);
  }

  return { result: { ...result, items: kept }, costUsd, costAvailable: response.usage.costAvailable };
}
