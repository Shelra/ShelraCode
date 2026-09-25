import { describe, expect, it } from "vitest";
import { chatFolder, chatLabel, chatMeta, parseResumeCommand, relativeTime, wrapWords } from "./resume";

const now = new Date(2026, 8, 25, 12, 0, 0);
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

describe("the /resume list", () => {
  it("names a chat by its title, else by what the user first asked", () => {
    expect(chatLabel({ title: "Mario Kart racer", firstRequest: "Create a game" })).toBe("Mario Kart racer");
    expect(chatLabel({ title: null, firstRequest: "Create a complete racing game" })).toBe(
      "Create a complete racing game",
    );
    expect(chatLabel({ title: "  ", firstRequest: null })).toBe("Untitled chat");
  });

  it("says when a chat was last used the way a person would", () => {
    expect(relativeTime(ago(0), now)).toBe("just now");
    expect(relativeTime(ago(5), now)).toBe("5m ago");
    expect(relativeTime(ago(3 * 60), now)).toBe("3h ago");
    expect(relativeTime(ago(26 * 60), now)).toBe("yesterday");
    expect(relativeTime(ago(4 * 24 * 60), now)).toBe("4d ago");
    expect(relativeTime(new Date(2026, 8, 12, 9, 0), now)).toBe("Sep 12");
  });

  it("gives each chat its size, age and model, and its folder by its last parts", () => {
    const chat = {
      messages: 42,
      updatedAt: ago(90),
      model: "openrouter/qwen/qwen3-235b-a22b-2507",
      workspace: "D:/PROYECTS/test-shelra/02-Mario Kart-style 3D racing game",
    };
    expect(chatMeta(chat, now)).toBe("42 messages · 1h ago · qwen3-235b-a22b-2507");
    expect(chatMeta({ ...chat, messages: 1 }, now)).toMatch(/^1 message ·/);
    expect(chatFolder(chat, 30)).toBe("02-Mario Kart-style 3D racing…");
    expect(chatFolder({ workspace: "D:/PROYECTS/shelra" }, 30)).toBe("D:/PROYECTS/shelra");
    expect(chatFolder({ workspace: "D:\\PROYECTS\\test-shelra\\snake" }, 20)).toBe("…/test-shelra/snake");
  });

  it("wraps a reason at its spaces and cuts a path too long for a line, losing no character", () => {
    const reason =
      'That chat belongs to D:\\PROYECTS\\test-shelra\\racing. Continue it there: cd "D:\\PROYECTS"; shelra -s ab12';
    const lines = wrapWords(reason, 24);
    expect(lines.every((line) => line.length <= 24)).toBe(true);
    expect(lines.join("").replace(/\s/g, "")).toBe(reason.replace(/\s/g, ""));
    expect(lines.at(-1)).toContain("ab12");
    expect(wrapWords("short one", 24)).toEqual(["short one"]);
    expect(wrapWords("x".repeat(50), 20)).toEqual(["x".repeat(20), "x".repeat(20), "x".repeat(10)]);
  });

  it("reads /resume and /sessions, with or without every folder", () => {
    expect(parseResumeCommand("/resume")).toEqual({ all: false });
    expect(parseResumeCommand("/RESUME --all")).toEqual({ all: true });
    expect(parseResumeCommand("/sessions all")).toEqual({ all: true });
    expect(parseResumeCommand("/resume something")).toBeNull();
    expect(parseResumeCommand("/review")).toBeNull();
  });
});
