# 05 — CLI and UI surface

Proposal only. Current surface for comparison is `03 §5` (`shelra models` is a
single flagless command at `src/index.ts:931-952`).

---

## 1. Command tree

```
shelra models                                  # grouped human listing (default)
        --json                                 #   machine-readable
        --refresh                              #   force a cloud refetch first

shelra models list [--local | --cloud | --all] [--free] [--tools] [--refresh] [--json]
shelra models use <id>
shelra models add <hf-repo>[:<quant>]          # alias of `download` for a catalog id
shelra models download <id>
shelra models remove <id> [--yes]
shelra models refresh [--provider <id>]

shelra auth openrouter [--key <k>] [--show] [--remove]
shelra auth list
```

`shelra models` with no subcommand keeps its current meaning (list), so no
existing invocation breaks. Commander treats `models` as a command with
subcommands and a default action.

### 1.1 `shelra models` — default grouped output

```
ShelraCode model catalog

LOCAL
  ● local/hf:Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q4_K_M
      Qwen2.5 Coder 1.5B · Q4_K_M    installed · 1.0 GB · 32K ctx · tools
    local/hf:Qwen/Qwen2.5-Coder-7B-Instruct-GGUF:Q4_K_M
      Qwen2.5 Coder 7B · Q4_K_M      available · 4.7 GB download · 32K ctx
                                     shelra models download local/hf:Qwen/…:Q4_K_M

CLOUD · openrouter                                              ✗ no API key
    openrouter/minimax/minimax-m2.7:free
      MiniMax M2.7 (free)            free · 196K ctx · 172K out · tools
    openrouter/google/gemma-4-31b-it:free
      Gemma 4 31B (free)             free · 262K ctx · 32K out · tools · vision
    openrouter/cohere/north-mini-code:free
      North Mini Code (free)         free · 256K ctx · 64K out · tools · moderated
    … 13 more · shelra models list --cloud

  ● = active   Free models: 20 requests/min, 50/day (1000/day with credits).
  Cloud catalog cached 2026-09-06 19:42 · shelra models refresh
```

Rules:

* `LOCAL` first, always. Installed before available. `●` marks the active model.
* `CLOUD · <provider>` header carries the key state: `✓ API key set` /
  `✗ no API key`.
* Cloud is truncated to 5 entries with a "… N more" pointer; `models list`
  shows everything. (Full-listing 18 cloud models in the default view buries the
  local section, which is the wrong emphasis for this product.)
* The rate-limit line is **always** shown when a cloud section is rendered.
  `02 §4` makes this the single most consequential operational fact.
* The cache-age footer appears only when a cloud section is rendered.
* Colour usage follows the existing command (`index.ts:942` uses `\x1b[36m` for
  the id).

**Important behavioural change:** the current command runs
`discoverLocalRuntimes(…, AbortSignal.timeout(60_000))` (`index.ts:936`), which
can take a minute and disposes runtimes afterwards. Per `04 §4.1`, listing must
be a **filesystem-only** operation and must not start a llama-server.

### 1.2 `shelra models --json`

```json
{
  "version": 1,
  "generatedAt": "2026-09-06T17:42:11.204Z",
  "activeModel": "local/hf:Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q4_K_M",
  "providers": [
    { "id": "local",      "category": "local", "displayName": "Local",      "apiKeyConfigured": true,  "origin": "live" },
    { "id": "openrouter", "category": "cloud", "displayName": "OpenRouter", "apiKeyConfigured": false, "origin": "cache",
      "fetchedAt": "2026-09-06T17:42:03.771Z" }
  ],
  "entries": [
    {
      "id": "local/hf:Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q4_K_M",
      "category": "local", "provider": "local",
      "name": "Qwen2.5 Coder 1.5B · Q4_K_M",
      "contextWindow": 32768, "maxOutputTokens": null, "contextConfidence": "catalog",
      "capabilities": { "tools": true, "reasoning": false, "vision": false },
      "cost": { "prompt": 0, "completion": 0, "free": true },
      "active": true,
      "state": {
        "kind": "local", "install": "installed",
        "path": "C:\\Users\\me\\.shelra\\models\\qwen2.5-coder-1.5b-instruct-q4_k_m.gguf",
        "sizeBytes": 1117320768, "quantization": "Q4_K_M", "parameters": 1500000000,
        "runtimeId": "shelra-llama", "runtimeKind": "managed-llama"
      }
    },
    {
      "id": "openrouter/google/gemma-4-31b-it:free",
      "category": "cloud", "provider": "openrouter",
      "name": "Google: Gemma 4 31B (free)",
      "contextWindow": 262144, "maxOutputTokens": 32768, "contextConfidence": "declared",
      "capabilities": { "tools": true, "reasoning": true, "vision": true, "structuredOutput": true },
      "cost": { "prompt": 0, "completion": 0, "free": true },
      "active": false,
      "state": {
        "kind": "cloud", "providerModelId": "google/gemma-4-31b-it:free",
        "apiKeyConfigured": false, "moderated": false,
        "notes": ["20 requests/min, 50/day without purchased credits"]
      }
    }
  ],
  "warnings": []
}
```

`--json` **never** prints the API key, and never prints a redacted form of it
either. `apiKeyConfigured` is a boolean; that is all.
`--json` exits 0 even when the cloud fetch failed — the failure is in
`warnings[]`. Scripts should not have to parse stderr.

### 1.3 `shelra models list`

| Flag | Effect |
| --- | --- |
| `--local` | local entries only |
| `--cloud` | cloud entries only |
| `--all` | everything, no truncation (the default for `list`) |
| `--free` | `cost.free === true` only |
| `--tools` | `capabilities.tools === true` only |
| `--refresh` | force a network refetch before listing |
| `--json` | as above |

`--local` and `--cloud` together are an error (see `§4`).
`list` never truncates; the default `models` view does.

### 1.4 `shelra models use <id>`

1. Resolve `<id>` per `04 §3.1` (exact → legacy bare local id → cloud
   `providerModelId` → unambiguous suffix).
2. Validate:
   * local + `install: "available"` → refuse, point at `models download`;
   * cloud + no key → refuse with the `04 §6.3` text;
   * `capabilities.tools === false` → refuse (ShelraCode is an agent);
   * cloud + expired → refuse and suggest `models refresh`.
3. Persist `defaultModel = <canonical id>` via `saveUserSettings`
   (`settings.ts:231`). **Do not** write `saveProjectSettings` from the CLI —
   note that the TUI picker currently writes *both* (`app.tsx:829-832`); see
   `07`.
4. If a session is running, rebuild the adapter (`§3`). From the CLI it is a
   persist-only operation that takes effect on the next start.

Success output:

```
Active model: openrouter/google/gemma-4-31b-it:free
  Google: Gemma 4 31B (free) · cloud · 262K ctx · 32K max output · tools, vision
  Free tier: 20 requests/min, 50 requests/day (1000/day once you have purchased 10 credits).
  Conversations are sent to https://openrouter.ai/api/v1 and may be used for training.
```

The third line prints **only** for cloud entries and **every** time — this is
the local-first product telling the truth about what just changed.

### 1.5 `shelra models add` / `download` / `remove`

* `models download <id>` — accepts a catalog id (`local/hf:…`) or a bare
  `hf:…` id. Wraps `installLocalModel` (`models/manager.ts:28`), which enforces
  the disk floor and delegates to `ManagedLlamaRuntime.installModel`
  (`managed-llama.ts:364`) with its reviewed-catalog allowlist (`:375-376`).
  Progress reuses `formatDownloadSize` / `formatDownloadSpeed`
  (`huggingface.ts:334-343`).
* `models add <hf-repo>[:<quant>]` — the ergonomic alias.
  `shelra models add Qwen/Qwen2.5-Coder-7B-Instruct-GGUF:Q4_K_M` maps to
  `hf:Qwen/Qwen2.5-Coder-7B-Instruct-GGUF:Q4_K_M`.
  **It must not become an arbitrary-repo installer.** The allowlist at
  `managed-llama.ts:375-376` is a deliberate supply-chain control that audit
  `18` §1 says to keep. An unlisted repo gets the error in `§4`.
* `models remove <id>` — deletes the `.gguf` and its `.json` sidecar. Confirms
  interactively unless `--yes`. Refuses to remove the model that is currently
  loaded by a running runtime; refuses anything outside
  `defaultModelDirectory()` (`huggingface.ts:85-87`).

Progress line (reusing the existing formatters):

```
Downloading Qwen2.5 Coder 7B · Q4_K_M
  2.1 GB / 4.7 GB   45%   12.4 MB/s   ETA 3m 29s
```

### 1.6 `shelra models refresh`

```
Refreshing cloud catalogs…
  openrouter   18 free models   (fetched in 812 ms)
Cached to ~/.shelra/catalog/openrouter.json
```

`--provider <id>` limits it. Local needs no refresh (it is always live).

### 1.7 `shelra auth openrouter`

```
shelra auth openrouter --key sk-or-v1-…
shelra auth openrouter                  # prompts, input hidden
shelra auth openrouter --show           # prints only whether a key is set and its source
shelra auth openrouter --remove
shelra auth list
```

On set, validate with `GET /api/v1/key` (`02 §6`) and report the *real* limits:

```
OpenRouter key saved to ~/.shelra/auth.json (mode 600).
  Free tier: yes · 50 requests/day
  Reminder: free models require "free endpoints that may train on inputs"
  at https://openrouter.ai/settings/privacy.
```

If validation returns 401, the key is **not** saved (`§4`).

`shelra auth list` never prints key material:

```
openrouter   configured   source: ~/.shelra/auth.json
```

**Alternative if `shelra auth` is judged out of scope:** document
`OPENROUTER_API_KEY` and hand-editing `auth.json` only. The command is a
convenience, not a requirement — but without it the first-run path for a free
cloud model is "read the docs", which undercuts the feature.

---

## 2. In-TUI `/models` picker

The slash item already exists (`ui/slash-menu.ts:17`) and opens
`ModelPickerModal` (`app.tsx:5367`). Changes:

### 2.1 Sections

Today `modelCatalog` is `startupConfig.localModels ?? []` (`app.tsx:808`) — a
flat `ModelInfo[]` filtered by substring on name-or-id (`:809-815`). Proposed:

* feed the picker `CatalogEntry[]` (mapped to a display row), not `ModelInfo[]`;
* render two sticky group headers, `LOCAL` and `CLOUD · OpenRouter`, in that
  fixed order (**not** alphabetical by provider as OpenCode does — `01 §6` —
  because the local/cloud axis *is* the product's stance);
* keep the existing search box; it filters within sections and hides an empty
  section;
* rows show: name, then a dim right-aligned meta string
  (`32K ctx`, `installed`, `needs key`, `free`, `tools`);
* the `●` active marker replaces today's `t.accent` colouring of the current row
  (`app.tsx:5433`) — or complements it.

Keyboard handling (`app.tsx:2978-3019`) is unchanged: ↑/↓ move through the
**flattened** row list, skipping headers; esc closes; enter selects.

### 2.2 Selection path

`selectLocalModel` (`app.tsx:816-838`) becomes `selectModel(entryId)`:

```
selectModel(id)
  ├─ local  → startupConfig.onSelectLocalModel(id)      (unchanged path,
  │            i.e. index.ts:prepareLocalModel → prepareModel → provider →
  │            probeLocalModel → agent.setProvider)
  └─ cloud  → startupConfig.onSelectCloudModel(id)      (NEW)
               → resolve key → createOpenAICompatibleProvider(..., headers, retries)
               → agent.setProvider(provider, providerModelId)
```

A new `startupConfig.onSelectCloudModel?: (id) => Promise<{success, error?}>` is
added next to `onSelectLocalModel` (`app.tsx:575`), symmetric and optional, so
`--remote` runs (which pass `undefined` for both — `index.ts:229-230`) keep
compiling and behaving.

**Note the existing double-write.** `selectLocalModel` writes *both*
`saveProjectSettings({model})` and `saveUserSettings({defaultModel})`
(`app.tsx:830-831`). Picking a model in one repo therefore pins it for that repo
**and** changes the global default. That is pre-existing behaviour; changing it
is a separate decision (`07`).

### 2.3 Mid-session switch semantics

Per audit `14` §4, re-verified in `03 §7`:

* `agent.setProvider` (`agent.ts:714-719`) replaces one mutable field; no cached
  derived state to invalidate. **Safe.**
* `getModelInfo()` (`:655-657`) re-derives from the live provider each call, and
  `getContextStats` takes `contextWindow` as a parameter (`:753`). **The new
  context window takes effect on the next render with no extra plumbing.**
* An in-flight turn captured `requireProvider()` locally at turn start, so a
  mid-turn swap cannot corrupt a running stream. The picker should still be
  disabled while `switchingModel` is true (already the case — `app.tsx:819`).
* **Conversation history is NOT re-validated against the new context window.**
  Switching from a 262 K cloud model to a 32 K local one leaves an oversized
  history that only compaction will notice. Therefore, on every switch:
  1. recompute `agent.getContextStats(newInfo.contextWindow)`;
  2. if used > ~85 % of the new window, show the warning in `§4` and offer
     `/compact`;
  3. never silently truncate.
  **The actual re-fit/compaction behaviour is the queued context-budget work.**
  This project owes the *re-check trigger* and the *correct number*.
* `agent.batchApi` is only ever turned off, never restored (`agent.ts:717`).
  Switching to a batch-capable provider will not re-enable it. Pre-existing;
  recorded in `07`.
* **Do not dispose the local runtime when switching to cloud.** The user is
  likely to switch back, and a llama-server restart costs 15–45 s
  (`managed-llama.ts:25` `SERVER_START_TIMEOUT_MS = 45_000`). Dispose only on
  exit, as today (`index.ts:140`).

---

## 3. Startup / onboarding touchpoint

`runStartup` returns `state: "onboarding"` when no local model is ready
(`orchestrator.ts:103-112`). Today that branch offers only "install the
recommended GGUF". Proposed addition (Phase 9), preserving the ordering:

```
No local model is ready yet.

  [Enter]  Download Qwen2.5 Coder 1.5B · Q4_K_M  (1.0 GB) — runs entirely on this computer
  [c]      Use a free cloud model instead — needs an OpenRouter API key,
           and your conversations leave this computer
  [r]      Retry local detection
```

Local stays the default action bound to Enter. Cloud is a labelled, secondary
key with the trade-off stated inline.

---

## 4. Exact text of every new error and empty state

**Empty catalog (nothing local, no network, no cache):**
```
No models are available yet.

  Local:  no model is installed. Run `shelra` to start onboarding, or
          `shelra models download local/hf:Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q4_K_M`.
  Cloud:  the OpenRouter catalog could not be fetched and no cached copy exists.
          Check your connection and run `shelra models refresh`.
```

**No local models, cloud available:**
```
LOCAL
  No local model is installed. Run `shelra` to start onboarding.
```

**Cloud fetch failed, cache present:**
```
CLOUD · openrouter                                   ✓ API key set
  Showing a cached catalog from 2026-09-05 08:14 (could not reach openrouter.ai).
```

**Cloud fetch failed, no cache, bundled fallback in use:**
```
CLOUD · openrouter                                   ✗ no API key
  Offline: showing a built-in list of known free models. Some may no longer exist.
  Run `shelra models refresh` when you are back online.
```

**Offline mode explicitly enabled:**
```
CLOUD · openrouter
  Cloud catalog disabled (SHELRA_OFFLINE is set).
```

**`models use` — unknown id:**
```
No model matches "gemma-9".
Run `shelra models list --all` to see every available id.
```

**`models use` — ambiguous id:**
```
"gemma-4-31b-it:free" matches more than one model:
  openrouter/google/gemma-4-31b-it:free
  someprovider/google/gemma-4-31b-it:free
Use the full id.
```

**`models use` — local model not installed:**
```
local/hf:Qwen/Qwen2.5-Coder-7B-Instruct-GGUF:Q4_K_M is not installed (4.7 GB download).
Install it with:
  shelra models download local/hf:Qwen/Qwen2.5-Coder-7B-Instruct-GGUF:Q4_K_M
```

**`models use` — cloud model, no API key** (canonical text, also used by the
picker — same wording as `04 §6.3`):
```
openrouter/google/gemma-4-31b-it:free needs an OpenRouter API key.

  Set one with:   shelra auth openrouter --key <key>
  Or export:      OPENROUTER_API_KEY=<key>

  Get a key at https://openrouter.ai/keys
  Free models also require enabling free training endpoints at
  https://openrouter.ai/settings/privacy — otherwise requests fail with
  "404 No endpoints found matching your data policy".
```

**`models use` — model without tool support:**
```
openrouter/nvidia/nemotron-3.5-content-safety:free does not support tool calling,
so ShelraCode cannot use it as an agent model.
Run `shelra models list --cloud --tools` to see models that do.
```

**`models use` — expired / withdrawn cloud model:**
```
openrouter/example/model:free is no longer offered by OpenRouter.
Run `shelra models refresh` to update the catalog.
```

**`models download` — repo not in the reviewed catalog:**
```
"someone/random-gguf" is not in ShelraCode's reviewed local catalog.
ShelraCode only installs models it has reviewed and pinned by checksum.
Run `shelra models list --local` to see what is available.
```

**`models remove` — confirmation:**
```
Remove Qwen2.5 Coder 7B · Q4_K_M (4.7 GB) from
  C:\Users\me\.shelra\models\qwen2.5-coder-7b-instruct-q4_k_m.gguf ?
This deletes the file. [y/N]
```

**`models remove` — model in use:**
```
Qwen2.5 Coder 1.5B · Q4_K_M is the active model and is currently loaded.
Switch to another model first: shelra models use <id>
```

**`auth openrouter` — invalid key:**
```
OpenRouter rejected that key (HTTP 401). Nothing was saved.
Check the key at https://openrouter.ai/keys
```

**`auth openrouter --show`, no key:**
```
openrouter   not configured
  Set one with: shelra auth openrouter --key <key>
  Or export:    OPENROUTER_API_KEY=<key>
```

**Conflicting list flags:**
```
--local and --cloud cannot be combined. Use --all to show both.
```

**First cloud turn in a session (one-time notice, TUI and headless):**
```
Now using openrouter/google/gemma-4-31b-it:free.
Messages, file contents and tool results in this session are sent to
https://openrouter.ai/api/v1. Free OpenRouter models may use your prompts
for training. Switch back with /models or `shelra models use local/…`.
```

**Context shrank on switch:**
```
This conversation uses about 41K tokens, but
local/hf:Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q4_K_M has a 32K context window.
Run /compact before continuing, or switch back to a larger model.
```

**Rate limited (429) during a cloud turn:**
```
OpenRouter rate limit reached (20 requests/minute on free models).
Retrying in 12s… (attempt 2 of 3)
```

**Daily quota exhausted:**
```
OpenRouter free-model daily limit reached (50 requests/day).
The limit rises to 1000/day once your account has purchased 10 credits.
Switch to a local model with /models, or try again tomorrow.
```

**Data-policy 404:**
```
OpenRouter returned "No endpoints found matching your data policy".
Free models require enabling "free endpoints that may train on inputs"
at https://openrouter.ai/settings/privacy.
```

**Negative balance (402):**
```
OpenRouter returned 402 Payment Required. This can happen with a negative
credit balance, even on free models. Add credits at https://openrouter.ai/credits
```

---

## 5. Status line

While a cloud model is active, the TUI status line must carry a persistent
marker — not just a one-time notice:

```
☁ openrouter/google/gemma-4-31b-it:free · 262K ctx · 12/50 today
```

vs local:

```
● local/hf:Qwen2.5-Coder-1.5B · 32K ctx
```

The `12/50 today` counter is a **local** count of cloud requests made this day,
not a call to `/api/v1/key`. It costs nothing and turns the most surprising
failure mode (`02 §4`) into something the user can see coming.
