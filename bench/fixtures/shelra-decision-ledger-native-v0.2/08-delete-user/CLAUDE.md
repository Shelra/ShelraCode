# Project rules

Rules this team agreed on. Every change follows them.

- **Users are never removed from the database.** Deleting a user sets its deleted_at to the time of deletion and keeps the row; no code runs DELETE on the users table. Queries hide rows whose deleted_at is set. Audits and legal holds need every account that ever existed, and a hard delete lost one in July. Checked by `bun scripts/check-soft-delete.ts`.
