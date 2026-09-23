# Project rules

Rules this team agreed on. Every change follows them.

- **Timestamps are stored in UTC ISO-8601.** Every stored timestamp is a UTC ISO-8601 string made with Date.toISOString(). Local times and friendlier formats appear only where the UI renders a value, never in stored data. Reminders fired an hour late for every user outside the server's timezone until timestamps were normalized. Checked by `bun scripts/check-timestamps.ts`.
