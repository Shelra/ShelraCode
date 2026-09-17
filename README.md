# ShelraCode: a cloud-first terminal coding agent

[![CI](https://github.com/superagent-ai/grok-cli/actions/workflows/typecheck.yml/badge.svg)](https://github.com/superagent-ai/grok-cli/actions/workflows/typecheck.yml)
[![npm](https://img.shields.io/npm/v/shelra.svg)](https://www.npmjs.com/package/shelra)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.x-000000?logo=bun&logoColor=white)](https://bun.sh/)

ShelraCode preserves the OpenTUI terminal interaction model of its upstream
Grok CLI foundation while routing coding work through OpenRouter first. The
default route is OpenRouter Free, with dynamic model discovery, capability
filtering, budgets, tool execution, and verification in the real agent loop.
Local inference remains available as an explicit private/offline mode with
`--local`; it is not downloaded or started by the default cloud path.

[https://github.com/user-attachments/assets/7ca4f6df-50ca-4e9c-91b2-d4abad5c66cb](https://github.com/user-attachments/assets/7ca4f6df-50ca-4e9c-91b2-d4abad5c66cb)

---

## Install

```bash
bun install
```

**Alternative installs** (requires Bun on PATH):

```bash
bun add -g shelra
```

**Self-management** (script-installed only):

```bash
shelra update
shelra uninstall
shelra uninstall --dry-run
shelra uninstall --keep-config
```

**Build a portable local executable** (Windows, macOS, or Linux):

```bash
bun install
bun run build
```

The build produces both `dist/index.js` and a Bun standalone executable. On
Windows the executable is `dist/shelra.exe`; it is copied atomically to
`%USERPROFILE%\\.shelra\\bin\\shelra.exe`, the active version is recorded in
`%USERPROFILE%\\.shelra\\active.json`, and that directory is added to the
user PATH. Open a new terminal after the build, then run `shelra` from any
project directory. On macOS and Linux the equivalent user-level install
directory is `$XDG_BIN_HOME` or `~/.local/bin`.

To build artifacts without changing the user installation (CI or local
inspection), set `SHELRA_BUILD_SKIP_INSTALL=1` before running the same command.
`SHELRA_INSTALL_BIN` can be used to test or choose a different install
directory. The installer keeps the previous executable as
`shelra.exe.previous` (or `shelra.previous` on Unix) and never replaces the
active binary in place.

**Prerequisites:** Bun and a modern terminal emulator for the interactive OpenTUI experience. The normal `shelra` path uses OpenRouter Free after an OpenRouter API key is configured. Use `shelra auth openrouter <key>` or the in-app cloud setup. Headless `--prompt` mode does not depend on terminal UI support. Use `--local` for the managed local model and offline/private inference.

---

## Run it

**Interactive (default)** — launches the OpenTUI coding agent:

```bash
shelra
```

### Supported terminals

For the most reliable interactive OpenTUI experience, use a modern terminal emulator. We currently document and recommend:

- **WezTerm** (cross-platform)
- **Alacritty** (cross-platform)
- **Ghostty** (macOS and Linux)
- **Kitty** (macOS and Linux)

Other modern terminals may work, but these are the terminal apps we currently recommend and document for interactive use.

**Pick a project directory:**

```bash
shelra -d /path/to/your/repo
```

**Headless** — one prompt, then exit (scripts, CI, automation):

```bash
shelra --prompt "run the test suite and summarize failures"
shelra -p "show me package.json" --directory /path/to/project
shelra --prompt "refactor X" --max-tool-rounds 30
shelra --prompt "summarize the repo state" --format json
shelra --prompt "review the repo"
shelra --prompt "review the repo" --local
shelra --verify
```

`--batch-api` remains available only for compatibility providers that expose a
batch endpoint. Local runtimes use the normal streaming path.

**Continue a saved session:**

```bash
shelra --session latest
shelra -s <session-id>
```

Works in interactive mode too—same flag.

**Structured headless output:**

```bash
shelra --prompt "summarize the repo state" --format json
```

`--format json` emits a newline-delimited JSON event stream instead of the
default human-readable text output. Events are semantic, step-level records such
as `step_start`, `text`, `tool_use`, `step_finish`, and `error`.

**Autonomous objective with a visible executable plan:**

```bash
shelra --autonomous --prompt "Create a responsive digital clock website"
shelra objectives
shelra objectives latest
shelra objectives <id> --json
```

An autonomous run prints the complete contract before changing files:

- `[SPECIFICATION]`: original goal, derived requirements, and required/optional
  acceptance criteria, including the concrete check Shelra must execute.
- `[PLAN]`: ordered tasks and the acceptance-criterion IDs each task advances.
- `[TASK]`: live task status and attempt count.
- `Verification`: observed pass/fail evidence for every criterion.

The same data is persisted under `.shelra/objectives/<id>/`, so the plan and its
evidence remain inspectable after the process exits. Autonomous `--format json`
uses structured `specification`, `plan`, `task`, `verification`, and `complete`
events rather than reducing the plan to prose or counters.

The normal interactive Agent mode also exposes `generate_plan`. For work that
spans several files or acceptance conditions the agent publishes the goal,
requirements, acceptance criteria, verification methods, and task-to-criterion
mapping before editing; a one-file, obvious change may skip it. What the host
enforces is verification, not planning: a turn that changed files but ran no
real check (tests, build, type-check, a request against the running app) is
asked to verify before it may complete, and is marked "Not verified" if it
never does. The existing Plan-mode view renders the same fields; plans without
questions are retained when switching from Plan to Agent mode.
Autonomous mode begins executing after publishing its plan; use `Ctrl+C` to
cancel. An explicit `--sandbox` autonomous run is currently refused instead of
pretending that host execution is sandboxed.

### Computer sub-agent

ShelraCode ships a built-in `computer` sub-agent backed by [agent-desktop](https://github.com/lahfir/agent-desktop) for host desktop automation on macOS.

Ask for it in natural language, for example:

```bash
shelra "Use the computer sub-agent to take a screenshot of my host desktop and tell me what is open."
shelra "Use the computer sub-agent to launch Google Chrome, snapshot the UI, and tell me which refs correspond to the address bar and tabs."
```

Notes:

- Screenshots are saved under `.shelra/computer/` by default.
- The primary workflow is **snapshot -> refs -> action -> snapshot** using `agent-desktop` accessibility snapshots and stable refs like `@e1`.
- `computer_screenshot` is available for visual confirmation, but the preferred path is `computer_snapshot` plus ref-based actions such as `computer_click`, `computer_type`, and `computer_scroll`.
- macOS requires **System Settings → Privacy & Security → Accessibility** access for the terminal app running `shelra`.
- `agent-desktop` currently targets **macOS**.
- If Bun blocks the native binary download during install, run:

```bash
node ./node_modules/agent-desktop/scripts/postinstall.js
```

### Scheduling

Schedules let ShelraCode run a headless prompt on a recurring schedule or once. Ask
for it in natural language, for example:

```text
Create a schedule named daily-changelog-update that runs every weekday at 9am
and updates CHANGELOG.md from the latest merged commits.
```

Recurring schedules require the background daemon:

```bash
shelra daemon --background
```

Use `/schedule` in the TUI to browse saved schedules. One-time schedules start
immediately in the background; recurring schedules keep running as long as the
daemon is active.

**Inspect the live OpenRouter catalog and the secondary local catalog:**

```bash
shelra models
```

**Pass an opening message without another prompt:**

```bash
shelra fix the flaky test in src/foo.test.ts
```

**Generate images or short videos from chat:**

```bash
shelra "Generate a retro-futuristic logo for my CLI called ShelraCode"
shelra "Edit ./assets/hero.png into a watercolor poster"
shelra "Animate ./assets/cover.jpg into a 6 second cinematic push-in"
```

Image and video generation remain optional compatibility tools. They are exposed
only when the selected provider advertises those capabilities; local runtimes
otherwise receive a clear unavailable result. Generated media uses the existing
`.grok/generated-media/` compatibility path until that subsystem is replaced.

---

## What you actually get

ShelraCode is cloud-first by default. `shelra models` discovers and prints the
OpenRouter catalog first, then shows managed local models as a secondary
catalog. The default routing policy is Free; use `--model-policy auto` (or a
paid policy) only when paid routing is allowed by the configured budget. Use
`--local` to opt into the managed local runtime. Search and media tools are
capability-gated, while the built-in web research tools are provider-neutral.

### Legacy feature compatibility matrix

The inherited table below lists capabilities that remain available only when an
adapter implements them. It is retained to document the existing Grok CLI
surface while each capability is being replaced or removed.


| Thing | What it means |
| --- | --- |
| **OpenRouter first** | Discovers the live cloud catalog, routes to capable Free models by default, and keeps local inference available through `--local`. |
| **Persistent project memory** | Every turn retrieves the project memory under `.shelra/memory/` ranked against the request (lexical, no embeddings) and injects the relevant entries; after a turn that changed and verified files or worked through a failure, one bounded reflection call proposes durable facts and a deterministic write gate admits, merges, or rejects them (no secrets, no instruction-shaped text, human statements never overwritten by inferences). Standing rules the user states are captured directly; procedures used repeatedly become `.agents/skills`. See `docs/design/shelra-memory-engine.md`. |
| **Web research** | The agent uses `search_web` plus `open_web` when a task depends on an external library, API, or protocol; nothing is fetched for turns that do not need it. Results are treated as untrusted leads and the agent is instructed to verify them. |
| **X + web search** | `search_x` remains provider-specific; `search_web` and `open_web` are provider-neutral and available to the real agent loop. |
| **Media generation** | `generate_image` and `generate_video` tools for text-to-image, image editing, text-to-video, and image-to-video. Capability-gated; generated files are saved locally under `.grok/generated-media/` (compatibility path). |
| **Sub-agents (default behavior)** | Foreground `task` delegation (explore, plan, general, vision, verify, or computer) plus background `delegate` for read-only deep dives. Every delegated task follows intent -> context -> plan -> verify -> deliver: gather context before acting, plan non-trivial changes (directly or via `plan`), and verify results before reporting done. |
| **Verify** | `/verify` or `--verify` — inspects your app, builds, tests, boots it, and runs browser smoke checks in a sandboxed environment. Screenshots and video included. |
| **Computer use** | Built-in `computer` sub-agent for host desktop automation via `agent-desktop` (macOS). Prefers semantic accessibility snapshots and stable refs; screenshots saved under `.shelra/computer/`. |
| **Custom sub-agents** | Define named agents with `subAgents` in `~/.shelra/user-settings.json` and manage them from the TUI with `/agents`. |
| **Remote control** | Pair **Telegram** from the TUI (`/remote-control` → Telegram): DM your bot, `/pair`, approve the code in-terminal. Keep the CLI running while you ping it from your phone. |
| **OpenTUI React terminal UI** | Fast, keyboard-driven terminal rendering. |
| **Skills** | Agent Skills under `.agents/skills/<name>/SKILL.md` (project) or `~/.agents/skills/` (user). Use `/skills` in the TUI to list what's installed. |
| **MCPs** | Extend with Model Context Protocol servers — configure via `/mcps` in the TUI or `.shelra/settings.json` (`mcpServers`). |
| **Sessions** | Conversations persist; `--session latest` picks up where you left off. |
| **Headless** | `--prompt` / `-p` for non-interactive runs — pipe it, script it, bench it. |
| **Hackable** | TypeScript, a clear agent loop, and typed tools — fork it. |

### Shelra Bench

Shelra Bench is the persistent development benchmark for improving Shelra as
an autonomous coding agent. It evaluates the harness across real task
execution, technical correctness, intent fidelity, and self-verification. The
model and provider are recorded controlled variables; this is not primarily a
model leaderboard.

Every invocation creates a new immutable historical run, persists task
progress incrementally, and keeps failed or interrupted runs visible. The
primary leaderboard accepts only explicitly eligible completed runs with real
scores. Diagnostic fixtures never create production entries.

Technical documentation:

- [Shelra Bench technical reference](docs/design/shelra-bench-reference.md)
- [Shelra Bench UI design](docs/design/shelra-bench-ui.md)
- [Shelra Bench task ladder](bench/README.md)

Run the current real suite with a fixed model when measuring a Shelra change:

~~~text
bun run src/index.ts bench \
  --manifest bench/suites/shelra-agent-core-v0.2.json \
  --model <fixed-model>
~~~

The POSIX wrapper is:

~~~text
./shelra-bench.sh --manifest bench/suites/shelra-agent-core-v0.2.json --model <fixed-model>
~~~

Open the persistent HTML registry locally with:

~~~text
bun run bench:dashboard
open http://127.0.0.1:4173
~~~

### Coming soon

**More Shelra Bench coverage** — dedicated memory, session-resume, research,
repeated-run statistics, and richer evidence protocols.

---

## Cloud runtime and secondary local mode

OpenRouter is the primary runtime. Configure it once:

```bash
shelra auth openrouter <your-key>
```

The normal `shelra` startup opens the cloud-first screen and loads OpenRouter
Free models. It does not ask a workspace-trust/sandbox question and it does
not download a local model. `--sandbox` is an explicit execution option; the
default is host execution.

For private or offline work, opt into the managed local runtime explicitly:

```bash
shelra --local
```

`setup` remains available for local-runtime diagnostics. An explicitly managed
OpenAI-compatible local endpoint can be supplied when integrating an existing
private runtime:

```bash
export SHELRA_LOCAL_ENDPOINT=http://127.0.0.1:8080/v1
```

With `--local`, ShelraCode scans hardware, discovers cached local artifacts,
selects the best fit, prepares its loopback engine, and runs a real health
check before opening chat. On first local run it can download the recommended
GGUF from Hugging Face with resumable progress, verify it, start the managed
engine, and continue into chat.

`**.env**` in the project (see `.env.example` if present):

```bash
SHELRA_API_KEY=your_key_here
SHELRA_BASE_URL=https://provider.example/v1
SHELRA_MODEL=provider-model
OPENROUTER_API_KEY=sk-or-v1-...
```

**CLI once:**

```bash
shelra -k your_openrouter_key_here
```

For OpenRouter, Shelra uses `https://openrouter.ai/api/v1` automatically when
`OPENROUTER_API_KEY` is configured. Use `--model-policy auto` or
`--model-policy economy` to permit paid routing; the default `free` policy
never selects a paid model silently. `shelra models` reads the live catalog
with a six-hour cache, and `shelra models use openrouter/provider/model` saves
an explicit selection.

Cost controls run before a model request is sent:
`--max-cost <usd>` limits cumulative spend for the session and
`--max-request-cost <usd>` limits one request. The same controls are available
through `SHELRA_MAX_SESSION_COST_USD` and `SHELRA_MAX_REQUEST_COST_USD`; a
value of `0` permits only requests whose catalog estimate is free.

The implemented provider/catalog design and known limitations are documented
in [`docs/architecture/OPENROUTER-RUNTIME.md`](docs/architecture/OPENROUTER-RUNTIME.md).

Model turns have bounded waiting by default so a provider or local runtime that
stops emitting data cannot leave the chat apparently frozen forever: 15 minutes
per complete turn, 5 minutes per model step, and 90 seconds between streamed
chunks. MCP discovery is bounded to 20 seconds. Override these millisecond
values with `SHELRA_MODEL_TIMEOUT_MS`, `SHELRA_MODEL_STEP_TIMEOUT_MS`,
`SHELRA_MODEL_IDLE_TIMEOUT_MS`, or `SHELRA_MCP_TIMEOUT_MS` when a slower local
model needs more time. The UI reports the current stage (context, research,
MCP, model, or recap) while waiting.

**Saved in user settings** — `~/.shelra/user-settings.json`:

```json
{ "defaultModel": "openrouter/openai/gpt-4o-mini" }
```

Store an OpenRouter key with `shelra auth openrouter <key>` or use
`OPENROUTER_API_KEY`; keys are kept in `~/.shelra/auth.json`, never in this
JSON file or in source control.

Optional `**subAgents**` — custom foreground sub-agents. Each entry needs `**name**`, `**model**`, and `**instruction**`:

```json
{
  "subAgents": [
    {
      "name": "security-review",
      "model": "qwen2.5-coder:7b",
      "instruction": "Prioritize security implications and suggest concrete fixes."
    }
  ]
}
```

Names cannot be `general`, `explore`, `plan`, `vision`, `verify`, `verify-detect`, `verify-manifest`, or `computer` because those are reserved for the built-in sub-agents.

The legacy `GROK_*` environment variables and `~/.grok` settings are read only
for migration. New settings and state are written under `~/.shelra`.

---

## Telegram (remote control) — short version

1. Create a bot with [@BotFather](https://t.me/BotFather), copy the token.
2. Set `**TELEGRAM_BOT_TOKEN**` or add `**telegram.botToken**` in `~/.shelra/user-settings.json` (the TUI `**/remote-control**` flow can save it).
3. Start `shelra`, open `/remote-control` → **Telegram** if needed, then in Telegram DM your bot: `/pair`, enter the **6-character code** in the terminal when asked.
4. First user must be approved once; after that, it’s remembered. **Keep the CLI process running** while you use the bot (long polling lives in that process).

### Voice & audio messages

Send a voice note or audio attachment in Telegram and ShelraCode will transcribe it before passing the text to the agent. Transcription is **capability-gated**: it uses the xAI Speech-to-Text endpoint (`POST https://api.x.ai/v1/stt`) and therefore requires a configured remote provider. The endpoint accepts Telegram's OGG/Opus voice notes and common audio containers (MP3, WAV, M4A, FLAC, AAC) directly — no local model download, `whisper-cli`, or `ffmpeg` required.

#### Prerequisites

- A remote provider key (`SHELRA_API_KEY` / `SHELRA_BASE_URL`, or legacy `GROK_API_KEY`). Transcription reuses the CLI's `apiKey` / `baseURL` resolution. In local-only mode (no remote provider), voice messages are not transcribed.

#### Configure in `~/.shelra/user-settings.json`

```json
{
  "telegram": {
    "botToken": "YOUR_BOT_TOKEN",
    "audioInput": {
      "enabled": true,
      "language": "en"
    }
  }
}
```


| Setting    | Default | Description                                                                                                           |
| ---------- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| `enabled`  | `true`  | Set to `false` to ignore voice/audio messages entirely.                                                               |
| `language` | `en`    | Language code forwarded to `/v1/stt`. Enables Inverse Text Normalization (numbers, currencies, units → written form). |


Optional headless flow when you do not want the TUI open:

```bash
shelra telegram-bridge
```

Treat the bot token like a password.

---

## Hooks

Hooks execute shell commands at key agent lifecycle events — enforce policies, run linters, trigger tests, or log activity.

Configure in `~/.shelra/user-settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "bash",
        "hooks": [
          {
            "type": "command",
            "command": "./scripts/lint-before-edit.sh",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

Hook commands receive JSON on **stdin** (event details) and can return JSON on **stdout**. Exit code `0` = success, `2` = block the action, other = non-blocking error.

**Supported events:** `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `UserPromptSubmit`, `SessionStart`, `SessionEnd`, `Stop`, `StopFailure`, `SubagentStart`, `SubagentStop`, `TaskCreated`, `TaskCompleted`, `PreCompact`, `PostCompact`, `Notification`, `InstructionsLoaded`, `CwdChanged`.

---

## Instructions & project brain

- `**AGENTS.md`** — merged from git root down to your cwd (Codex-style; see repo docs). `**AGENTS.override.md**` wins per directory when present.

---

## Project settings

Project file: `**.shelra/settings.json**` — e.g. the current model for this project.

---

## Sandbox

ShelraCode can run shell commands inside a [Shuru](https://github.com/superhq-ai/shuru) microVM sandbox so the agent can't touch your host filesystem or network.

**Requires macOS 14+ on Apple Silicon.**

Enable it with `--sandbox` on the CLI, or toggle it from the TUI with `/sandbox`.

ShelraCode does not ask a workspace-trust question on startup. Host execution
is the default. Enable the microVM explicitly with `--sandbox`, or select it
from the TUI with `/sandbox`; use `--no-sandbox` to make host execution
explicit. The stored workspace-trust file is not consulted by the startup path.

When sandbox mode is active you can configure:

- **Network** — off by default; enable with `--allow-net`, restrict with `--allow-host`
- **Port forwards** — `--port 8080:80`
- **Resource limits** — CPUs, memory, disk size (via settings or `/sandbox` panel)
- **Checkpoints** — start from a saved environment snapshot
- **Secrets** — inject API keys without exposing them inside the VM

Non-secret preferences are saved in `~/.shelra/user-settings.json` (user) and
`.shelra/settings.json` (project). OpenRouter credentials are stored separately
in `~/.shelra/auth.json` with restrictive permissions; legacy `.grok` settings
remain readable during migration.

### Verify

Run `**/verify`** in the TUI or `**--verify`** on the CLI to verify your app locally:

```bash
shelra --verify
shelra -d /path/to/your/app --verify
```

The agent inspects your project, figures out how to build and run it, spins up a sandbox, and produces a verification report with screenshots and video evidence. Works with any app type.

---

## Troubleshooting

Common issues and solutions:

### Installation issues

**Install script fails on macOS**

Make sure you have a modern shell and `curl` available:

```bash
# Verify curl is installed
which curl

# If using an outdated shell, try with bash explicitly
bash -c "$(curl -fsSL https://raw.githubusercontent.com/superagent-ai/grok-cli/main/install.sh)"
```

**Bun not found**

The install script bundles Bun, but if you want to use your own:

```bash
curl -fsSL https://bun.sh/install | bash
bun add -g shelra
```

### API key issues

**OpenRouter models are missing**

Run `shelra models --refresh` after configuring `shelra auth openrouter <key>`
or `OPENROUTER_API_KEY`. The catalog is fetched dynamically and cached under
`~/.shelra/catalog/openrouter.json`; use `shelra models --json` to inspect the
normalized entries. If cloud access is unavailable, use `shelra --local`.

**"No local model is ready" error**

Use `shelra --local` and accept the recommended model. Shelra will download
the engine and GGUF into `~/.shelra`, verify both, and start a loopback server.
For an explicit remote compatibility endpoint:

```bash
# Environment variables
export SHELRA_API_KEY=your_key_here
export SHELRA_BASE_URL=https://provider.example/v1

# Or pass them for one run
shelra --remote --api-key your_key_here --base-url https://provider.example/v1
```

The legacy `GROK_API_KEY` and `~/.grok` settings are accepted only for
compatibility. Cloud mode requires an OpenRouter key; local mode does not.

### Terminal UI issues

**UI doesn't render correctly**

Try a different terminal emulator. Recommended:

- WezTerm (cross-platform)
- Alacritty (cross-platform)
- Ghostty (macOS/Linux)
- Kitty (macOS/Linux)

**Screen flickering or artifacts**

Ensure your terminal supports true color and Unicode. Update your terminal emulator to the latest version.

### Telegram remote control

**Bot doesn't respond**

1. Verify `TELEGRAM_BOT_TOKEN` is set correctly
2. Ensure the CLI process is still running (long polling lives in the process)
3. Check that you've completed the `/pair` flow and been approved

**Voice messages not transcribing**

- Verify `SHELRA_API_KEY` and `SHELRA_BASE_URL` are set for the selected remote
  compatibility STT endpoint
- Check `~/.shelra/user-settings.json` has `telegram.audioInput.enabled: true`

### Sandbox mode

**Sandbox only works on macOS 14+ with Apple Silicon**

If you're on Intel Mac or Linux, sandbox mode is not available. Use standard mode without `--sandbox`.

### Performance issues

**Slow response times**

- Check the selected cloud/local catalogs with `shelra models --json`
- Choose a smaller local model when memory is constrained
- Reduce `--max-tool-rounds` for headless runs
- If the status remains on `Waiting for <model>`, the bounded model timeout
  will cancel a stalled request and show the provider error instead of waiting
  indefinitely. Increase `SHELRA_MODEL_IDLE_TIMEOUT_MS` only for a demonstrably
  slow model that is still producing progress.
- If it remains on `Connecting configured MCP tools`, inspect or disable the
  configured MCP server; discovery is capped by `SHELRA_MCP_TIMEOUT_MS`.

**High memory usage**

- Long-running sessions accumulate context; start a fresh session periodically
- Use `/compact` in TUI to compress conversation history

### Getting help

- Check existing [issues](https://github.com/superagent-ai/grok-cli/issues)
- Open a new issue with:
  - OS and terminal emulator version
  - ShelraCode version (`shelra --version`)
  - Steps to reproduce
  - Error messages or logs

---

## Development

From a clone:

```bash
bun install
bun run build
bun run start
# or: bun dist/index.js
```

Other useful commands:

```bash
bun run dev      # run from source (Bun)
bun run typecheck
bun run lint
```

---

## Trademarks

"Grok" is a registered trademark of xAI Corp. This project is not affiliated with, endorsed by, or sponsored by xAI Corp. All trademarks belong to their respective owners.

---

## License

MIT
