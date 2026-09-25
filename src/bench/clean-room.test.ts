import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userMemoryScope } from "../memory/store";
import { loadCustomInstructions } from "../utils/instructions";
import { loadUserSettings } from "../utils/settings";
import { discoverSkills } from "../utils/skills";
import { enterBenchCleanRoom } from "./clean-room";

let base: string;
let personalHome: string;
let saved: { HOME?: string; USERPROFILE?: string };

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "shelra-clean-room-test-"));
  // A person's own home, with the settings, skill and instructions a benchmark task must not see.
  personalHome = join(base, "person");
  mkdirSync(join(personalHome, ".shelra"), { recursive: true });
  writeFileSync(
    join(personalHome, ".shelra", "user-settings.json"),
    JSON.stringify({ shell: { destructive: "allow" } }),
  );
  writeFileSync(join(personalHome, ".shelra", "AGENTS.md"), "Personal instructions.\n");
  mkdirSync(join(personalHome, ".agents", "skills", "personal-skill"), { recursive: true });
  writeFileSync(
    join(personalHome, ".agents", "skills", "personal-skill", "SKILL.md"),
    "---\nname: personal-skill\ndescription: d\n---\n",
  );
  saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = personalHome;
  process.env.USERPROFILE = personalHome;
});

afterEach(() => {
  for (const key of ["HOME", "USERPROFILE"] as const) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  rmSync(base, { recursive: true, force: true });
});

describe("enterBenchCleanRoom", () => {
  it("hides the person's settings, skills, instructions and memory from a run, and gives them back after", () => {
    const workspace = join(base, "task");
    mkdirSync(workspace);
    expect(loadUserSettings().shell?.destructive).toBe("allow");
    expect(discoverSkills(workspace).map((skill) => skill.name)).toContain("personal-skill");
    expect(loadCustomInstructions(workspace)).toContain("Personal instructions.");

    // A user-wide memory store named apart from HOME is the person's too (Vitest names one for every test).
    const memoryRoot = process.env.SHELRA_USER_MEMORY_ROOT;
    const room = enterBenchCleanRoom(base);
    try {
      expect(loadUserSettings()).toEqual({});
      expect(discoverSkills(workspace).map((skill) => skill.name)).not.toContain("personal-skill");
      expect(loadCustomInstructions(workspace)).toBeNull();
      expect(userMemoryScope().workspace).toBe(room.home);
      expect(readFileSync(join(room.home, ".gitconfig"), "utf8")).toContain("Shelra Bench");
      expect(room.realHome).toEqual({ HOME: personalHome, USERPROFILE: personalHome });
      expect(relative(room.root, room.taskRoot).startsWith("..")).toBe(false);
    } finally {
      room.leave();
    }

    expect(process.env.HOME).toBe(personalHome);
    expect(process.env.SHELRA_USER_MEMORY_ROOT).toBe(memoryRoot);
    expect(loadUserSettings().shell?.destructive).toBe("allow");
  });
});
