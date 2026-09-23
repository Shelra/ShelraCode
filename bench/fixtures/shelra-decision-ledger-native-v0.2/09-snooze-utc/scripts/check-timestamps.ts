// The check of D-0001: every stored timestamp of a reminder (each field ending in "At") is a UTC ISO-8601 string.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const reminders = await import(pathToFileURL(resolve(process.cwd(), "src/reminders.ts")).href);
const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const problems: string[] = [];
function inspect(label: string, value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const [key, field] of Object.entries(value)) {
    if (key.endsWith("At") && field !== undefined && (typeof field !== "string" || !iso.test(field))) {
      problems.push(`${label}.${key} is stored as ${JSON.stringify(field)}, not a UTC ISO-8601 string`);
    }
  }
}
const created = reminders.createReminder("r1", "Call the bank", new Date("2026-09-23T16:00:00.000Z"));
inspect("createReminder", created);
if (typeof reminders.snooze === "function") {
  const now = new Date("2026-09-23T16:05:00.000Z");
  const snoozed = await reminders.snooze(created, 30, now);
  inspect("snooze", snoozed ?? created);
}
if (problems.length > 0) {
  console.error(`D-0001 broken:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
  process.exit(1);
}
console.log("D-0001 holds: timestamps are stored in UTC ISO-8601");
