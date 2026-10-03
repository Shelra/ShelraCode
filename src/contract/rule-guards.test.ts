import { describe, expect, it } from "vitest";
import { describeRule, logCalls, type RuleInForce, ruleViolations, withoutStringLiterals } from "./rule-guards";

const LOG_RULE: RuleInForce = { text: "Logs must never contain email addresses", origin: "standing-rule" };
const DELETE_RULE: RuleInForce = {
  text: "This project never removes rows from its database: deleting a user sets its deleted_at column",
  origin: "request",
};

const file = (after: string, before = "", path = "src/loans.ts") => ({ path, before, after });
const logViolations = (after: string, before = "", request = "Log each change.", path?: string) =>
  ruleViolations({ rules: [LOG_RULE], request, files: [file(after, before, path)], addedDependencies: [] });

describe("rule guards", () => {
  it("find log calls up to their closing parenthesis, and keep what template literals and f-strings interpolate", () => {
    // The strings below are source code under test, template literals included.
    const tick = "`";
    const code = `log(${tick}loan \${loan.id} (\${user.email})${tick});\nconsole.info("a)", {\n  userId,\n});\nMath.log(emailCount);\n`;
    expect(logCalls(code)).toEqual([
      `log(${tick}loan \${loan.id} (\${user.email})${tick})`,
      'console.info("a)", {\n  userId,\n})',
    ]);
    expect(withoutStringLiterals(`log("email changed", ${tick}for \${user.email}${tick}, 'x')`)).toBe(
      'log("",  user.email , "")',
    );
    expect(withoutStringLiterals('print(f"changed {user.email} at {when}")')).toBe('print(f"" user.email  when )');
  });

  it("hold a log call that newly passes an email, as an identifier, a key, an interpolation or an f-string", () => {
    for (const after of [
      'log("user email changed", { userId: user.id, email: body.email });\n',
      "logger.info({ email });\n",
      `log.info(\`changed to \${newEmail}\`);\n`,
      'print(f"changed to {user.email}")\n',
    ]) {
      const violations = logViolations(after, 'log("user created", { userId: user.id });\n');
      expect(violations, after).toHaveLength(1);
      expect(violations[0]?.detail, after).toContain("logs an email address");
    }
  });

  it("let through what only looks like an email: the word, a flag, a count, a pattern, a masked value, a call", () => {
    for (const after of [
      'log("user changed their email", { userId: user.id });\n',
      "logger.info({ emailVerified, count: emailsSent });\n",
      "log(emailRegex);\n",
      "console.log(isEmail(x));\n",
      "console.log(maskEmail(user.email));\n",
      "const ratio = Math.log(emailCount);\n",
      '// log("debug", user.email)\nlog("done");\n',
    ]) {
      expect(logViolations(after), after).toEqual([]);
    }
  });

  it("do not blame a reformatted call that already logged the value, a test, or a log the request asks for", () => {
    expect(
      logViolations('console.log(\n  "signup",\n  user.email,\n);\n', 'console.log("signup", user.email);\n'),
    ).toEqual([]);
    expect(logViolations("log(user.email);\n", "", "Add a test.", "test/email.test.ts")).toEqual([]);
    expect(
      logViolations(`log(\`email now \${newEmail}\`);\n`, "", "For this audit, log the new email of each user."),
    ).toEqual([]);
  });

  it("hold a new DELETE under a soft-delete rule, outside comments, within a decision's scope, unless asked for", () => {
    const sql = 'db.run("DELETE FROM users WHERE id = ?", [id]);\n';
    const run = (rules: RuleInForce[], request: string, after: string, before = "", path?: string) =>
      ruleViolations({ rules, request, files: [file(after, before, path)], addedDependencies: [] });
    expect(run([DELETE_RULE], "Add POST /admin/cleanup: remove idle users.", sql)).toEqual([
      { kind: "hard-delete", rule: DELETE_RULE, detail: "src/loans.ts adds a DELETE statement" },
    ]);
    expect(
      run([DELETE_RULE], "Remove idle users.", "// DELETE FROM users is not allowed here\nsoftDelete(id);\n"),
    ).toEqual([]);
    expect(run([DELETE_RULE], "GDPR erasure: permanently delete the user's rows.", sql)).toEqual([]);
    expect(run([DELETE_RULE], "Rename the cleanup endpoint.", sql, sql)).toEqual([]);
    const scoped: RuleInForce = { ...DELETE_RULE, origin: "decision", id: "D-0002", scope: ["src/users/**"] };
    expect(run([scoped], "Empty the cache.", 'db.run("DELETE FROM cache");\n', "", "src/cache/store.ts")).toEqual([]);
    expect(run([scoped], "Remove idle users.", sql, "", "src/users/cleanup.ts")).toHaveLength(1);
  });

  it("report a dependency only under a rule against them, say where each rule comes from, and do nothing without one", () => {
    const rule: RuleInForce = { text: "This project stays dependency-free", origin: "decision", id: "D-0004" };
    expect(
      ruleViolations({ rules: [rule], request: "Export CSV.", files: [], addedDependencies: ["papaparse"] }),
    ).toEqual([{ kind: "dependency", rule, detail: "added papaparse" }]);
    expect(describeRule(rule)).toBe('decision D-0004 says: "This project stays dependency-free"');
    expect(describeRule(LOG_RULE)).toBe('your standing rule says: "Logs must never contain email addresses"');
    expect(
      ruleViolations({
        rules: [{ text: "Always store money as integer cents", origin: "standing-rule" }],
        request: "Log the email change and clean up users.",
        files: [file('log({ email }); db.run("DELETE FROM users");\n')],
        addedDependencies: ["papaparse"],
      }),
    ).toEqual([]);
  });
});
