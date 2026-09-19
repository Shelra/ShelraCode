# OpenRouter model runtime

Status: implemented in the CLI and provider execution path.

## Runtime flow

```text
CLI (cloud default; `--local` is explicit secondary mode)
  -> credential resolution (~/.shelra/auth.json or OPENROUTER_API_KEY)
  -> GET /api/v1/models (six-hour disk cache)
  -> normalize to CatalogEntry
  -> capability/cost policy route
  -> OpenRouterProviderAdapter
  -> generic OpenAI-compatible transport
  -> Agent stream/generate loop
  -> Shelra tools, permissions, persistence and verification
```

The default interactive and headless paths are cloud-first. `--local` bypasses
cloud routing and activates the managed local runtime; `--remote` remains an
explicit compatibility alias for selecting cloud mode. Startup does not ask a
workspace-trust question and does not initialize a local model on the cloud
path.

`Agent` only consumes `ProviderAdapter`. OpenRouter-specific model-id
translation, headers, server fallbacks and provider routing live in
`src/providers/openrouter.ts`. The generic transport remains usable for local
OpenAI-compatible servers and other direct endpoints.

## Catalog and selection

`src/models/openrouter.ts` reads the official OpenRouter model catalog and
normalizes context length, maximum output, modalities, supported parameters,
moderation, expiration and token pricing. The cache is
`~/.shelra/catalog/openrouter.json`; a stale cache is used when the network is
unavailable. Missing prices are marked unknown and are never treated as free.

`src/models/routing.ts` filters before ranking. A route can require tools,
vision, reasoning, structured output and a minimum context window. The default
policy is `free`; `auto`, `economy`, `balanced`, `quality`, `max` and explicit
model selection use the same provider abstraction. `openrouter/free` is kept as
a distinct router strategy because the underlying model is selected by
OpenRouter at request time.

With no explicit or saved model, the `free` policy does not use the router as
its primary: every free model costs the same, so cost cannot rank them and the
router may answer with a very small model. Candidates are ranked by
`capabilityScore` (reasoning support, parameter-size class parsed from the model
id, a size-tier keyword, then context). That is a documented heuristic over what
the catalog exposes, not a benchmark. The route's fallback list is the best
model, the second best, then `openrouter/free`, so a busy or rate-limited top
model degrades to "some free model" instead of failing the turn. A saved model
that is still free (including a deliberately saved router) and any explicit
`--model` win over this ranking; a saved paid model is ignored under `free`.

The current CLI surfaces are:

- `shelra models [--refresh] [--json]`
- `shelra models use <openrouter-model>`
- `shelra auth openrouter <key>`
- `shelra --remote --model-policy free|auto|economy ...`
- `shelra --autonomous --prompt "..."`
- `shelra objectives [latest|<id>] [--json]`

The agent also performs a mandatory bounded web-research pass for each task.
`src/research/web.ts` uses the Google Custom Search JSON API when configured,
falls back to Google HTML and then DuckDuckGo HTML, and exposes `open_web` for
bounded reading of a selected public documentation page. The runtime still
prioritizes repository evidence and treats search output as untrusted leads.

The TUI picker shows pricing, context and capabilities for discovered cloud
models. Headless JSON emits a `model_selected` event before stream events.

## Executable specification and plan

The autonomous path does not treat a model's final prose as completion. Its
provider-independent flow is:

```text
user objective
  -> bounded external research + repository snapshot
  -> executable specification (requirements + typed acceptance checks)
  -> ordered task plan (task -> criterion mapping)
  -> host file/process actions
  -> deterministic/browser verification
  -> evidence-driven repair
  -> verified completion or an explicit stop reason
```

`AutonomyKernel` owns this state and `ExecutionJournal` persists it to
`.shelra/objectives/<id>/objective.json` plus an append-only `events.jsonl`.
The CLI emits full `specification`, `plan`, and `task` events as soon as they
exist. Human output shows their contents; JSON output preserves typed fields.
`shelra objectives latest` reconstructs the goal, requirements, checks, task
statuses, final verification, and evidence directory from disk.

The interactive conversational TUI still uses its existing model-authored Plan
object, but it now requires the same user-visible fields: goal, requirements,
acceptance criteria, verification methods, ordered steps, and step-to-criterion
mapping. Normal Agent-mode `write_file` and `edit_file` calls are blocked until
that plan has been published. Plans without questions are retained for the
Plan-to-Agent handoff, and single-answer plan questions submit the newly chosen
answer rather than stale React state.

This TUI plan is not yet the authoritative autonomous objective ledger. Joining
the two state models without creating a third task system remains the next
UI/runtime migration. Likewise, `--sandbox` is rejected for autonomous runs
until the execution broker is genuinely wired; Shelra does not advertise a
false sandbox boundary.

## Cost and safety

Provider-reported token/cost usage is stored in SQLite `usage_events`. Before a
request, Shelra estimates the maximum cost from catalog prices and the output
cap. It blocks when the request, session or UTC-day budget would be exceeded.

```text
--max-request-cost <usd>  one conservative provider request
--max-cost <usd>          cumulative persisted session
SHELRA_MAX_REQUEST_COST_USD
SHELRA_MAX_SESSION_COST_USD
```

`0` is a strict zero-cost limit. If cloud pricing is unknown while a budget is
active, the request is blocked pending a catalog refresh. No API key is written
to user preferences or emitted in catalog/JSON output.

OpenRouter server-side fallbacks are populated only from the route's eligible
candidate set, so a Free route cannot silently include paid candidates. Provider
retries handle transport failures; semantic failures (bad tool calls,
incorrect code or failed verification) remain Agent/verification concerns.

## Verification and limitations

The existing Agent stream reaches the real Shelra tool runtime, and the host
verification path remains the owner of completion. A live free-router smoke
test completed a streaming `OK` response with token usage and no paid model.
A disposable-workspace coding smoke test also created a three-file digital
clock, inspected the files, recovered from a malformed shell command, and
completed local verification without paid escalation.

Remaining priorities are unifying the interactive TUI with the autonomous
objective ledger, semantic retry/escalation based on verification evidence, and
exposing provider-order/data-policy settings in onboarding. The current
implementation does not claim that a weak free model can complete every coding
task reliably. Google Custom Search credentials are optional; the HTML
fallbacks are best-effort and can change independently of Shelra.

Reference data is taken from OpenRouter's public API contract; the Claude Code
checkout under `references/` was used only for architectural/product study and
was not copied into Shelra.
