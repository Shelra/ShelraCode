import { describe, expect, it } from "vitest";
import { splitFences, tokenizeLine } from "./code-highlight";

const kinds = (line: string, lang: string) => tokenizeLine(line, lang).map((token) => `${token.kind}:${token.text}`);

describe("tokenizeLine", () => {
  it("colours keywords, types, strings and numbers in TypeScript", () => {
    expect(kinds('export const limit: Session = "a";', "ts")).toEqual([
      "keyword:export",
      "plain: ",
      "keyword:const",
      "plain: limit: ",
      "type:Session",
      "plain: = ",
      'string:"a"',
      "plain:;",
    ]);
    expect(kinds("return now <= 5;", "typescript")).toContain("number:5");
  });

  it("treats the rest of the line as a comment", () => {
    expect(kinds("const a = 1; // done", "ts")).toEqual([
      "keyword:const",
      "plain: a = ",
      "number:1",
      "plain:; ",
      "comment:// done",
    ]);
    expect(kinds("echo hi # note", "bash").at(-1)).toBe("comment:# note");
  });

  it("carries a block comment across lines", () => {
    const state = { block: false };
    expect(tokenizeLine("/* start", "ts", state).map((t) => t.kind)).toEqual(["comment"]);
    expect(state.block).toBe(true);
    expect(tokenizeLine("end */ const x", "ts", state).map((t) => t.kind)).toEqual([
      "comment",
      "plain",
      "keyword",
      "plain",
    ]);
    expect(state.block).toBe(false);
  });

  it("does not colour inside strings", () => {
    expect(kinds('"const // not a comment"', "ts")).toEqual(['string:"const // not a comment"']);
  });

  it("leaves unknown languages as plain text", () => {
    expect(kinds("whatever const", "brainfuck")).toEqual(["plain:whatever const"]);
    expect(kinds("plain text", "")).toEqual(["plain:plain text"]);
  });

  it("never loses or duplicates characters", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: template-literal syntax is the input under test
    const line = 'const a = `x${b}` + "q" /* c */ + 0x1F; // end';
    expect(
      tokenizeLine(line, "ts")
        .map((token) => token.text)
        .join(""),
    ).toBe(line);
  });
});

describe("splitFences", () => {
  it("separates prose from fenced code and keeps the language", () => {
    const segments = splitFences("Intro\n\n```ts\nconst a = 1;\n```\n\nOutro");
    expect(segments.map((s) => `${s.kind}:${s.lang}:${s.text}`)).toEqual([
      "text::Intro",
      "code:ts:const a = 1;",
      "text::Outro",
    ]);
  });

  it("treats an unclosed fence as code so a streaming block never leaks backticks", () => {
    const segments = splitFences("Before\n```sh\nbun test");
    expect(segments.map((s) => s.kind)).toEqual(["text", "code"]);
    expect(segments[1]?.text).toBe("bun test");
  });

  it("returns one text segment when there is no code", () => {
    expect(splitFences("Just prose.\n\n- a\n- b")).toEqual([
      { kind: "text", text: "Just prose.\n\n- a\n- b", lang: "" },
    ]);
  });

  it("handles tilde fences and blank code", () => {
    expect(splitFences("~~~\nx\n~~~").map((s) => s.kind)).toEqual(["code"]);
    expect(splitFences("")).toEqual([]);
  });
});
