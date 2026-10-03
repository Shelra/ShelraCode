import { describe, expect, it } from "vitest";
import { logCalls, ruleViolations, withoutStringLiterals } from "./rule-guards";

const LOG_RULE = "Logs must never contain email addresses; that is a rule for the whole project from now on.";
const DELETE_RULE = "This project never removes rows from its database: deleting a user sets its deleted_at column.";

const file = (after: string, before = "", path = "src/loans.ts") => ({ path, before, after });

describe("rule guards", () => {
  it("find log calls up to their closing parenthesis, across lines and around parentheses in strings", () => {
    // The strings below are source code under test, template literals included.
    const tick = "`";
    const code = `log(${tick}loan \${loan.id} (\${user.email})${tick});\nconsole.info("a)", {\n  userId,\n});\n`;
    expect(logCalls(code)).toEqual([
      `log(${tick}loan \${loan.id} (\${user.email})${tick})`,
      'console.info("a)", {\n  userId,\n})',
    ]);
    expect(withoutStringLiterals(`log("email changed", ${tick}for \${user.email}${tick}, 'x')`)).toBe(
      'log("",  user.email , "")',
    );
  });

  it("hold a new log call that passes an email under a rule against emails in logs", () => {
    const violations = ruleViolations({
      rules: [LOG_RULE],
      request: "Users can now change their email. Log each change so support can see which user changed their email.",
      files: [
        file(
          'log("user email changed", { userId: user.id, email: body.email });\n',
          'log("user created", { userId: user.id });\n',
        ),
      ],
      addedDependencies: [],
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ kind: "sensitive-log", rule: LOG_RULE });
    expect(violations[0]?.detail).toContain("logs an email address");
  });

  it("let a log call that only says the word, or that the request asks for in so many words, through", () => {
    const quiet = ruleViolations({
      rules: [LOG_RULE],
      request: "Log each change so support can see which user changed their email.",
      files: [file('log("user changed their email", { userId: user.id });\n')],
      addedDependencies: [],
    });
    expect(quiet).toEqual([]);
    const asked = ruleViolations({
      rules: [LOG_RULE],
      request: "For this audit, log the new email of each user who changes it.",
      files: [file(`log(\`email now \${newEmail}\`);\n`)],
      addedDependencies: [],
    });
    expect(asked).toEqual([]);
    const tests = ruleViolations({
      rules: [LOG_RULE],
      request: "Add a test for the email change.",
      files: [file("log(user.email);\n", "", "test/email.test.ts")],
      addedDependencies: [],
    });
    expect(tests).toEqual([]);
  });

  it("hold a new DELETE under a soft-delete rule, unless the request asks for a hard delete", () => {
    const sql = 'db.run("DELETE FROM users WHERE id = ?", [id]);\n';
    const held = ruleViolations({
      rules: [DELETE_RULE],
      request: "Add POST /admin/cleanup: remove every user who has not borrowed a book in the last two years.",
      files: [file(sql, 'db.run("UPDATE users SET deleted_at = ? WHERE id = ?");\n')],
      addedDependencies: [],
    });
    expect(held).toEqual([{ kind: "hard-delete", rule: DELETE_RULE, detail: "src/loans.ts adds a DELETE statement" }]);
    const asked = ruleViolations({
      rules: [DELETE_RULE],
      request: "GDPR erasure: permanently delete the user's rows.",
      files: [file(sql)],
      addedDependencies: [],
    });
    expect(asked).toEqual([]);
    const existing = ruleViolations({
      rules: [DELETE_RULE],
      request: "Rename the cleanup endpoint.",
      files: [file(sql, sql)],
      addedDependencies: [],
    });
    expect(existing).toEqual([]);
  });

  it("report a dependency only under a rule against them, and nothing without any rule", () => {
    expect(
      ruleViolations({
        rules: ["From now on this project stays dependency-free."],
        request: "Export CSV.",
        files: [],
        addedDependencies: ["papaparse"],
      }),
    ).toEqual([
      { kind: "dependency", rule: "From now on this project stays dependency-free.", detail: "added papaparse" },
    ]);
    expect(
      ruleViolations({
        rules: ["Always store money as integer cents"],
        request: "Log the email change and clean up users.",
        files: [file('log({ email }); db.run("DELETE FROM users");\n')],
        addedDependencies: ["papaparse"],
      }),
    ).toEqual([]);
  });
});
