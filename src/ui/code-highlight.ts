/**
 * A small, dependency-free highlighter for the fenced code the agent writes into the transcript.
 * It is deliberately shallow: one line at a time, no parsing. Wrong-but-harmless beats slow, and an
 * unknown language falls back to plain text rather than guessing.
 */

export type CodeTokenKind = "keyword" | "string" | "comment" | "number" | "type" | "plain";

export interface CodeToken {
  text: string;
  kind: CodeTokenKind;
}

export interface FenceSegment {
  kind: "text" | "code";
  text: string;
  lang: string;
}

const JS_KEYWORDS = new Set(
  "abstract as async await break case catch class const continue debugger declare default delete do else enum export extends false finally for from function get if implements import in instanceof interface is keyof let namespace new null of private protected public readonly return set static super switch this throw true try type typeof undefined var void while with yield".split(
    " ",
  ),
);
const PY_KEYWORDS = new Set(
  "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield".split(
    " ",
  ),
);
const SHELL_KEYWORDS = new Set(
  "if then else elif fi for while until do done case esac function in select return export local set unset".split(" "),
);
const C_KEYWORDS = new Set(
  "break case char const continue default do double else enum extern false float for func go goto if impl import int interface let long match mod mut nil package pub return self short signed static struct switch trait true type typedef union unsigned use var void while".split(
    " ",
  ),
);

const LANGUAGES: Record<string, { keywords: Set<string>; lineComment: string | null; blockComment: boolean }> = {
  ts: { keywords: JS_KEYWORDS, lineComment: "//", blockComment: true },
  tsx: { keywords: JS_KEYWORDS, lineComment: "//", blockComment: true },
  js: { keywords: JS_KEYWORDS, lineComment: "//", blockComment: true },
  jsx: { keywords: JS_KEYWORDS, lineComment: "//", blockComment: true },
  mjs: { keywords: JS_KEYWORDS, lineComment: "//", blockComment: true },
  json: { keywords: new Set(["true", "false", "null"]), lineComment: null, blockComment: false },
  py: { keywords: PY_KEYWORDS, lineComment: "#", blockComment: false },
  sh: { keywords: SHELL_KEYWORDS, lineComment: "#", blockComment: false },
  bash: { keywords: SHELL_KEYWORDS, lineComment: "#", blockComment: false },
  zsh: { keywords: SHELL_KEYWORDS, lineComment: "#", blockComment: false },
  go: { keywords: C_KEYWORDS, lineComment: "//", blockComment: true },
  rust: { keywords: C_KEYWORDS, lineComment: "//", blockComment: true },
  rs: { keywords: C_KEYWORDS, lineComment: "//", blockComment: true },
  c: { keywords: C_KEYWORDS, lineComment: "//", blockComment: true },
  cpp: { keywords: C_KEYWORDS, lineComment: "//", blockComment: true },
  java: { keywords: C_KEYWORDS, lineComment: "//", blockComment: true },
};

const ALIASES: Record<string, string> = {
  typescript: "ts",
  javascript: "js",
  python: "py",
  shell: "sh",
  console: "sh",
  golang: "go",
  "c++": "cpp",
};

/** Beyond this many lines a block is drawn plain: colour is for reading, not for logs. */
export const MAX_HIGHLIGHT_LINES = 160;

export function normalizeLang(lang: string): string {
  const key = lang.trim().toLowerCase();
  return ALIASES[key] ?? key;
}

const TOKEN_PATTERN =
  /("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`(?:[^`\\]|\\.)*`?)|(\b0x[0-9a-fA-F_]+\b|\b\d[\d_]*(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g;

/** Tokenises one line. `state.block` carries an open block comment over to the next line. */
export function tokenizeLine(line: string, lang: string, state: { block: boolean } = { block: false }): CodeToken[] {
  const spec = LANGUAGES[normalizeLang(lang)];
  if (!spec) return [{ text: line, kind: "plain" }];

  const tokens: CodeToken[] = [];
  const push = (text: string, kind: CodeTokenKind) => {
    if (!text) return;
    const last = tokens.at(-1);
    if (last && last.kind === kind) last.text += text;
    else tokens.push({ text, kind });
  };

  let rest = line;
  if (state.block) {
    const end = rest.indexOf("*/");
    if (end < 0) return [{ text: line, kind: "comment" }];
    push(rest.slice(0, end + 2), "comment");
    rest = rest.slice(end + 2);
    state.block = false;
  }

  let cursor = 0;
  const scan = rest;
  while (cursor < scan.length) {
    const remaining = scan.slice(cursor);
    if (spec.lineComment && remaining.startsWith(spec.lineComment)) {
      push(remaining, "comment");
      break;
    }
    if (spec.blockComment && remaining.startsWith("/*")) {
      const end = remaining.indexOf("*/", 2);
      if (end < 0) {
        push(remaining, "comment");
        state.block = true;
        break;
      }
      push(remaining.slice(0, end + 2), "comment");
      cursor += end + 2;
      continue;
    }
    TOKEN_PATTERN.lastIndex = cursor;
    const match = TOKEN_PATTERN.exec(scan);
    if (!match) {
      push(remaining, "plain");
      break;
    }
    // Stop the plain run at the next comment opener so it is not swallowed by punctuation.
    const nextComment = [spec.lineComment, spec.blockComment ? "/*" : null]
      .filter((opener): opener is string => opener !== null)
      .map((opener) => scan.indexOf(opener, cursor))
      .filter((index) => index >= 0)
      .sort((a, b) => a - b)[0];
    if (nextComment !== undefined && nextComment < match.index) {
      push(scan.slice(cursor, nextComment), "plain");
      cursor = nextComment;
      continue;
    }
    if (match.index > cursor) push(scan.slice(cursor, match.index), "plain");
    const [text, str, num, word] = match;
    if (str !== undefined) push(text, "string");
    else if (num !== undefined) push(text, "number");
    else if (word !== undefined) {
      if (spec.keywords.has(word)) push(text, "keyword");
      else if (/^[A-Z][A-Za-z0-9]*$/.test(word) && word.length > 1) push(text, "type");
      else push(text, "plain");
    }
    cursor = match.index + text.length;
  }
  return tokens;
}

/**
 * Splits markdown into prose and fenced code. An unclosed fence (a message still streaming in)
 * counts as code up to the end, so a half-arrived block never leaks backticks into the prose.
 */
export function splitFences(content: string): FenceSegment[] {
  const segments: FenceSegment[] = [];
  const lines = content.split("\n");
  let buffer: string[] = [];
  let fence: { lang: string; marker: string } | null = null;

  const flush = (kind: "text" | "code", lang = "") => {
    const text = buffer.join("\n");
    buffer = [];
    if (kind === "text" ? text.trim() === "" : text === "" && lang === "") return;
    segments.push({ kind, text: kind === "text" ? text.replace(/^\n+|\n+$/g, "") : text, lang });
  };

  for (const line of lines) {
    const open = line.match(/^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/);
    if (!fence && open) {
      flush("text");
      fence = { lang: open[2] ?? "", marker: (open[1] ?? "```")[0] ?? "`" };
      continue;
    }
    if (fence && new RegExp(`^\\s{0,3}${fence.marker}{3,}\\s*$`).test(line)) {
      flush("code", fence.lang);
      fence = null;
      continue;
    }
    buffer.push(line);
  }
  if (fence) flush("code", fence.lang);
  else flush("text");
  return segments;
}
