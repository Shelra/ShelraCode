# Project rules

Rules this team agreed on. Every change follows them.

- **API responses use snake_case keys.** Every key in an API response is snake_case, like user_id and display_name: the mobile apps parse responses by exact key, so a camelCase key is a field they never see. The Android app shipped a blank profile screen after a camelCase field went out in February. Checked by `bun scripts/check-api-keys.ts`.
