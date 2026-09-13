import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import { buildEffectiveTranscript, type PersistedCompaction } from "../storage/transcript-view";
import {
  appendActiveCriteriaBlock,
  budgetedContextTokens,
  COMPACTION_SUMMARY_HEADER,
  CONTEXT_TRUNCATION_MARKER,
  compactionSettingsForWindow,
  createCompactionSummaryMessage,
  DEFAULT_KEEP_RECENT_TOKENS,
  DEFAULT_RESERVE_TOKENS,
  findCutPoint,
  MIN_RESERVE_TOKENS,
  prepareCompaction,
  relaxCompactionSettings,
  serializeConversation,
  shouldCompactContext,
  truncateTextToTokens,
  truncateUserMessageToTokens,
} from "./compaction";

function user(text: string): ModelMessage {
  return { role: "user", content: text } as ModelMessage;
}

function assistantText(text: string): ModelMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
  } as ModelMessage;
}

function assistantToolCall(toolCallId: string, toolName: string, input: Record<string, unknown> = {}): ModelMessage {
  return {
    role: "assistant",
    content: [{ type: "tool-call", toolCallId, toolName, input }],
  } as ModelMessage;
}

function toolResult(toolCallId: string, toolName: string, output: unknown): ModelMessage {
  return {
    role: "tool",
    content: [{ type: "tool-result", toolCallId, toolName, output }],
  } as ModelMessage;
}

describe("compaction helpers", () => {
  // Previously asserted that an estimate of exactly `window - reserve` did not
  // trigger. `chars / 4` under-counts code and tool payloads, so budget
  // decisions now run on the margin-adjusted estimate and fire earlier.
  it("triggers on the margin-adjusted estimate, not the raw one", () => {
    const settings = { reserveTokens: 100, keepRecentTokens: 40 };

    expect(shouldCompactContext(901, 1000, settings)).toBe(true);
    // 783 * 1.15 rounds above the 900-token trigger; 782 stays below it.
    expect(shouldCompactContext(783, 1000, settings)).toBe(true);
    expect(shouldCompactContext(782, 1000, settings)).toBe(false);
  });

  it("fires the trigger earlier than the unmargined estimate would", () => {
    const settings = { reserveTokens: 100, keepRecentTokens: 40 };
    const estimated = 850;

    expect(estimated > 1000 - settings.reserveTokens).toBe(false);
    expect(budgetedContextTokens(estimated)).toBeGreaterThan(estimated);
    expect(shouldCompactContext(estimated, 1000, settings)).toBe(true);
  });

  it("keeps the kept-recent budget below the compaction trigger for every window", () => {
    for (const contextWindow of [4096, 8192, 32_768, 128_000]) {
      const settings = compactionSettingsForWindow(contextWindow);
      const trigger = contextWindow - settings.reserveTokens;

      expect(settings.reserveTokens).toBeGreaterThanOrEqual(MIN_RESERVE_TOKENS);
      expect(settings.reserveTokens).toBeLessThanOrEqual(contextWindow * 0.5);
      expect(settings.keepRecentTokens).toBeLessThan(trigger);
      expect(settings.keepRecentTokens).toBeGreaterThan(0);
    }
  });

  it("derives the budget from the window rather than a fixed 16K reserve", () => {
    expect(compactionSettingsForWindow(8192)).toEqual({ reserveTokens: 2048, keepRecentTokens: 2867 });
    // The old constants made the kept budget (20000) exceed the whole usable
    // window of a 32K model (32768 - 16384 = 16384).
    const local = compactionSettingsForWindow(32_768);
    expect(local.keepRecentTokens).toBeLessThan(DEFAULT_KEEP_RECENT_TOKENS);
    expect(local.reserveTokens).toBeLessThan(DEFAULT_RESERVE_TOKENS);
  });

  it("falls back to the legacy budget when the window is unknown", () => {
    for (const unknown of [undefined, 0, Number.NaN]) {
      expect(compactionSettingsForWindow(unknown)).toEqual({
        reserveTokens: DEFAULT_RESERVE_TOKENS,
        keepRecentTokens: DEFAULT_KEEP_RECENT_TOKENS,
      });
    }
  });

  it("bounds an oversized user prompt while preserving both ends", () => {
    const prompt = `request ${"a".repeat(200)} acceptance criteria`;
    const truncated = truncateTextToTokens(prompt, 30);

    expect(truncated.length).toBeLessThanOrEqual(120);
    expect(truncated).toContain(CONTEXT_TRUNCATION_MARKER);
    expect(truncated.startsWith("request")).toBe(true);
    expect(truncated.endsWith("acceptance criteria")).toBe(true);
  });

  it("bounds text inside a multimodal user message without dropping its file", () => {
    const message = {
      role: "user" as const,
      content: [
        { type: "file" as const, data: new URL("file:///tmp/image.png"), mediaType: "image/png" },
        { type: "text" as const, text: `request ${"a".repeat(200)}` },
      ],
    } as ModelMessage;

    const truncated = truncateUserMessageToTokens(message, 40);
    expect(truncated).not.toBe(message);
    expect(Array.isArray(truncated.content)).toBe(true);
    expect((truncated.content as Array<{ type: string }>)[0]?.type).toBe("file");
    expect(JSON.stringify(truncated.content)).toContain(CONTEXT_TRUNCATION_MARKER.trim());
  });

  it("always shrinks the kept budget when relaxed, including below the retry floor", () => {
    // Unchanged for budgets sized for a large window.
    expect(relaxCompactionSettings({ reserveTokens: 16_384, keepRecentTokens: 20_000 }).keepRecentTokens).toBe(10_000);
    expect(relaxCompactionSettings({ reserveTokens: 16_384, keepRecentTokens: 8_000 }).keepRecentTokens).toBe(4_000);
    // A small local window can start below the 4000 floor; relaxing must still
    // make progress or the recovery ladder spins on an identical cut.
    const small = compactionSettingsForWindow(8192);
    expect(relaxCompactionSettings(small).keepRecentTokens).toBeLessThan(small.keepRecentTokens);
  });

  it("never selects a tool-result message as the cut point", () => {
    const messages = [
      user("inspect this file"),
      assistantToolCall("call-1", "read_file", { path: "src/index.ts" }),
      toolResult("call-1", "read_file", "x".repeat(400)),
      assistantText("I found the relevant section."),
      user("continue"),
    ];

    const cutPoint = findCutPoint(messages, 0, 130);

    expect(cutPoint.firstKeptIndex).not.toBe(2);
    expect(messages[cutPoint.firstKeptIndex]?.role).not.toBe("tool");
  });

  it("detects split turns and captures the turn prefix for summarization", () => {
    const messages = [
      user("Refactor the session loader."),
      assistantText("a".repeat(320)),
      assistantText("recent status update"),
    ];

    const preparation = prepareCompaction(messages, "system prompt", {
      reserveTokens: 100,
      keepRecentTokens: 5,
    });

    expect(preparation).not.toBeNull();
    expect(preparation?.isSplitTurn).toBe(true);
    expect(preparation?.messagesToSummarize).toHaveLength(0);
    expect(preparation?.turnPrefixMessages).toHaveLength(2);
    expect(preparation?.keptMessages).toHaveLength(1);
  });

  it("excludes the previous summary message from new compaction input", () => {
    const messages = [
      createCompactionSummaryMessage("Earlier work"),
      user("Handle migration edge cases"),
      assistantText("I added the table and loader changes."),
      user("Now wire the retry path"),
    ];

    const preparation = prepareCompaction(messages, "system prompt", {
      reserveTokens: 100,
      keepRecentTokens: 4,
    });

    expect(preparation).not.toBeNull();
    expect(preparation?.previousSummary).toBe("Earlier work");
    expect(preparation?.messagesToSummarize[0]).toEqual(user("Handle migration edge cases"));
    expect(preparation?.messagesToSummarize.some((message) => message.role === "system")).toBe(false);
  });

  it("serializes tool results with truncation markers", () => {
    const transcript = serializeConversation([user("Read the output"), toolResult("call-1", "bash", "x".repeat(2105))]);

    expect(transcript).toContain("[Tool result]:");
    expect(transcript).toContain("more characters truncated");
  });

  it("builds the effective transcript from the latest persisted checkpoint", () => {
    const rawMessages = [
      user("old request"),
      assistantText("old answer"),
      user("new request"),
      assistantText("new answer"),
      user("latest request"),
    ];
    const seqs = [1, 2, 3, 4, 5];
    const timestamps = seqs.map((seq) => new Date(`2026-03-20T00:00:0${seq}.000Z`));
    const checkpoint: PersistedCompaction = {
      firstKeptSeq: 4,
      summary: "Summarized old work",
      tokensBefore: 1234,
      createdAt: new Date("2026-03-20T00:00:10.000Z"),
    };

    const transcript = buildEffectiveTranscript(rawMessages, seqs, timestamps, checkpoint);

    expect(transcript.messages).toHaveLength(3);
    expect(transcript.seqs).toEqual([null, 4, 5]);
    expect(transcript.messages[0]).toEqual(createCompactionSummaryMessage("Summarized old work"));
    expect(
      transcript.messages[0]?.role === "system" && typeof transcript.messages[0].content === "string"
        ? transcript.messages[0].content
        : "",
    ).toContain(COMPACTION_SUMMARY_HEADER);
  });
});

describe("appendActiveCriteriaBlock", () => {
  // §14 Phase 2 item 3: the summarization model paraphrases everything else in the compaction
  // summary, but the exact acceptance criteria must survive verbatim — this is the deterministic
  // (non-LLM) safeguard for that, appended after whatever prose summary was generated.
  it("appends the current criteria verbatim after the prose summary", () => {
    const result = appendActiveCriteriaBlock("## Goal\nBuild a clock.", [
      { id: "AC1", description: "Clock ticks every second", verification: "curl and observe" },
      { id: "AC2", description: "Time is correct", verification: "compare to system clock" },
    ]);

    expect(result).toBe(
      [
        "## Goal",
        "Build a clock.",
        "",
        "## Active Acceptance Criteria (verbatim — do not paraphrase or drop these)",
        "- AC1: Clock ticks every second (verify: curl and observe)",
        "- AC2: Time is correct (verify: compare to system clock)",
      ].join("\n"),
    );
  });

  it("is a no-op when there are no criteria to preserve", () => {
    expect(appendActiveCriteriaBlock("## Goal\nJust chatting.", null)).toBe("## Goal\nJust chatting.");
    expect(appendActiveCriteriaBlock("## Goal\nJust chatting.", [])).toBe("## Goal\nJust chatting.");
  });

  it("trims the prose summary before appending, so no stray blank line sits between them", () => {
    const result = appendActiveCriteriaBlock("## Goal\nBuild a clock.\n\n\n", [
      { id: "AC1", description: "Ticks", verification: "observe" },
    ]);
    expect(result).toBe(
      "## Goal\nBuild a clock.\n\n## Active Acceptance Criteria (verbatim — do not paraphrase or drop these)\n- AC1: Ticks (verify: observe)",
    );
  });
});
