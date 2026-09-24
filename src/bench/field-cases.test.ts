import { describe, expect, it } from "vitest";
import { type FieldCase, redact, renderScoreboard, summarizeTurns } from "./field-cases";

const at = (minute: number) => `2026-09-22T21:${String(minute).padStart(2, "0")}:00.000Z`;

describe("summarizeTurns", () => {
  it("counts completion-gate rounds and tool calls inside the user's turn", () => {
    // The shape of the first field case: one request, a first answer after 47 calls, three gate rounds.
    const messages = [
      { seq: 1, role: "user", text: "google meet says my camera is in use", createdAt: at(56) },
      { seq: 96, role: "assistant", text: "Google Chrome is holding the camera.", createdAt: at(56) },
      { seq: 97, role: "user", text: "Completion blocked: you changed 2 file(s)", createdAt: at(57) },
      { seq: 102, role: "assistant", text: "Both scripts verified.", createdAt: at(57) },
      { seq: 103, role: "user", text: "Completion blocked: you changed 2 file(s)", createdAt: at(58) },
      { seq: 106, role: "assistant", text: "Verified.", createdAt: at(58) },
      { seq: 107, role: "user", text: "Completion blocked: you changed 2 file(s)", createdAt: at(59) },
      { seq: 116, role: "assistant", text: "Verified again.", createdAt: at(59) },
      { seq: 117, role: "user", text: "here is the output", createdAt: at(59) },
      { seq: 118, role: "assistant", text: "Confirmed.", createdAt: at(59) },
    ];
    const toolCalls = [
      ...Array.from({ length: 47 }, (_, index) => ({ messageSeq: 2 + index })),
      ...Array.from({ length: 7 }, (_, index) => ({ messageSeq: 98 + index })),
    ];
    const [first, second] = summarizeTurns(messages, toolCalls);

    expect(first?.toolCallsBeforeFirstAnswer).toBe(47);
    expect(first?.toolCalls).toBe(54);
    expect(first?.gateLoops).toBe(3);
    expect(first?.firstAnswer).toBe("Google Chrome is holding the camera.");
    expect(second?.prompt).toBe("here is the output");
    expect(second?.gateLoops).toBe(0);
  });
});

describe("redact", () => {
  const identity = { home: "C:\\Users\\Ana", user: "Ana", host: "ANA-LAPTOP" };

  it("removes the home folder in both slash styles, the user and the machine name", () => {
    expect(redact("saved C:\\Users\\Ana\\check.ps1 and c:/users/ana/x.txt", identity)).toBe(
      "saved ~\\check.ps1 and ~/x.txt",
    );
    expect(redact("User: ANA-LAPTOP\\Ana", identity)).toBe("User: <host>\\<user>");
  });

  it("leaves short names alone rather than rewriting ordinary words", () => {
    expect(redact("an item", { home: "", user: "an", host: "" })).toBe("an item");
  });

  it("removes the user name in a memory entry's slug and between underscores", () => {
    // Review round 3 (2026-09-24): slugs reach the committed history through `memoryWritten`.
    const john = { home: "C:\\Users\\john.doe", user: "john.doe", host: "" };
    expect(redact("failure-cd-c-users-john-doe-appdata-local-temp", john)).toBe(
      "failure-cd-c-users-<user>-appdata-local-temp",
    );
    expect(redact("users_ana_x", identity)).toBe("users_<user>_x");
    expect(redact("banana and Anastasia", identity)).toBe("banana and Anastasia");
  });
});

describe("renderScoreboard", () => {
  it("renders first attempts and re-runs", () => {
    const item: FieldCase = {
      id: "001-camera",
      date: "2026-09-22",
      title: "Camera busy",
      setting: "Windows 11, home folder",
      prompt: "camera busy",
      shelra: {
        date: "2026-09-22",
        model: "openrouter/free-model:free",
        cost: "free",
        seconds: 383,
        secondsApprox: true,
        toolCalls: 47,
        gateLoops: 3,
        solved: true,
        attemptsToSolve: 1,
        result: "named the app",
      },
      reference: { agent: "Claude Sonnet 5", solved: true, attemptsToSolve: 3 },
      reruns: [
        { date: "2026-09-22", commit: "abc1234", model: "free-model", cost: "free", seconds: 316, result: "a | b" },
      ],
    };
    const board = renderScoreboard([item]);
    expect(board).toContain(
      "| [001-camera](cases/001-camera.json) Camera busy | 2026-09-22 | free-model:free (free) | yes | 1 | ~6.4 min | 47 | 3 | Claude Sonnet 5 | 3 |",
    );
    expect(board).toContain("| 001-camera | 2026-09-22 | abc1234 | free-model (free) | 5.3 min |  |  | a \\| b |");
  });
});
