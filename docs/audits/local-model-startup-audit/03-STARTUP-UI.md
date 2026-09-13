# 03 — Startup UI

## 1. First visual state

**FACT.** The first rendered component is `StartupScreen`
(`src/ui/startup.tsx:104-250`), painted at `src/index.ts:416` with
`{ state: "booting", message: "Preparing your local coding environment" }`
(`src/index.ts:131`). `App` (`src/ui/app.tsx:596`) is *not* mounted until
`renderApp` (`src/index.ts:192-215`).

There is exactly **one** OpenTUI renderer for both screens
(`src/index.ts:98-106`), and one React root (`:121`). Transition = re-render of
that root.

## 2. The render mechanism (and its cost)

```ts
// src/index.ts:123-130
const renderRoot = (node: unknown) => {
  if (rootMounted) root.unmount();
  root.render(node as never);
  rootMounted = true;
};
```

**FACT.** Every progress update **unmounts and remounts the entire React tree**.
The comment at `:124-126` says this is deliberate ("OpenTUI's `createRoot.render`
creates a new reconciler container on each call. Unmounting first keeps
resize/mouse listeners bounded").

**Consequences (FACT):**
* `StartupScreen` has no persistent component state — every frame is a fresh
  mount. `useMemo` at `src/ui/startup.tsx:117-127` is recomputed each time.
* The download-progress path deliberately throttles to 4 fps to compensate:
  `if (progress.status === "downloading" && now - lastDownloadRenderAt < 250) return;`
  (`src/index.ts:294`). The runtime-install path (`:233-247`) has **no such
  throttle** on the JS side; it relies on `downloadArchive`'s own 150 ms
  emit gate (`src/runtimes/bootstrap.ts:144`).
* **INFERENCE (medium):** the unmount/remount-per-frame pattern makes the
  startup screen the most expensive-to-update surface in the app, and it will
  not scale to a richer onboarding UI without change.

**FACT — the transition into chat is also an unmount/remount:** `renderApp`
(`:197`) calls the same `renderRoot`, so `App` mounts fresh. There is no shared
state, no animation, no crossfade — the startup panel is replaced wholesale.

## 3. Which states the UI can represent

`StartupState` has 14 members (`src/startup/types.ts:7-21`):
`booting`, `detecting-runtime`, `detecting-models`, `validating-model`,
`detecting-hardware`, `onboarding`, `recommending-model`, `downloading-model`,
`preparing-runtime`, `loading-model`, `health-check`, `ready`,
`recoverable-error`, `fatal-error`.

Mapping against the required vocabulary:

| Required state | Representable? | Evidence |
| --- | --- | --- |
| booting | **Yes** | `booting`; `src/ui/startup.tsx:119,168` |
| detecting | **Yes** | `detecting-runtime`/`detecting-hardware`/`detecting-models`; `:131-134,168-172` |
| validating | **Yes** | `validating-model` + `health-check`; `:135` |
| onboarding | **Yes** | `onboarding` branch with recommendation panel + actions; `:195-227` |
| downloading | **Yes** | `downloading-model` + `ProgressBar` with bytes/speed/ETA; `:83-102,132-134` |
| loading-model | **Yes** | `loading-model`; `:135` |
| ready | **Yes** | `:173,243-245` |
| error | **Yes**, two tiers | `recoverable-error` / `fatal-error`; `:128,228-240` |

**FACT — the state vocabulary is complete for the desired flow.** This is the
single strongest asset in the startup UI.

**FACT — but `fatal-error` is never produced.** Grep across `src/`: the only
producers of `StartupProgress.state` are `src/startup/orchestrator.ts` (emits
`booting`, `detecting-runtime`, `detecting-hardware`, `detecting-models`,
`recommending-model`, `onboarding`, `validating-model`, `preparing-runtime`,
`loading-model`, `health-check`, `ready`, `recoverable-error`) and
`src/index.ts` (`preparing-runtime`, `downloading-model`, `recoverable-error`).
`fatal-error` is only *consumed* (`src/ui/startup.tsx:128,230`). It is a
**declared-but-unreachable state**.

**FACT — three states are cosmetic.** `validating-model`, `preparing-runtime`
and `loading-model` are emitted consecutively at
`src/startup/orchestrator.ts:140,144,145` with **no awaited work between them**.
The real load already happened at `:120`. The user sees three flashes.

## 4. Loading / progress / error primitives that exist

| Primitive | Location | Notes |
| --- | --- | --- |
| `Stage` checklist row (`[ok]`/`[..]`/`[  ]`) | `src/ui/startup.tsx:72-81` | 4 fixed stages: Hardware, Local engine, Model, Readiness (`:166-173`) |
| `ProgressBar` (20-cell `#`/`-` bar + %, bytes, speed, ETA) | `:83-102` | Renders only when `percent` or `completed` is set (`:84`) |
| `StartupAction` (mouse-clickable + keyboard-labelled button) | `:44-70` | Supports `disabled` and `highlighted` |
| Hardware panel (GPU name, VRAM, RAM, model count) | `:180-194` | Shows "Scanning graphics acceleration…" during boot (`:119-121`), "CPU mode / no dedicated VRAM" otherwise (`:122`) |
| Recommendation panel | `:195-205` | Name, reason, estimated GB, "Downloaded from Hugging Face" |
| Error region | `:228-240` | Shows `progress.detail` or a generic fallback; `[r] Scan again` + `[esc] Exit` |
| Byte/speed formatters | `src/models/huggingface.ts:239-248` | Reused by the UI (`src/ui/startup.tsx:5,87-89`) |
| Elapsed formatter | `src/ui/startup.tsx:39-42` | `mm:ss` |

**FACT — the primitives needed for the desired UX already exist.** No rebuild
is warranted; what is missing is *content*, not components (see §7).

## 5. Input handling

**FACT.** Startup keys are handled **outside React**, by a raw listener on the
renderer: `renderer.keyInput.on("keypress", startupKeyHandler)`
(`src/index.ts:414`), removed in `renderApp` (`:193-196`) and in `onExit`
(`:111-114`).

Policy is isolated and unit-tested: `resolveStartupKeyAction`
(`src/ui/startup-input.ts:21-34`) — `escape`/`ctrl+c` → `exit` (always);
otherwise only actionable in `onboarding` or `recoverable-error`;
`Enter`/`Return`/`\r`/`\n` → `install` (onboarding + a recommendation exists);
`r` → `retry`. Tested by `src/ui/startup-input.test.ts` (3 cases).

Mouse: `StartupAction` handles `onMouseUp` with `event.button === 0`
(`src/ui/startup.tsx:63-65`). Both input paths reach the same callbacks.

**FACT — a UX inconsistency.** `resolveStartupKeyAction` maps `Enter` to
`install` only when `canInstall` (i.e. `Boolean(startupRecommendation)`,
`src/index.ts:409`), yet the button's *label* is chosen from a different
predicate — `canInstall` in `StartupScreen` means "a runtime exposes
`installModel`" (`src/index.ts:161`), and the label degrades to
`[ Enter ] Prepare engine` / `[ Enter ] Try again`
(`src/ui/startup.tsx:214-218`). Two different `canInstall` meanings share one
name across the boundary. **Confusing but not broken.**

## 6. Model & runtime status visibility

**In the startup screen:** GPU vendor/model + VRAM, RAM, and
`N local models detected` (`src/ui/startup.tsx:188-193`); stage checklist
(`:166-173`); current model/runtime are carried in `StartupProgress.model` /
`.runtime` (`src/startup/types.ts:27-28`) but **never rendered** — grep of
`src/ui/startup.tsx` shows no use of `progress.model` or `progress.runtime`.
**FACT — the orchestrator reports which model/runtime it is working on, and the
UI throws that information away.**

**In chat:** `agent.getModelInfo()` (`src/ui/app.tsx:804`) →
`provider.resolveModelRuntime(modelId).modelInfo`
(`src/agent/agent.ts:655-657`) → `LocalProviderAdapter.resolveModelRuntime`
(`src/runtimes/local-provider.ts:61-79`), which synthesises `ModelInfo` from the
`LocalModelCandidate`. `contextStats` (`src/ui/app.tsx:805`) drives the context
gauge. The model picker lists `startupConfig.localModels`
(`src/index.ts:204` → `toModelInfo`, `:420-435`).

**FACT — there is no runtime health indicator in the chat UI.** Nothing polls
`runtime.health()` after chat mounts; nothing shows "engine running/stopped".

## 7. What the UI cannot represent today

All **FACT**, by absence:

1. **Per-stage detail during discovery.** The `Stage` checklist is derived from
   coarse booleans (`runtimeReady = discovery.runtimes.length > 0`,
   `modelReady = discovery.models.length > 0`, `src/ui/startup.tsx:129-130`),
   not from the orchestrator's own state. The "Local engine" stage shows `[ok]`
   as soon as *any* adapter is in the list — including one whose binary is not
   installed, because `discoverLocalRuntimes` deliberately keeps installable
   runtimes visible (`src/runtimes/discovery.ts:101-107`). **The checklist can
   read "engine ready" when no engine binary exists.**
2. **Model choice during onboarding.** `ModelRecommendation` carries an
   `alternatives` array (`src/models/recommendation.ts:9,41,51,60,68`) that is
   populated on every path — and **never rendered**. Grep of
   `src/ui/startup.tsx`: no reference to `alternatives`. The user gets exactly
   one take-it-or-leave-it recommendation.
3. **Download cancellation.** `installAbort` exists (`src/index.ts:138,220`) and
   is aborted on exit (`:110`), but no key or button maps to "cancel this
   download" — `resolveStartupKeyAction` has no `cancel` action, and during
   `downloading-model` the state is not `actionable`
   (`src/ui/startup-input.ts:28`), so **`r` and `Enter` are inert and only
   `esc` works, which quits the whole app.**
4. **Which model / which runtime** — see §6.
5. **Multi-model listing at startup.** Only a count (`:193`).

## 8. Modal system & global state (chat side)

**FACT.** `src/ui/app.tsx` uses plain `useState` per modal; there is no modal
manager, router, or global store. Modals found: API key (`:645`), model picker
(`:2997-3005`, `:3720-3721`), MCP browse/editor, agents, schedule, update,
Telegram token, connect, BTW overlay, suggestion overlay. Visibility is
mirrored into refs (`showApiKeyModalRef`, `showModelPickerRef`, …) so the raw
keypress handler can consult them synchronously (`:3194`, `:2933`).

**INFERENCE (high):** integrating startup/onboarding *into* the chat shell later
(rather than as a separate pre-mount screen) is feasible with this pattern —
it would be another modal/overlay state — but the current per-modal `useState`
sprawl in a 5 902-line component is the main obstacle, not the renderer.

## 9. Verdict

| Aspect | Status |
| --- | --- |
| Startup screen exists and paints first | **IMPLEMENTED** |
| State vocabulary covers the desired flow | **IMPLEMENTED** |
| Progress/loading/error primitives | **IMPLEMENTED** |
| Keyboard + mouse actions | **IMPLEMENTED** (tested) |
| Stage checklist accuracy | **PARTIAL** — derived from wrong signals (`:129-130`) |
| Current model/runtime shown | **NOT FOUND** — data available, never rendered |
| Alternative model choice | **NOT FOUND** — data available, never rendered |
| Download cancel | **NOT FOUND** |
| `fatal-error` state | **PLACEHOLDER** — consumed, never produced |
| Runtime health in chat | **NOT FOUND** |
</content>
</invoke>
