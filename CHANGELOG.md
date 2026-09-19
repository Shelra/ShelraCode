# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Transcript that shows what the agent read, changed and verified: one evidence row per action with real verbs and targets, folded reads and searches, test/type/lint results with failing names, and diffstats.
- "What Shelra knows" panel (`/memory`, `/skills`): project memory, skills and cross-project knowledge, with provenance and staleness.
- Shortcut help (`?`), width-aware key hints and a safer Ctrl+C (interrupt, then clear, then exit).
- Nothing draws until it is used: the plan is a live checklist that folds to `✓ Plan 4/4`, skills and recalled memories show as one quiet line, hooks show only when they fail or block, and each turn that changed files or ran a check ends with one summary line. `/plan`, `/diff`, `/checks` and `/context` (or `alt+2…5`) open the detail on demand.
- Markdown rendering with hierarchy: headings, hanging-indent lists, quotes, rules, compact tables and highlighted code blocks.

### Changed
- Flat palette from the Shelra web identity (`#080808` background, `#00FF88` accent); gradients, glows and fades are removed from the terminal UI and the bench dashboard.
- With no explicit model, the Free policy picks the most capable free model; the router stays as the last fallback.
- The agent prompt describes the Markdown the terminal renders, so answers are structured instead of flat.
- The tool set lives in `src/toolset/`; project state lives under `.shelra/`; updates and the installer use this repository's releases.

### Removed
- Legacy configuration fallbacks and the unused media-generation tools.
