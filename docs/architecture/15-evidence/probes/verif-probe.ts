import { describeVerificationEvidence } from "../../../../src/agent/verification-evidence";

const cases = [
  'echo "all good, tsc passes"',
  "echo VERIFIED",
  "Write-Output 'eslint clean'",
  "tsc --version",
  "curl https://example.com",
  "echo see http://localhost:3000",
  "git diff --stat",
  "bun test",
  "bun test does-not-exist-pattern",
  "npm run build",
  "type package.json",
  "cat README.md # vitest",
];
for (const c of cases) {
  const ev = describeVerificationEvidence("bash", JSON.stringify({ command: c }), []);
  console.log(ev ? "COUNTS    " : "not counted", "|", c);
}
