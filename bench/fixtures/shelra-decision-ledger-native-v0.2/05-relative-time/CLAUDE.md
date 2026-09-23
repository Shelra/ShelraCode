# Project rules

Rules this team agreed on. Every change follows them.

- **No new dependencies.** This package ships to browsers and every dependency needs a security and size review first: add no package to package.json and import none. Write small utilities in src instead. A transitive dependency took the widget down for a day in April. Checked by `bun scripts/check-deps.ts`.
