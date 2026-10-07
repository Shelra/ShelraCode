# 22 — Provider-neutral routing, OmniRoute, and the Free-mode invariant

Status: implemented 2026-10-06 (current). Code: `src/routing/`, `src/providers/` (registry, definitions, routing
provider, guard), `src/startup/routed-session.ts`, `src/cli/providers-command.ts`, `src/ui/model-picker*.ts(x)`.
Supersedes the OpenRouter-centred routing described in `OPENROUTER-RUNTIME.md` (still accurate for the OpenRouter adapter
itself) and §26 of doc 14 for the Free-mode fallback chain.

## 1. The invariant

> **Free mode never runs a paid model and never silently incurs paid inference.** It may degrade to "no free model is
> available right now"; it may never degrade to paid.

The guarantee lives in deterministic host code, not in a prompt, a provider name, a naming convention or an upstream
router's label. **Unknown cost is not free.** A route is eligible only when Shelra can show why.

## 2. What was there before

- OpenRouter was the architecture: `configureRemoteProvider` fetched OpenRouter's catalog, `routeCatalogModel` ranked
  only OpenRouter entries, `fallbackModelIds` knew only OpenRouter's routers, ids were bare OpenRouter ids.
- Groq, Gemini and Cloudflare were a three-element list (`FREE_PROVIDER_IDS`): reachable with `--provider` for one
  headless run, or as a Mixed-mode fallback chain. A session in Free mode never left OpenRouter (owner, 2026-09-24:
  another provider's key may be on a paid plan).
- The Free guard lived inside the OpenRouter adapter (`paidModelRefusal`). Another adapter had none.
- No namespaced model ids, no unified catalog, no health memory, no served-provider observability.

## 3. The architecture

```
ProviderRegistry (src/providers/registry.ts, default-registry.ts)
  ProviderDefinition: id, name, resolveConfigs, discoverModels, createAdapter, freePlan, canBill, selfEnforcing
    openrouter | groq | gemini | cloudflare (definitions/free-plan.ts) | omniroute      ← add provider #N here only
        │
CatalogService (src/routing/catalog-service.ts)         one catalog, async, cached, bounded, event-driven
        │  entries (CatalogEntry, id = provider/providerModelId)
classifyFreeEligibility (src/routing/eligibility.ts)    pure: guaranteed-free | free-tier | unknown | paid
planFreeRoutes (src/routing/free-router.ts)             pure: eligible routes ranked, with evidence
HealthTracker (src/routing/health.ts)                   cooldowns, provider breaker, last success, latency
        │
RoutingProvider (src/providers/routing-provider.ts)     the ONE adapter every cloud session runs on
        │  dispatch by canonical id · Free check before every call · failover · health · served-route checks
Agent.setProvider → guardForFreePolicy (free-guard.ts)  last line, for any adapter that bypassed routing
```

### Canonical model identity (`src/routing/model-ref.ts`)

`provider/providerModelId`: `groq/openai/gpt-oss-120b`, `omniroute/auto/coding`, `openrouter/anthropic/claude-sonnet-4`.
Only a registered provider id is a namespace, so `google/gemini-2.5-flash` stays an OpenRouter vendor id. `shelra/free` is
the virtual "Auto Free" model. **Compatibility:** a bare id (`google/gemma-3:free`) and `openrouter/…` read exactly as
before (to OpenRouter); settings (`defaultModel`, `modeModels`), saved sessions and `-m` keep working, canonicalized at
use. Nothing is rewritten on disk.

### Free eligibility (`src/routing/eligibility.ts`)

| Level | Meaning | Free mode runs it |
| --- | --- | --- |
| `guaranteed-free` | The provider's own pricing says zero and Shelra trusts that contract (OpenRouter `:free`, `openrouter/free`), or it runs locally | yes |
| `free-tier` | A free plan, not a price: it stops at a quota, and a billed key is charged past it (Groq, Gemini, Cloudflare) | only if the user declared the key has no billing |
| `unknown` | No authoritative price (a gateway's catalog, a missing field) | only if the user vouched for the model by name |
| `paid` | A price above zero, or a router that bills whichever model it picks (`openrouter/auto`, any OmniRoute alias or combo) | never, and never vouchable |

The user's declarations are `shelra providers allow-free <provider>` (plan) and
`shelra providers allow-free <provider> '<prefix>*'` (models), stored in `user-settings.json` (`freeAccess`). They are
not secret. A bare `*` is refused. `--provider groq` for one run counts as declaring that provider for that run (owner
decision O7 of the multi-provider mission: an explicitly chosen provider is admitted, never reached automatically).

Why the declaration exists: Shelra cannot read an account's billing state, and this directly answers the 2026-09-24 rule
that another provider's key can be on a paid plan. Auto-routing across providers is therefore on for what Shelra can
prove (OpenRouter's prices) and for what the user attested, and off for the rest. Changing that default is the owner's
call.

### Free routing (`planFreeRoutes`, `RoutingProvider`)

1. Discover: every configured provider's catalog, concurrently (3 at a time), each within 5 s, last good answer kept.
2. Filter: eligibility, capability (tools, vision, reasoning, structured output, context from the request itself), health.
3. Rank: capability score (reasoning, size class, context), metadata confidence, answered in the last 30 min (+),
   failures since (−), latency, quota headroom when a provider reports it, local (−12: not preferred merely because it
   exists), through a gateway (−2). `openrouter/free` is the last resort. No fake precision: unknown stays unknown.
4. Execute the best; **failover in the same call** (up to 4 routes) when a route fails before anything reached the turn;
   after output the turn's own retry ladder takes over, and the next request re-plans (the failed route is cooling).
5. The user sees it: `[openrouter/… is rate limited; switching to groq/… (free)]`, and the footer names the provider that
   answered (`Qwen3 Coder · Groq`).

Health: rate limit 1 min, quota 30 min (or the provider's reset time), server fault 30 s, model missing 10 min, refused
key 30 min; doubled per failure in a row up to a cap. A refused key or a spent quota cools the whole provider; three
different models of one provider failing trips its breaker. A gateway route whose upstream is cooling is skipped too.

### The enforcement layers

1. **Plan**: only eligible routes are ever candidates.
2. **Call**: every `stream`, `generateText` and `generateStructured` of the routing provider re-checks the model it is
   asked for against the same classifier, before any provider is contacted. Titles, recaps, the side question,
   reflection, compaction and sub-agents all go through the agent's one provider, so they are covered. Auxiliary calls
   run on `shelra/free` in both modes.
3. **Install**: `Agent.setProvider` (and the constructor and `setApiKey`) wrap any adapter that does not enforce Free mode
   itself (`guardForFreePolicy`). `src/providers/architecture.test.ts` lists every place that builds a provider or calls a
   model; a new one fails CI until it is reviewed against Free mode.
4. **Never left with no free model for a passing fault**: when the plan is empty because every free route is cooling
   down, `RoutingProvider` plans again with `probeCooling`: routes whose cooldown came from a passing fault
   (`HealthTracker.isTransient`: unavailable or other) are tried now, soonest back first, at most four, and a `probe`
   event is emitted. A spent quota, a rate limit or a refused key is never probed, and eligibility is not relaxed. The
   guarantee rests on free cloud routes only; no local model is part of Free mode's chain (owner, 2026-10-07).
5. **After the answer**: a Free request that reports a cost above zero, or was served by a different provider than the
   gateway entry names, or by a model the catalog knows is not free, takes that provider out of Free mode for the
   session (a `violation` event and a routing note). This is detection after the fact; it exists because of §4.

## 4. OmniRoute

Verified against OmniRoute's documentation, 2026-10-06 (github.com/diegosouzapw/OmniRoute, API reference): an
OpenAI-compatible gateway, default `http://localhost:20128/v1`; `GET /v1/models` (`?prefix=canonical` lists each model
once as `provider/model`), `POST /v1/chat/completions`, Bearer keys (a keyless install accepts none), response headers
`X-OmniRoute-Provider`, `X-OmniRoute-Model`, `X-OmniRoute-Response-Cost`.

**Not trusted:** its `auto/…:free` aliases and category filters fail open when no candidate matches (its documentation
says so), and subscription providers read as `$0`. A model entry's price or free flag is not documented, and a zero from a
gateway is not a guarantee. Therefore:

- Aliases (`auto`, `auto/…`, combos) are `router` entries: never eligible, never vouchable (`paid` level).
- A concrete `provider/model` is `unknown` until the user vouches for it by name or prefix.
- Every answer's headers are read; a charge or a different provider than the model names ends its Free eligibility for
  the session.
- Mixed mode treats aliases like any model: selectable, with `omniroute/auto` as the Mixed default when OpenRouter is not
  configured.

Integration: a thin definition (`definitions/omniroute.ts`) over the generic OpenAI-compatible transport; provider-specific
code is only the catalog client and the served-route reader (`providers/omniroute.ts`). It is configured with
`OMNIROUTE_BASE_URL` or `shelra auth omniroute --url <url> [key]` (the address in settings, the key in the credential store;
`OMNIROUTE_API_KEY` also works). **Nothing is probed, installed or started.** An offline gateway costs one 3 s bounded
discovery, is marked unavailable, backs off (15 s doubling to 5 min) and re-enters the pool on its own.

Observability: per step the adapter reports the provider and model that actually answered (`servedProviderId`,
`servedModelId` = `omniroute/<provider>/<model>`) and the cost it charged (`costUsdTicks`). Unknown cost stays unknown.
Not available: OmniRoute's candidates/quota endpoint was not used (its schema is undocumented), so quota headroom is not
read from it; the upstream of a concrete id is inferred from its first segment, which an alias named like a provider could
fool, which is what the header check is for.

## 5. Mixed mode

Mixed means free + paid: `-m provider/model`, or the picker (`/models`), grouped by provider, searchable by provider,
model and capability (`groq vision`, `free`, `paid`), showing price status, context and capabilities. The request goes to
the provider the id names. Without a pick, Mixed starts on the first configured provider's router
(`openrouter/auto`, else `omniroute/auto`), and a model that cannot be served continues on Auto Free (free routes) as the
session's provider fallback. The picker draws only the rows that fit (windowing), so thousands of models cost the same as
ten. In Free mode the picker is Auto Free alone, with where its routes come from.

## 6. Credentials, settings, migration

- Keys: `~/.shelra/auth.json` (`openrouter.apiKey`, `providers.<id>`), unchanged format. Never in settings, logs or traces.
- New settings: `omniroute.baseUrl`, `freeAccess.{freePlanProviders,freeModels}`. Old settings are read as before.
- `--provider <id>` still works for any provider and now means `-m <id>/<model>` plus the per-run declaration.
- `shelra auth omniroute`, `shelra auth remove <any provider>`, `shelra providers [--refresh] [--json]`,
  `shelra providers allow-free|deny-free`, `shelra models` (every provider), `shelra models use provider/model`.
- Custom endpoints (`SHELRA_BASE_URL`) keep the old single-endpoint path.
- Local models keep their own path (`--local`; an installed local model remains the fallback for a rejected key). Free
  auto-routing does not start a local runtime on its own: starting a model server is a heavy side effect, and a weak
  local model is not preferred merely because it exists. `planFreeRoutes` ranks local entries below remote ones when a host
  supplies them.

## 7. Cost and performance

- Network: one catalog pass per provider per 15 min TTL (plus backoff on failure), none per turn; one timer, unref'd,
  that does nothing inside the TTL. Disk cache per provider (`~/.shelra/cache/catalog-<id>.json`) so a start has a
  catalog at once. OpenRouter keeps its own 6 h cache underneath.
- The terminal UI: `resolveModelRuntime` for Auto Free is memoized per catalog version and 5 s; provider configuration is
  re-read at most every 30 s; the picker windows its rows; catalog updates are one event per pass.
- State is bounded: 512 health records, 4 adapters per provider, 20 routing notes, 5,000 models per provider.

## 8. Verification

`src/routing/*.test.ts` (eligibility, 3,000-seed property test plus an independent oracle, health, router, catalog
service, a 600-turn soak), `src/providers/routing-provider.test.ts` (failover, outage and recovery, pinning a paid model,
Mixed dispatch, violations), `src/providers/omniroute.test.ts` (a fake OmniRoute HTTP server: discovery, streaming, tool
calls, reasoning, served headers, auth, keyless, 401/429/500, hang, refused connection, malformed payload, the fail-open
case end to end), `src/agent/free-mode-routing.test.ts` (every kind of call a real `Agent` makes),
`src/providers/architecture.test.ts`, `src/cli/providers-cli.test.ts` (the real CLI), `src/ui/model-picker*.test.ts(x)`.
CI runs these (`.github/workflows/typecheck.yml`).

## 9. Remaining risks

- Detection after the fact (§3.4) cannot undo one charged request. Prevention for a gateway rests on the user vouching only
  for models they know are free.
- A declaration is a statement by the user; if a key is later put on a billed plan the declaration is stale.
- Discovered (non-curated) Groq/Gemini models are assumed to take tools; one that does not fails once, then cools.
- The live OmniRoute and live free providers were not exercised by the automated suite (see the final report).
