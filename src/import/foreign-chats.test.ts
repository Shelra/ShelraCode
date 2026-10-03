import { describe, expect, it } from "vitest";
import { buildImportedTranscript, type ForeignChat, type ForeignEvent } from "./foreign-chats";

const at = (minute: number) => new Date(Date.UTC(2026, 8, 20, 10, minute));

function chat(events: ForeignEvent[], overrides: Partial<ForeignChat> = {}): ForeignChat {
  return {
    source: "claude-code",
    sourceId: "5f0f24d0-aaaa-bbbb-cccc-000000000000",
    path: "/home/dev/.claude/projects/-work-kart/5f0f24d0.jsonl",
    title: "Kart game",
    cwd: "/work/kart",
    model: "claude-sonnet-5",
    createdAt: at(0),
    updatedAt: at(30),
    events,
    ...overrides,
  };
}

describe("a foreign chat as Shelra messages", () => {
  it("makes each request one user message and everything until the next one reply, its tools named at its end", () => {
    const transcript = buildImportedTranscript(
      chat([
        { kind: "user", text: "Build the kart game", at: at(0) },
        { kind: "assistant", text: "I'll start with the track.", at: at(1) },
        { kind: "tool", changed: ["/work/kart/src/track.ts"], at: at(2) },
        { kind: "tool", command: "bun test\n--watch=false", at: at(3) },
        { kind: "tool", changed: ["/work/kart/src/track.ts", "/elsewhere/notes.md"], at: at(4) },
        { kind: "tool", at: at(5) },
        { kind: "assistant", text: "The track is in place and its tests pass.", at: at(6) },
        { kind: "user", text: "Add a boss level", at: at(7) },
        { kind: "user", text: "with lava", at: at(8) },
        { kind: "user", text: "with lava", at: at(8) },
      ]),
      { importedAt: at(40) },
    );

    expect(transcript.messages.map((entry) => entry.message)).toEqual([
      { role: "user", content: "Build the kart game" },
      {
        role: "assistant",
        content:
          "I'll start with the track.\n\nThe track is in place and its tests pass.\n\n" +
          "[In Claude Code: changed src/track.ts, /elsewhere/notes.md; ran `bun test`; 1 other tool call]",
      },
      { role: "user", content: "Add a boss level\n\nwith lava" },
    ]);
    expect(transcript.messages[1]?.at).toEqual(at(6));
    expect(transcript.firstKeptIndex).toBe(0);
    expect(transcript.checkpoint).toContain(
      "This chat was started in Claude Code and imported into Shelra on 2026-09-20",
    );
    expect(transcript.checkpoint).toContain("folder /work/kart, model claude-sonnet-5");
    expect(transcript.checkpoint).toContain("their output was not kept");
    expect(transcript.checkpoint).not.toContain("Earlier requests");
  });

  it("keeps a long chat's latest turns in full and lists its earlier requests and changed files in the checkpoint", () => {
    const events: ForeignEvent[] = [];
    for (let turn = 0; turn < 60; turn += 1) {
      events.push({ kind: "user", text: `Request number ${turn}`, at: at(turn) });
      events.push({ kind: "tool", changed: [`/work/kart/src/file-${turn}.ts`], at: at(turn) });
      events.push({ kind: "assistant", text: `Reply ${turn} ${"x".repeat(400)}`, at: at(turn) });
    }

    const transcript = buildImportedTranscript(chat(events), { keepRecentTokens: 1_000 });

    expect(transcript.messages).toHaveLength(120);
    const firstKept = transcript.messages[transcript.firstKeptIndex]?.message;
    expect(firstKept?.role).toBe("user");
    expect(transcript.firstKeptIndex).toBeGreaterThan(100);
    const kept = transcript.messages.slice(transcript.firstKeptIndex);
    expect(kept.at(-1)?.message.content).toContain("Reply 59");
    expect(transcript.checkpoint).toContain(`The ${transcript.firstKeptIndex} earliest messages are not repeated here`);
    expect(transcript.checkpoint).toContain("1. Request number 0");
    expect(transcript.checkpoint).toContain("more requests …");
    expect(transcript.checkpoint).toContain("src/file-0.ts");
    // A request the model reads in full is not listed again.
    expect(transcript.checkpoint).not.toContain(String(firstKept?.content));
    expect(transcript.tokensBefore).toBeGreaterThan(1_000);
  });

  it("keeps a last turn larger than the budget whole rather than none", () => {
    const transcript = buildImportedTranscript(
      chat([
        { kind: "user", text: "First", at: at(0) },
        { kind: "assistant", text: "Done.", at: at(1) },
        { kind: "user", text: "Second", at: at(2) },
        { kind: "assistant", text: "y".repeat(20_000), at: at(3) },
      ]),
      { keepRecentTokens: 100 },
    );

    expect(transcript.firstKeptIndex).toBe(2);
    expect(transcript.checkpoint).toContain("1. First");
  });
});
