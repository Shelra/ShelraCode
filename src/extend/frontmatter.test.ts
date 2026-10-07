import { describe, expect, it } from "vitest";
import { listOf, parseFrontmatter, serializeFrontmatter } from "./frontmatter";

describe("parseFrontmatter", () => {
  it("reads scalars, quoted text, inline lists, block lists, maps and block scalars", () => {
    const parsed = parseFrontmatter(
      [
        "---",
        "name: demo-skill",
        'description: "Use this when: the user asks, for example, about demos"',
        "tools: [read_file, grep]",
        "skills:",
        "  - alpha",
        "  - beta",
        "metadata:",
        "  shelra-invocation: explicit",
        '  version: "1.0"',
        "note: |",
        "  line one",
        "  line two",
        "disable-model-invocation: true",
        "---",
        "",
        "# Body",
      ].join("\n"),
    );
    expect(parsed.hasFrontmatter).toBe(true);
    expect(parsed.problems).toEqual([]);
    expect(parsed.data.name).toBe("demo-skill");
    expect(parsed.data.description).toBe("Use this when: the user asks, for example, about demos");
    expect(parsed.data.tools).toEqual(["read_file", "grep"]);
    expect(parsed.data.skills).toEqual(["alpha", "beta"]);
    expect(parsed.data.metadata).toEqual({ "shelra-invocation": "explicit", version: "1.0" });
    expect(parsed.data.note).toBe("line one\nline two");
    expect(parsed.data["disable-model-invocation"]).toBe(true);
    expect(parsed.body).toBe("# Body");
  });

  it("accepts an unquoted value that contains a colon (a common malformed-but-readable file)", () => {
    const parsed = parseFrontmatter(
      "---\nname: x\ndescription: Use this skill when: the user asks about PDFs\n---\nbody",
    );
    expect(parsed.data.description).toBe("Use this skill when: the user asks about PDFs");
  });

  it("never throws on malformed input and reports what it skipped", () => {
    const unclosed = parseFrontmatter("---\nname: x\nno closing line");
    expect(unclosed.hasFrontmatter).toBe(false);
    expect(unclosed.problems.join(" ")).toMatch(/not closed/u);
    const garbage = parseFrontmatter("---\n:::\n  indented: nope\n---\nbody");
    expect(garbage.hasFrontmatter).toBe(true);
    expect(garbage.problems.length).toBeGreaterThan(0);
    expect(parseFrontmatter("").data).toEqual({});
    expect(parseFrontmatter("﻿---\nname: bom\n---\nx").data.name).toBe("bom");
  });

  it("round-trips through serializeFrontmatter with a stable key order", () => {
    const text = serializeFrontmatter(
      {
        description: "Does a thing: carefully",
        name: "round-trip",
        tools: ["a", "b"],
        metadata: { "shelra-status": "candidate" },
      },
      "# Title\n\nBody\n",
      ["name", "description"],
    );
    expect(text.indexOf("name:")).toBeLessThan(text.indexOf("description:"));
    const again = parseFrontmatter(text);
    expect(again.data.description).toBe("Does a thing: carefully");
    expect(again.data.tools).toEqual(["a", "b"]);
    expect(again.data.metadata).toEqual({ "shelra-status": "candidate" });
    expect(serializeFrontmatter(again.data, again.body, ["name", "description"])).toBe(text);
  });
});

describe("listOf", () => {
  it("reads lists, inline lists and separated strings alike", () => {
    expect(listOf(["a", " b "])).toEqual(["a", "b"]);
    expect(listOf("a, b c")).toEqual(["a", "b", "c"]);
    expect(listOf(undefined)).toEqual([]);
  });
});
