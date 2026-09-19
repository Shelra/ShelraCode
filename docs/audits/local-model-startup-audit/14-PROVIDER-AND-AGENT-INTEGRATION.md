# 14 — Provider abstraction & agent-kernel integration

## 1. The provider seam

```ts
// src/providers/types.ts:76-86
export interface ProviderAdapter {
  readonly id: string;
  readonly defaultModelId?: string;
  readonly supportsBatch?: boolean;
  resolveModelRuntime(modelId, options?): ProviderModelRuntime;
  stream(request: ProviderStreamRequest): ProviderStream;
  generateText(request: ProviderTextRequest): Promise<ProviderTextResult>;
  getToolContext(): ProviderToolContext;
}
```

Supporting types: `ProviderUsage` (`:7-12`), `ProviderModelRuntime` (`:14-19`),
`ProviderStreamRequest` (`:21-34`), **`ProviderEvent`** (`:36-43`),
`ProviderStream` (`:45-48`), `ProviderTextRequest/Result` (`:50-63`),
`ProviderToolContext` (`:65-73`).

**FACT — this is a genuinely good abstraction.** `messages` and `tools` are
typed `readonly unknown[]` / `unknown` (`:25-26`) with the comment *"Messages
and tools are opaque at this boundary and owned by the adapter"*, so no SDK type
crosses the seam. Events are normalised to a 7-member closed union.

### Implementations

| Adapter | File | Status |
| --- | --- | --- |
| `LocalProviderAdapter` | `src/runtimes/local-provider.ts:40-129` | **ACTIVE** — used for both managed-llama and `openai-compatible` |
| `createLocalProvider(model)` | `:127-129` | **ACTIVE** — `ManagedLlamaRuntime.provider` `:239` |
| `createOpenAICompatibleProvider(apiKey, baseURL, modelId)` | `:133-152` | **ACTIVE** — `explicitEndpointRuntime.provider` (`discovery.ts:69`) **and** `Agent.setApiKey` (`agent.ts:728`) |
| `FakeProvider` | `src/providers/fake.ts:13-56` | **TEST-ONLY** — imported by `orchestrator.test.ts`, `architecture.test.ts` |
| xAI-only adapter / `createProvider` | `src/toolset/client.ts:120,234` | **DEAD** — no runtime importer (since removed) |

**FACT — one class serves every provider.** `createOpenAICompatibleProvider`
constructs a synthetic `LocalModelCandidate` with `source: "remote"`,
`contextWindow: 128_000`, `tools: true`, `capabilityConfidence: "unknown"`
(`:135-148`) and reuses `LocalProviderAdapter`. So the "remote" path is really
"OpenAI-compatible over HTTP" and inherits `maxRetries: 0` (`:88`) — which is
correct for a loopback server and **questionable for a remote API over the
internet**.

## 2. Stream normalisation

`normalizeProviderEvents` (`src/providers/stream.ts:30-67`) maps the AI SDK's
`fullStream` parts to `ProviderEvent`: `text-delta`, `reasoning-delta`,
`tool-call`, `tool-result`, `tool-approval-request`, `error`, `abort`.
Unrecognised part types are silently dropped (no `default` case).

**FACT — the migration to this normaliser left four dead helpers behind** in
`src/agent/agent.ts`: `toToolCall` (`:2706`), `getStepNumber` (`:2729`),
`getFinishReason` (`:2737`), `getUsage` (`:2753`). All four are unreferenced
(verified by grep and by Biome's `lint/correctness/noUnusedVariables`, which
flags exactly these four line numbers). They are superseded by
`src/providers/stream.ts:11-27` and `src/runtimes/local-provider.ts:16-38`.

## 3. Does local-provider concern leak into UI / chat / agent / tools / storage?

There is a **test enforcing the boundary**:

```
src/providers/architecture.test.ts
  :5  "keeps xAI provider types out of the Agent and tool registry"
  :14 "keeps the xAI SDK import out of the Agent"
```

Audited leaks, all **FACT**:

| Leak | Location | Severity |
| --- | --- | --- |
| `ModelInfo.runtimeKind` — a *runtime* concept — is part of the shared UI model type | `src/types/index.ts` (consumed at `src/index.ts:432`, `src/runtimes/local-provider.ts:75`) | Low — but it is how the agent special-cases local models |
| `maxOutputTokensForTurn` branches on `runtime.modelInfo?.runtimeKind !== "managed-llama"` | `src/agent/agent.ts:394` | **Medium — the agent hard-codes a specific runtime id** |
| `ManagedLlamaRuntime` imports `createLocalProvider` from a sibling and constructs providers itself | `src/runtimes/managed-llama.ts:13,238-240` | Low — intended by the contract |
| The UI imports byte formatters from the model module | `src/ui/startup.tsx:5` ← `src/models/huggingface.ts:239-248` | Low |
| The UI hard-codes the runtime id `"shelra-llama"` | `src/index.ts:222` | Low-Medium |
| `src/toolset/client.ts` imports `createOpenAICompatibleProvider` from `src/runtimes/` | `src/toolset/client.ts:17` | Odd direction (legacy → runtimes), but the file is dead |
| `src/models/catalog.ts` stubs are imported by `agent.ts`, `app.tsx`, `settings.ts`, `client.ts` | see `07` §1 | **Medium** — a placeholder module is load-bearing in four subsystems |

**FACT — the runtime adapter itself never reaches the UI.** `renderApp`
(`src/index.ts:192-215`) passes only plain data plus one callback. That is good
isolation — and it is also why the chat UI cannot check runtime health
(`12` §5). **The isolation is correct; the missing piece is a readiness/health
*port* on the data contract.**

## 4. Agent integration

### Provider installation

```ts
// src/agent/agent.ts:714-719
setProvider(provider: ProviderAdapter, modelId?: string): void {
  this.provider = provider;
  if (provider.supportsBatch === false) this.batchApi = false;
  if (modelId) this.setModel(modelId);
}
```

**FACT — a single mutable field (`private provider: ProviderAdapter | null`,
`:582`).** No cached derived state is invalidated on swap: `this.modelId` is
updated via `setModel` (`:659-665`), and `getModelInfo()` (`:655-657`) re-derives
from the current provider on every call. `getContextStats` takes
`contextWindow` as a parameter (`:753`) rather than caching it.

**FACT — swapping a provider mid-session is therefore safe with respect to
metadata**, but:

* `this.messages` (the conversation) is **not** re-validated against the new
  model's context window. Switching from a 128 K model to a 32 K one leaves an
  oversized history that only `compactForContext` (`:2021-2029`) will notice —
  and see §6 for why that compaction cannot succeed at 32 K.
* An **in-flight** turn holds a local `const provider = this.requireProvider()`
  (`:1913`) captured at turn start, so a mid-turn switch does not corrupt the
  running stream. Correct by construction.
* `this.batchApi` is only ever turned **off** (`:717`), never restored.

### Where the model id lives

Three copies, kept in sync by hand:

| Copy | Owner | Updated by |
| --- | --- | --- |
| `agent.modelId` | `src/agent/agent.ts:596` | `setModel` (`:659`), `setProvider` (`:718`), `setMode` (`:690-693`) |
| `session.model` in SQLite | `SessionStore` | `sessionStore.setModel` (`:645,662,696`) |
| `model` React state | `src/ui/app.tsx` | `setModel(modelId)` (`:829`) |
| `defaultModel` in settings | `~/.shelra/user-settings.json` | `:831`, `orchestrator.ts:221`, `index.ts:182` |

**FACT — `setMode` can silently change the model** (`:687-699`): if
`getModeSpecificModel(mode)` returns a value, `this.modelId` is replaced
**without** touching `this.provider`. For local runtimes this would point the
adapter at a model id the loaded server does not have — though in practice
`modeModels` is unset by default, so the branch is dormant. **Latent hazard.**

### `requireProvider`

```ts
// src/agent/agent.ts:2341-2349
private requireProvider(): ProviderAdapter {
  if (!this.provider) throw new Error(
    "No model runtime configured. Start a local runtime or set SHELRA_API_KEY together with SHELRA_BASE_URL.");
  return this.provider;
}
```

**FACT — this is the only readiness assertion inside the agent**, and it checks
object existence, not liveness.

## 5. `AgentKernel` — the new lifecycle seam

```ts
// src/agent/kernel.ts:38-114
export class AgentKernel {
  phase: "frame"|"discover"|"analyze"|"plan"|"act"|"observe"|"reflect"|"verify"|"review"|"complete"|"blocked"|"cancelled"
  snapshot() / transition() / setScope() / recordMutation() / recordObservation()
  recordVerification(success, details) / evaluateCompletion({verificationPassed, reviewPassed, requiredPaths}) / cancel()
}
```

Wiring (**FACT**, grep-verified):

| Site | Line |
| --- | --- |
| import | `src/agent/agent.ts:98` |
| field | `:604` `private kernel: AgentKernel \| null = null` |
| construct per turn | `:1925` `this.kernel = new AgentKernel(userMessage)` |
| scope from the context packet | `:1926` `this.kernel.setScope(contextPacket.files)` |
| three immediate transitions | `:1927-1929` `discover` → `analyze` → `plan` |
| verification path | `:2374` `if (!this.kernel) this.kernel = new AgentKernel("verification")` |
| exposed | `:736-738` `getKernelState()` |
| tests | `src/agent/kernel.test.ts` (2 cases) |

**FACT — the kernel is instantiated and driven only at the *start* of a turn.**
The three transitions at `:1927-1929` run back-to-back with no work between
them. Grep for `recordMutation`, `recordObservation`, `evaluateCompletion`,
`cancel` inside `src/agent/agent.ts`: **`recordVerification` and
`evaluateCompletion` appear only in `kernel.test.ts`**; `recordMutation` and
`recordObservation` are never called from the agent.

**Classification: `AgentKernel` is a PARTIALLY WIRED seam.** It is constructed,
scoped and transitioned three times per turn, and `getKernelState()` is
exposed — but nothing in the agent loop feeds it mutations, observations,
verification results, or completion decisions, and grep of `src/ui/app.tsx`
shows `getKernelState` is never called. It records the *start* of a turn and
nothing else.

## 6. Context & model limits — can the agent adapt to a small model?

### What adapts

**FACT — one real adaptation exists:**

```ts
// src/agent/agent.ts:389-398
function maxOutputTokensForTurn(runtime, kind, configured) {
  if (runtime.modelInfo?.runtimeKind !== "managed-llama") return configured;
  if (kind === "conversation") return Math.min(configured, 512);
  if (kind === "repository")   return Math.min(configured, 256);
  return Math.min(configured, 2_048);
}
```
Used at `:2072`. This is a deliberate small-model policy — and it keys on
`runtimeKind`, not on the model's actual size or context.

**FACT — a second adaptation is the host context compiler.**
`compileContextPacket` (`src/context/compiler.ts:113-164`) classifies the turn
and, for `conversation`, disables tools entirely (`toolPolicy: "none"` →
`tools = {}` at `src/agent/agent.ts:2013-2014`) and for broad reviews supplies
`hostEvidenceOnly` bounded evidence instead of tool calls (`:1934-1937`). This
is a genuine "weak model" strategy: do the retrieval on the host, ask the model
once.

### What does not adapt — and the arithmetic that breaks

```ts
// src/agent/agent.ts:1584-1589
private getCompactionSettings(): CompactionSettings {
  return {
    reserveTokens: Math.max(this.maxTokens, DEFAULT_RESERVE_TOKENS),   // max(16384, 16384) = 16384
    keepRecentTokens: DEFAULT_KEEP_RECENT_TOKENS,                      // 20000
  };
}
// src/agent/compaction.ts:30-32
export const DEFAULT_RESERVE_TOKENS = 16_384;
export const DEFAULT_KEEP_RECENT_TOKENS = 20_000;
// :247-253
export function shouldCompactContext(contextTokens, contextWindow, settings) {
  return contextTokens > contextWindow - settings.reserveTokens;
}
```

With `this.maxTokens = 16_384` (`:633`, the default) and a local
`contextWindow = 32_768`:

```
compaction trigger  = 32 768 − 16 384 = 16 384 tokens
tokens kept after compaction ≈ keepRecentTokens = 20 000 tokens
                              20 000 > 16 384
```

**FACT — compaction cannot bring the conversation below its own trigger.** The
"keep recent" budget alone exceeds the entire usable window. Once a local
session crosses ~16 K tokens, `compactForContext` runs on every turn, summarises,
and still leaves the conversation above threshold. These constants were sized for
128 K+ remote models and were **not adjusted for the 32 K local window**.

`relaxCompactionSettings` (used at `:2018` after an overflow) and
`MIN_KEPT_TOKENS_ON_RETRY = 4_000` (`compaction.ts:28`) provide a second-chance
path, but only *after* a turn has already failed with an overflow error.

### Other non-adaptations

| Concern | Status |
| --- | --- |
| `maxTokens` default 16 384 vs a 32 K window | **Not model-aware** — `Number(env.SHELRA_MAX_TOKENS) \|\| 16_384` (`:632-633`) |
| Reserved-output calculation | Fixed constant, not `contextWindow`-relative |
| Task decomposition for weak models | **NOT FOUND** |
| Tool-count reduction for weak models | Only the coarse `toolPolicy` classification |
| `applyModelConstraints` (disable tools for non-tool models) | **DEAD** — depends on `getModelInfo` which always returns `undefined` (`src/models/catalog.ts:11-13`; see `07` §1) |
| Capability-confidence gating | `capabilityConfidence` is set and displayed but **never gates behaviour** — `selectLocalRoute:29-31` only pushes a string into `reasons[]` |

## 7. Verdict

| Aspect | Status |
| --- | --- |
| Provider contract, SDK-free | **IMPLEMENTED** (test-enforced) |
| Normalised stream events | **IMPLEMENTED** |
| Usage / model metadata normalised | **IMPLEMENTED** |
| Capability metadata (`capabilityConfidence`, `capabilityClass`) | **PLACEHOLDER** — populated with constants, never gates behaviour |
| Single adapter class for local+remote | **IMPLEMENTED** (with `maxRetries: 0` inherited by remote) |
| Provider swap safety | **IMPLEMENTED** for metadata; **PARTIAL** for conversation history |
| Runtime-id leakage into the agent | **PARTIAL** — `runtimeKind === "managed-llama"` hard-coded at `agent.ts:394` |
| `AgentKernel` | **PARTIALLY WIRED** — constructed and scoped, never fed |
| Small-model output clamping | **IMPLEMENTED** (`agent.ts:389-398`) |
| Host-side context bounding | **IMPLEMENTED** (`context/compiler.ts`) |
| Compaction sized for a 32 K window | **BROKEN** (`20 000 > 16 384`) |
| Tool-support gating for weak models | **DEAD** (`applyModelConstraints`) |
| Dead post-refactor helpers | **DEAD** — 4 functions, lint-flagged (`agent.ts:2706,2699,2707,2723`) |
</content>
</invoke>
