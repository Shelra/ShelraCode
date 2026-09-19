# 07 — Risks and open questions

Each risk is tied to evidence: a `path:line` in this repo, a cited URL, or a
line in `01`/`02`/`03`.

---

## 1. Local-first identity drift — **highest product risk**

**Evidence.** The codebase makes the stance explicit in code comments, not just
in marketing:

* `src/index.ts:108-109` — *"Local-first is also a privacy boundary: do not even
  initialize a remote adapter in the normal startup path when credentials happen
  to exist."*
* `src/runtimes/discovery.ts:79-81` — *"Shelra never installs or starts a
  third-party runtime and never probes vendor apps by default."*
* `src/models/huggingface.ts:9` — *"Stable Shelra identity. The value is never
  sent to a third-party runtime."*
* Audit `18-RECOMMENDED-TARGET-ARCHITECTURE.md` §7 — *"Do not add
  remote-provider fallbacks into the local path."*

**The risk.** Free cloud models are *dramatically* better than a 1.5B local
GGUF and cost nothing. Every incremental convenience — a cloud default, an
automatic fallback, a cloud model at the top of the picker — moves the product
toward being "a CLI that talks to OpenRouter, which can also run locally".

**Compounding factor from `02 §4`:** free OpenRouter models are served **only**
to accounts that have opted into providers training on their inputs. So the
convenient path is not merely "the network"; it is "your code, used for
training". For this product that is not a footnote.

**Mitigations, all already in the design.**
* Cloud is never auto-selected (`04 §9.2`); `selectLocalRoute` is untouched.
* The `index.ts:108-115` privacy boundary is preserved.
* A persistent `☁` status marker, not just a one-time notice (`05 §5`).
* The training disclosure appears in the missing-key error, the `models use`
  success message, and the first-turn notice (`05 §4`).
* Local stays bound to Enter in onboarding (`06` Phase 9).

**Residual risk: real.** This is a values decision, not a technical one, and it
needs the user's explicit sign-off (see §12, Q1).

---

## 2. OpenRouter free-tier instability

**Evidence (`02 §4`, `§2.4`).** 20 requests/minute; **50 requests/day** without
purchased credits; 1000/day after ≥10 credits historically. `expiration_date`
exists on model entries. On 2026-09-06 there were 18 `:free` models; there is no
guarantee any specific id survives a week.

**Concrete failure modes.**

| Failure | Symptom | Design response |
| --- | --- | --- |
| 50 RPD exhausted mid-task | 429 partway through a multi-tool turn | Exact message in `05 §4`; local request counter in the status line (`05 §5`) |
| 20 RPM burst limit | 429 on a fast tool loop | `maxRetries: 2` (`06` Phase 5) + backoff |
| Model withdrawn | 404 on a cached id | `models use` error + auto-refresh suggestion (`05 §4`) |
| Provider rate limit **after** streaming starts | HTTP 200, then SSE `finish_reason: "error"` | **Not covered by retries** — see §6 |
| Negative balance | 402, *even on free models* | Exact message in `05 §4` |
| Data policy not enabled | `404 No endpoints found matching your data policy` | Surfaced in every missing-key path |

**A coding agent's request amplification is the real problem.** One user turn
with five tool calls is six requests. At 50/day that is **roughly 5–15 real
turns per day**. The UI must set that expectation before the user hits it, which
is why the rate-limit line is unconditional in `05 §1.1`.

---

## 3. Key storage and leakage

**Evidence.**
* `src/utils/settings.ts:224` writes `user-settings.json` with mode `0o600`; the
  directory is `0o700` (`:209`). Good.
* But that same file already holds `apiKey` (`:177`) and
  `telegram.botToken` (`:87`) — it is a file users paste into issues.
* `src/runtimes/managed-llama.ts:29-43` is a **denylist** for the child process
  environment: `SECRET_ENV_PATTERN = /(?:^|_)API_?KEY|APIKEY|SECRET|(?:^|_)TOKEN(?:$|_)|PASSWORD|…/iu`
  plus an explicit `BLOCKED_ENV_NAMES` set.

**Assessment.** `OPENROUTER_API_KEY` matches `API_?KEY` in that regex, so it is
**already stripped** from the llama-server child. But relying on a regex for a
new credential is exactly the kind of implicit dependency that breaks silently.

**Mitigations.** Store keys in a sibling `~/.shelra/auth.json` at `0o600`
(`04 §6.1`); add `OPENROUTER_API_KEY` to the explicit `BLOCKED_ENV_NAMES` list;
add a test asserting the key never reaches the child (`06` Phase 4); never emit
key material in `--json`, `auth list`, `auth --show`, logs or errors.

**Residual.** A key in `OPENROUTER_API_KEY` is visible to any other process
inheriting the environment. That is the user's choice; document it.

---

## 4. Offline and stale-cache behaviour

**Evidence.** OpenCode's ordering is disk → bundled snapshot → network
(`01 §2.2`, `models-dev.ts:217-231`), with `OPENCODE_DISABLE_MODELS_FETCH` for a
hard offline mode.

**Our deliberate difference (`04 §8`):** fresh cache → network → **stale** cache
→ bundled. Rationale: a stale free-model list produces 404s that a fresh one
would not. Cost: a slower path when the cache is stale and the network is slow —
bounded by the 10 s timeout.

**Risks.**
* A user on a plane with a 7-hour-old cache waits 10 s before seeing a list.
  *Mitigation:* `SHELRA_OFFLINE=1` skips it entirely; consider also skipping the
  fetch when a local model is already active and the user only ran
  `shelra models`.
* The bundled fallback list (`04 §8`) **will rot**. Every id in it can expire.
  *Mitigation:* mark those entries `contextConfidence: "fallback"` and label
  them in the UI ("Some may no longer exist" — `05 §4`).
* A cold, offline first run shows a fallback list the user cannot actually use
  (no key, no network). Acceptable: it is informational.

---

## 5. models.dev vs native OpenRouter — a reversible bet

**Evidence (`02` + `01 §2.1`, measured 2026-09-06).**

| | OpenRouter `/models` | models.dev `api.json` |
| --- | --- | --- |
| Bytes | 708 673 | 4 495 092 |
| OpenRouter models | 430 | 360 |
| Free set | 21 | 21 (**identical**) |
| `max_completion_tokens` | yes | no (only `limit.output`) |
| `is_moderated`, `expiration_date` | yes | no |
| Providers covered | 1 | 213 |

**Decision (`04 §4.2`):** models.dev-*style* schema, OpenRouter-native *data*.

**Risk if wrong:** adding a second cloud provider (Groq, Together, direct
Anthropic) means writing a second bespoke client instead of getting it free from
models.dev. **Mitigation:** the `CatalogProvider` interface exists precisely so
a `ModelsDevSource` can be added later without touching a single consumer. The
bet is cheap to reverse.

**Counter-risk:** OpenRouter could change `/api/v1/models`. It is a public,
widely consumed endpoint; low probability. The fixture-based normaliser tests
(`06` Phase 2) will catch a shape change on the next `--refresh`.

---

## 6. `maxRetries: 0` on a real internet path — and what retries don't fix

**Evidence.** `src/runtimes/local-provider.ts:88` hardcodes `maxRetries: 0` in
`stream`. `createOpenAICompatibleProvider` (`:133-152`) reuses
`LocalProviderAdapter`, so **today's `--remote` path already runs with zero
retries against a real internet endpoint**. Meanwhile `generateText`
(`:111-118`) sets no `maxRetries` at all and inherits the SDK default — the two
methods disagree.

**Risk.** A single 429 (near-certain at 20 RPM — `02 §4`) kills a turn that may
have already done ten minutes of work.

**Fix (`06` Phase 5).** Parameterise: `0` for local, `2` for cloud, applied
consistently to both methods.

**What retries do NOT fix — call this out explicitly.** `02 §4`: when an
upstream provider's limit trips *after streaming has begun*, the failure arrives
**as an SSE event with `finish_reason: "error"` over an HTTP 200**. The AI SDK's
retry logic does not see an error there. Unless
`normalizeProviderEvents` (`src/providers/stream.ts`) maps that finish reason to
a `{type: "error"}` `ProviderEvent` (`providers/types.ts:36-43`), the turn ends
silently and looks like a short answer.

**This is a genuine gap in the current design.** It is not in any phase.
Recommendation: add it to Phase 5's scope, or file it as a follow-up. Needs
sign-off (§12, Q8).

---

## 7. Conversation history vs a smaller context on switch

**Evidence.** Audit `14` §4, re-verified in `03 §7`: `agent.setProvider`
(`agent.ts:714-719`) swaps one field; `getContextStats` takes `contextWindow` as
a parameter (`:753`) so nothing stale is cached — **but `this.messages` is never
re-validated against the new window.**

**Concrete case enabled by this project:** the free roster spans 65 536 →
1 048 576 tokens (`02 §2.4`), and local models are 32 768 (or **16 384** served
on CUDA — `03 §3.4`). Switching from `minimax/minimax-m3:free` (1 048 576) to a
local model is a **64×** contraction. A 400 K-token history then meets a 16 K
window.

**Design response (`05 §2.3`):** re-run `getContextStats` on every switch, warn
above ~85 % with the exact text in `05 §4`, offer `/compact`, never silently
truncate.

**Boundary:** the actual re-fit — whether compaction can even succeed at 16 K
given ~9 K of tool schemas (`managed-llama.ts:22-23`) — is the queued
context-budget work. Audit `14` §6 ("What does not adapt — and the arithmetic
that breaks") already documents that it currently cannot. **This project must
not pretend to fix it.** It supplies the correct numbers and the trigger.

**Secondary, pre-existing:** `agent.batchApi` is only ever turned *off*
(`agent.ts:717`), never restored, so switching to a batch-capable provider will
not re-enable batching.

---

## 8. Testing a network-backed catalog

**Evidence.** The suite has no network-dependent tests today, and both
`discovery.ts` (`:76`) and `managed-llama.ts` (`:102`) already accept an
injected `fetchImpl` — the pattern to follow.

**Strategy.**
* **Fixtures, not the network.** Check in a trimmed real response from
  2026-09-06 covering every shape variant: free+tools, free without tools, paid,
  `openrouter/free` with `top_provider: null`, sparse `pricing` (only
  `prompt`/`completion`), an expired entry, an audio-output entry.
* **Inject `fetch` everywhere.** Zero real network calls in the suite.
* **Cache tests use a temp HOME** — never touch a developer's `~/.shelra`.
  (`settings.ts` already reads `USER_DIR` at module load (`:202`), so
  catalog/cache modules must resolve their directory **lazily**, or they will be
  untestable. Design note for Phase 2.)
* **Contract tests are separate.** One opt-in test hitting the real endpoint,
  gated behind `SHELRA_E2E=1`, asserting only the *schema* (keys present, types
  right) — never specific model ids, which change weekly.
* **Snapshot only pure renderers** (`renderCatalog`), never live data.

**Risk.** The fixture drifts from reality and the tests pass while production
breaks. *Mitigation:* the gated contract test, plus a dated comment on the
fixture.

---

## 9. The load-bearing `catalog.ts` consumers

**Evidence (`03 §1.1`) — six production consumers, not four:**
`agent.ts:36`, `toolset/client.ts:5`, `index.ts:17`, `storage/usage.ts:1`,
`ui/app.tsx:11-15`, `utils/settings.ts:11`.

**Risks per consumer once `getModelInfo` starts returning real data:**

| Consumer | Newly live code path | Risk |
| --- | --- | --- |
| `agent.ts:566` `applyModelConstraints` | Currently dead (`getModelInfo` → `undefined` → `undefined !== false` → `true`). Once real, a model with `supportsClientTools: false` **starts injecting a "MODEL CONSTRAINTS: do not call bash/read_file/…" block** into the system prompt (audit `07` §1). | **Real behaviour change.** Ensure `capabilities.tools` is never wrongly `false`. Local candidates declare `tools: true` (`managed-llama.ts:85`); cloud reads `supported_parameters`. |
| `agent.ts:655-657` `getModelInfo()` | Falls back to the catalog when no provider is set | Now returns data before a provider exists — the context gauge appears earlier. Benign, arguably a fix. |
| `toolset/client.ts:60-62` | `modelInfo` and reasoning effort become non-undefined | Verify no branch assumes `undefined`. |
| `storage/usage.ts:95` | Cost accounting gets real prices | **Free models are `0`** — make sure `0` renders as "free", not as "unknown". |
| `ui/app.tsx:806` | Context gauge appears where it did not | Benign. |
| `utils/settings.ts:369-372` | `DEFAULT_MODEL` | **Do not change it from `""`** (`04 §10.1`). |
| `settings.ts:626-633` `getReasoningEffortForModel` | Only once Phase 8 implements the reasoning exports | Deferred deliberately. |

**Mitigation.** Phase 1 changes the *backing*, not the *signatures*, and ships
with no behaviour change because nothing primes the catalog yet. The behaviour
change lands with Phase 3.

---

## 10. Duplicated model-id state

**Evidence (audit `14` §4, re-verified).** The active model id lives in **four**
places kept in sync by hand: `agent.modelId` (`agent.ts:596`), SQLite
`session.model`, React `model` state (`app.tsx:606`), and `defaultModel` in
`~/.shelra/user-settings.json`.

Adding `shelra models use` creates a **fifth** writer, and the TUI picker
already writes *two* files at once (`app.tsx:830-831`:
`saveProjectSettings({model})` **and** `saveUserSettings({defaultModel})`).

**Risk.** `shelra models use X` at the CLI, then opening the TUI in a directory
with a project `settings.json` pinning `Y`, yields `Y` — because project
settings outrank `defaultModel` (`settings.ts:349-365`). Confusing, and
pre-existing.

**Mitigation.** `models use` writes only `defaultModel` (`05 §1.4`), and its
success message should name the scope. Whether the TUI picker's double-write is
correct is an open question (§12, Q6).

---

## 11. Smaller risks

| Risk | Evidence | Response |
| --- | --- | --- |
| `shelra models` currently spends up to 60 s and can start a llama-server | `index.ts:936` | `04 §4.1` — listing is filesystem-only |
| `recommendBootstrapModel` indexes `HUGGING_FACE_MODELS[0]`/`[1]` positionally | `recommendation.ts:35,41,46-68` | Do not reorder the array; consolidating with `localModelFitScore` is audit `18` §2's job, not this project's |
| `discovery.ts:53` hardcodes 32 768 for any explicit-endpoint model | `discovery.ts:53` | Phase 8 |
| Attribution headers are egress a privacy-first user may not expect | `04 §9` | Static strings, no user data; documented; consider a suppression setting |
| `openrouter/free` router has `top_provider: null` and picks models at random | `02 §2.2` | List it, label it, never auto-select it |
| `cohere/north-mini-code:free` is `is_moderated: true` | `02 §2.4` | Show "moderated" in the picker |
| Reasoning is default-enabled on some free models | `02 §1.3` (`reasoning.default_enabled: true`) | Inflates latency and output tokens; consider disabling explicitly |
| `resolveConfig` persists `--api-key` and `--model` as a side effect | `index.ts:765-766` | Surprising for a per-provider key; see Q5 |
| `sst/opencode` now redirects to `anomalyco/opencode` | `01` header | Any future reference should use the new path |
| Another session is editing `src/runtimes/*` and `src/models/*` | task brief | All line numbers are as of the working tree read 2026-09-06 19:37; re-verify before implementing |

---

## 12. Decisions assumed — need user confirmation

| # | Question | Assumed answer | Why it matters |
| --- | --- | --- | --- |
| **Q1** | Should cloud models be **listed** even with no API key configured? | **Yes** — listed, marked "needs API key", never auto-selected (`04 §9`, option B). | The core local-first values call. Option A (hidden until authenticated) is the stricter alternative. |
| **Q2** | Store keys in a **new `~/.shelra/auth.json`** or in `user-settings.json` under `providers.openrouter.apiKey`? | **New `auth.json`**, OpenCode-style, `0o600` (`04 §6.1`). | Keeps secrets out of the file users paste into bug reports; adds a file. |
| **Q3** | Cloud cache **TTL**? | **6 hours** (`04 §8`). | 1 h = fresher, more requests. 24 h = fewer requests, more 404s. |
| **Q4** | Ship a `shelra auth` command at all, or document env vars only? | **Ship it** (`05 §1.7`). | Without it, first-run cloud setup is "read the docs". |
| **Q5** | Should `--api-key` keep persisting to settings (`index.ts:765`)? | **No** — session-only; `shelra auth` is the persisting path. | Changes existing behaviour; needs an explicit call. |
| **Q6** | Should the TUI picker keep writing **both** project and user settings (`app.tsx:830-831`)? | **Unchanged** for now; flagged as pre-existing. | Changing it alters existing behaviour outside this project's scope. |
| **Q7** | Bundle an offline fallback list of free models at all? | **Yes**, ~8 entries, clearly labelled (`04 §8`). | It will rot. The alternative is an empty cloud section offline. |
| **Q8** | Fix the mid-stream `finish_reason: "error"` gap (§6) in Phase 5, or file it separately? | **Assumed: separate follow-up**, because it touches `providers/stream.ts`. | Without it, rate-limited cloud turns fail silently. |
| **Q9** | Support OpenRouter's `models` fallback array / `route: "fallback"` (`02 §5`)? | **No** for v1. | It silently changes which model answered — an anti-goal here, but it would materially improve free-tier reliability. |
| **Q10** | What is the real `HTTP-Referer` value? | Placeholder `https://shelra.dev/` (`04 §5.2`). | Must be a URL the project actually controls. |
| **Q11** | Cloud entries beyond free — list paid OpenRouter models too? | **No** for v1; `cost.free` filter is applied at the source (`04 §4.2`). | The schema already supports paid; it is a one-line filter change. |
| **Q12** | Should `models use` also work while the TUI is running (IPC), or persist-only? | **Persist-only**; the TUI has `/models` (`05 §1.4`). | Avoids inventing an IPC channel. |
| **Q13** | Add a `catalog.cloud: false` settings kill switch (option C in `04 §9`)? | **Recommended, not assumed.** | Gives privacy-strict users a hard guarantee. |
