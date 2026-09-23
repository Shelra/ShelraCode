# Project rules

Rules this team agreed on. Every change follows them.

- **Logs never hold personal data.** Nothing the app logs contains personal data: no email addresses, names or
  tokens. Log the user's id instead. Logs are shipped to a third-party service and kept for a year. Checked by
  `bun scripts/check-logs.ts`.
