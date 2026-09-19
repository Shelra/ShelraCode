# Model and runtime map

## Target at audit time

The target had one provider path. `src/toolset/client.ts:43-59` created an xAI SDK provider from an API key/base URL and resolved an xAI chat or responses model. `src/toolset/models.ts:3-111` statically described xAI model IDs, context windows, prices, reasoning effort and response/client-tool capabilities. `src/agent/agent.ts:1871-1952` selected that runtime and sent AI SDK `streamText`; title/recap used `generateText` in the same client. There was no hardware-aware eligibility or empirical capability probe in the target path. The xAI-only client, static model registry and media modules described here have since been removed.

Target model-facing features included xAI web/X search, xAI image/video generation, xAI batch HTTP (`src/toolset/batch.ts`, `src/agent/agent.ts:956-1150`), xAI STT and x402 payment/wallet tools. They must be represented as capabilities, not silently retained after xAI removal.

## Shelra today

| Stage | Implementation evidence | Observed behavior/status |
|---|---|---|
| Hardware | `ShelraCode/src/hardware/llmfit.ts:1-262` | Parses `llmfit` machine-readable system/recommendations; basic OS/CPU/RAM fallback. No internal fit database. |
| Runtime discovery | `ShelraCode/src/runtimes/discovery.ts:14-86` | Ollama always; generic local OpenAI optional; LM Studio and llama.cpp OpenAI-compatible adapters. Localhost URLs are configurable. |
| Runtime contract | `ShelraCode/src/runtimes/types.ts:25-36` | `detect`, `health`, `listModels`, normalized capabilities and optional `provider()`. No download/load/unload methods. |
| Ollama | `ShelraCode/src/runtimes/ollama.ts:24-155` | `/api/tags` health/model listing; filters embeddings; returns local/free/privacy/capability metadata. |
| OpenAI-compatible local | `ShelraCode/src/runtimes/http.ts` and `src/providers/openai-compatible.ts` | `/v1/models`, optional metadata/capability probes, SSE stream normalization, typed errors. |
| Model catalog/download | repository search across `src`, `tests`, `docs`, `scripts` | No Hugging Face catalog, GGUF scanner/download manager, embedded inference or lifecycle manager found. |
| Provider normalization | `ShelraCode/src/providers/types.ts:13-118` | Normalized request, messages, tool calls, usage, health/quota/failures and adapter contract. |
| Stream normalization | `ShelraCode/src/providers/stream-normalizer.ts:144-230` | Text/reasoning/tool/usage/done/error events; malformed tool-shaped text quarantined. |
| Routing | `ShelraCode/src/router/router.ts`, `src/cli/control-plane.ts:311-508` | Privacy -> capability -> cost -> tools -> context -> health -> quota -> score; capability probes/cache and structured reasons. |

LM Studio is therefore an optional compatibility endpoint, not a product dependency. Ollama and generic OpenAI-compatible local servers are equally represented. Direct llama.cpp process management is not present; the current adapter assumes a server endpoint.

## Evidence flow intended for migration

```text
hardware profile
  -> runtime detection/health
  -> normalized model candidates
  -> optional measured capability probe/cache
  -> task analysis and privacy/cost policy
  -> route decision + execution profile
  -> normalized stream
  -> host tool execution and observations
```

The target can first consume a `ProviderAdapter` through a compatibility implementation that wraps xAI. Phase 2 can add Shelra local adapters through the control plane. The UI receives a provider-neutral model summary (id, runtime, context, capabilities, health, privacy/cost status) rather than a provider object.

## Capability and context cautions

Static model names are not proof of coding or tool ability. Shelra's measured capability evidence is optional and currently local real-model coverage is marked UNPROVEN in `ShelraCode/docs/STATUS.md`; no migration document may advertise a local model as verified without a recorded probe. Context budgets must use model metadata plus `context-budget.ts`/context capsules and compaction, rather than target's xAI-only context estimate.

## Missing systems to plan explicitly

Automatic model download, quantization selection, GGUF management, load/unload lifecycle, and embedded inference are not present in the local source. They are Phase 2 decisions, not an invitation to add an unverified LM Studio dependency. If needed, implement a separate lifecycle capability after the normalized adapter is green; preserve a working endpoint adapter first.


## Startup integration update

`src/startup/orchestrator.ts` now consumes the runtime map: it probes reachable
runtimes and models, ranks candidates with GPU/RAM-aware routing, health-checks a
provider-neutral adapter, and persists the selected model/runtime. The target's
managed path is `src/runtimes/managed-llama.ts` plus the pinned release/bootstrap
in `src/runtimes/bootstrap.ts`; `src/models/huggingface.ts` owns reviewed GGUF
download, resume, integrity and atomic finalization. The reference checkout did
not provide this lifecycle, so these modules are a single target implementation,
not a second runtime architecture.
