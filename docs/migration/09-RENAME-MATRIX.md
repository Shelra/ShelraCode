# Branding and settings rename matrix

This matrix started as the Phase 0 planning artifact and now records the
Phase 8 implementation. Shelra source (`src/product/identity.ts`, package
metadata and settings tests) is the naming authority. New package, CLI, UI
labels, settings, storage, schedule, delegation, and installer writes use the
Shelra conventions below; legacy paths remain explicit read/mirror bridges
until the breaking cleanup in Phase 9.

| Current target identifier | Evidence | Proposed Shelra convention | Phase | Compatibility |
|---|---|---|---|---|
| package `grok-dev` | target `package.json` | authoritative Shelra package name from source (`shelra` today; confirm release name) | 8 | publish metadata migration; no silent package replacement before release plan |
| binary `grok` | target `package.json`, `src/index.ts` | `shelra` | 8 | optional legacy launcher during migration window |
| CLI name/description “Grok CLI” | `src/index.ts:348+` | ShelraCode / Shelra wording | 8 | help snapshot update |
| `GROK_API_KEY` | `src/index.ts:302-338`, settings | no mandatory remote key; provider-specific `SHELRA_*` only where justified | 6/8 | read old key only for legacy xAI adapter, then remove in 9 |
| `GROK_BASE_URL`, `GROK_MODEL` | `src/utils/settings.ts`, bootstrap | normalized runtime/provider settings; `SHELRA_*` names as confirmed | 6/8 | validate old keys read-only |
| `~/.grok/grok.db` | `src/storage/db.ts` | Shelra state path, target writes `~/.shelra/shelra.db` | 8 | one-way migration/backup; old path never written |
| `~/.grok/user-settings.json` | `src/index.ts:332`, settings | Shelra global settings path | 8 | migration reader and marker |
| `.grok/settings.json` | `src/utils/settings.ts` | Shelra repository settings path | 8 | read/migrate; preserve permissions |
| `.grok/environment.json` | `src/verify/entrypoint.ts` | Shelra verification environment manifest | 8/9 | current verifier remains on this mature path; canonical migration is a tracked Phase 9 item |
| `.grok/verify-artifacts` | target verify modules | Shelra verification artifact path | 8 | migrate only metadata/artifacts required by resume |
| `.grok/generated-media` | `src/grok/media.ts` | capability-owned media directory or remove with feature | 6/8 | preserve existing files; no fake generator |
| `~/.grok/delegations` | `src/agent/delegations.ts` | Shelra task/delegation storage | 7/8 | migrate records through schema, not string replacement |
| `~/.grok/schedules` | `src/tools/schedule.ts` | Shelra schedule storage if feature retained | 7/8 | defer until daemon/privacy decision |
| `~/.grok/cache/lsp` | `src/lsp/npm-cache.ts` | Shelra cache convention | 8 | old cache read-only or rebuilt |
| `GROK_DAEMON_CHILD` | schedule daemon | Shelra daemon marker or remove with feature | 7/8 | compatibility only during migration |
| `GROK_BACKGROUND_CHILD` | delegation child process | Shelra task child marker | 7/8 | retain process detection during transition |
| `GROK_HOOK_EVENT` | `src/hooks/config.ts` | Shelra hook event namespace | 7/8 | parse old event for existing hooks |
| temp `grok-bg` | `src/tools/bash.ts` | Shelra temp prefix | 8 | clean up only owned temp processes |
| `src/grok/*` module path | client/models/tools/media/batch | provider/runtime/capability modules | 1/6/9 | adapter path remains until xAI deletion |
| Grok model IDs/prices | `src/grok/models.ts` | normalized runtime model candidates | 2/5/6 | preserve selected session ID for resume; no new Grok defaults |
| `xAI` / `xai-` wording | UI/API-key modal and errors | local runtime/provider wording | 6/8 | show explicit unsupported/legacy state when needed |
| `superagent-ai/grok-cli` release repo | install manager | ShelraCode release authority | 8 | update channel migration must be explicit |
| `grok-*` release assets | install manager | `shelra-*` artifacts | 8 | retain old asset lookup only during upgrade window |
| `# grok` path marker | install manager | Shelra marker | 8 | avoid rewriting unrelated user files |
| “Message Grok…” composer | `src/ui/app.tsx:3929` | Shelra-neutral prompt wording | 8 | UI snapshot update with width review |
| Grok ASCII hero/logo | `src/ui/app.tsx:195-248` | ShelraCode identity asset | 8 | preserve layout dimensions |

## Rename rules

Use typed identity constants and explicit migration functions. Do not run a global search-and-replace: identifiers can be public API, persisted keys, paths, release assets or historical attribution. New state must be written only with Shelra conventions. Old configuration is read, validated, migrated and marked; it is never silently deleted. Preserve target MIT and Shelra Apache-2.0 licensing/attribution during file moves.
