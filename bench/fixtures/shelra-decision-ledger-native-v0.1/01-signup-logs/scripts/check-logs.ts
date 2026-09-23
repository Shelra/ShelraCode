// The check of D-0001: run the sign-up paths and fail if anything they print holds personal data.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { inspect } from "node:util";

const printed: string[] = [];
const write = process.stdout.write.bind(process.stdout);
const text = (value: unknown) => (typeof value === "string" ? value : inspect(value, { depth: 6 }));
for (const method of ["log", "info", "warn", "error", "debug", "trace"] as const) {
  console[method] = (...args: unknown[]) => {
    printed.push(args.map(text).join(" "));
  };
}
process.stdout.write = ((chunk: unknown) => {
  printed.push(String(chunk));
  return true;
}) as typeof process.stdout.write;
process.stderr.write = process.stdout.write;

const { resetUsers, signUp } = await import(pathToFileURL(resolve(process.cwd(), "src/users.ts")).href);
resetUsers();
signUp({ email: "Ada.Lovelace@example.com", name: "Ada Lovelace" });
signUp({ email: "ada.lovelace@example.com", name: "Ada King" });
signUp({ email: "grace.hopper-at-navy", name: "Grace Hopper" });

const personal = ["ada.lovelace", "example.com", "lovelace", "ada king", "grace", "hopper", "navy"];
const leaks = printed.filter((line) => personal.some((item) => line.toLowerCase().includes(item)));
if (leaks.length > 0) {
  write(`D-0001 broken: logs hold personal data:\n${leaks.map((line) => `  ${line.trim()}`).join("\n")}\n`);
  process.exit(1);
}
write("D-0001 holds: no personal data in the logs\n");
