# 24 — Extensions: instructions, skills, agents, hooks and the custom system prompt

Status: built and tested on the live path, 2026-10-07. Code: `src/extend/`, `src/hooks/`, wiring in `src/agent/agent.ts`,
`src/agent/prompts.ts`, `src/toolset/tools.ts`, `src/index.ts`, `src/ui/`. Examples that the tests load:
`docs/examples/extensions/`. Measurements: `scripts/perf/extensions-bench.ts`. A run with a real model:
`scripts/extensions-e2e.ts`.

The aim: a person can ask Shelra, in their own words, to look at what agents and skills exist, create or change them, run
them, add a hook, or put a convention in SHELRA.md, and each of those produces a real file, a real invocation or a real
registration that was read back, which survives a restart. Nothing is reported as done on the model's word.

## 1. What was taken from Claude Code's public documentation, what was adapted, what is not built

Sources read on 2026-10-06: `code.claude.com/docs/en/{features-overview,sub-agents,skills,hooks,memory,cli-reference}`,
`agentskills.io/{specification,integrate-skills}`. Nothing below is attributed to Claude Code that was not read there.

| Behavior | Reference says | Here |
| --- | --- | --- |
| Skills load in three steps (catalog, body, resources) | agentskills.io, skills doc | **Taken.** `<available_skills>` catalog, body on `skill`, resources on demand. |
| A skill can be hidden from the model, user-only, or background-only | `disable-model-invocation`, `user-invocable` | **Taken**, read as `shelra-invocation: explicit` and `userInvocable`. |
| Skill arguments (`$ARGUMENTS`, `$0`, `$name`) | skills doc | **Taken**, validated; values are never re-expanded. |
| A skill can run in a subagent (`context: fork`) | skills doc | **Adapted**: `shelra-context: agent` + `shelra-agent`, run through the same delegation as `task`. |
| `allowed-tools` pre-approves tools | skills doc | **Not taken as a grant.** Recorded and shown; it never widens anyone's permissions. |
| `` !`command` `` injected into a skill before the model sees it | skills doc | **Not built.** The command would run before any permission decision; such skills are read with the text as written and the compat matrix says so. |
| Subagent = Markdown + front matter, `tools`, `disallowedTools`, `skills`, `maxTurns`, `permissionMode: plan` | sub-agents doc | **Taken**, with Shelra's names (`tools`, `disallowed-tools`, `skills`, `max-steps`, `access: read-only`). |
| Subagent `model` | sub-agents doc | **Adapted.** Honoured in Mixed mode only; Free mode runs the session's model (a definition must not reach a model the session could not). |
| Subagents cannot start subagents unless allowed | sub-agents doc | **Stricter.** No agent can start another here (the child tool set has no `task`/`delegate`). |
| `isolation: worktree`, `mcpServers`, `hooks` in an agent file | sub-agents doc | **Rejected at import with a diagnostic** (see §9); not silently ignored. |
| Hooks on lifecycle events; exit 2 blocks where the event can block; JSON `permissionDecision` | hooks doc | **Taken** for command hooks. Only `PreToolUse`, `UserPromptSubmit` and `Stop` can block here, because those are the events the runtime waits for and obeys. |
| Hook types `http`, `prompt`, `agent`, `mcp_tool` | hooks doc | **Not built.** A hook that asks a model would be a probabilistic control presented as a rule; `http` and `mcp_tool` are not needed yet. They are rejected, never ignored. |
| Project hooks run when the repository is trusted | hooks doc | **Stricter.** Project and local hooks are proposals; what runs is the snapshot the person approved (§6). |
| CLAUDE.md layers, `@path` imports (5 levels), path-scoped rules, "context, not enforced configuration" | memory doc | **Taken** for SHELRA.md (§4), imports 4 levels, and the same honest framing. |
| `--append-system-prompt[-file]` keeps the base prompt; `--system-prompt[-file]` replaces it whole | cli-reference | **Mapped, and narrower.** The replacing flag swaps only the role paragraph; the operating rules and everything the host enforces stay (§4). |

Not built (said once, here, so the rest of this document does not have to repeat it): running the whole session as an agent
(`--agent`), background agents other than the existing read-only `delegate`, plugins and marketplaces, managed/enterprise
settings, skills discovered in nested folders below the working folder or in `--add-dir` folders, a per-run token or cost cap
(steps and minutes are capped; the session's spend limits apply to agents as before), and a dedicated TUI panel for hook runs.

## 2. Architecture

```
request → resolution → permissions → execution → persistence → events → interface → result

Instructions   src/extend/instructions.ts  SHELRA.md, rules, local, imports       → system prompt each turn
System prompt  src/extend/system-prompt.ts append / role file / profile / flags   → system prompt each turn
Skills         src/extend/skills.ts        index, select, load, write             → `skill` tool, /<name>, catalog
Agents         src/extend/agents.ts        registry, resolve (snapshot), write    → `task` tool, run records
Hooks          src/hooks/ + hooks-admin    resolve, trust, execute, record        → hardenToolSet, Agent events
Tools (model)  src/extend/tools.ts         skill · extensions · extension_write
Commands       src/extend/commands.ts      /skills /agents /hooks /instructions /prompt /doctor, shelra <same>
Broker         src/toolset/tools.ts        hardenToolSet: the one place every tool executes (hooks run here)
Policy         src/extend/policy.ts        narrowing + guards applied at the broker for each run
Records        src/extend/runs.ts, trust.ts, store.ts
```

One broker. A delegated agent is not a second engine: it runs `Agent.runTaskRequest` (retries, fallbacks, budgets, Free-mode
guard, hooks) with a tool set that `applyPolicy` narrows. Skills, agents, hooks and instructions never call a model: they are
files, scripts and text (`src/extend/architecture.test.ts` pins that no module in `src/extend` or `src/hooks` imports a
provider, calls a model SDK function or opens a connection). Every model call stays behind the provider guard that already
enforces Free mode (`docs/architecture/22-PROVIDER-ROUTING.md`).

## 3. Files and precedence

| Kind | Project | Local (not in git) | User |
| --- | --- | --- | --- |
| Instructions | `SHELRA.md` (alias `Shelra.md`), `AGENTS.md`, `.shelra/rules/*.md` | `.shelra/SHELRA.local.md` | `~/.shelra/SHELRA.md`, `~/.shelra/rules/` |
| Skills | `.shelra/skills/<name>/SKILL.md` | — | `~/.shelra/skills/` |
| Agents | `.shelra/agents/<name>.md` | — | `~/.shelra/agents/`, and the older `subAgents` in `user-settings.json` |
| Hooks | `.shelra/settings.json` (proposal) | `.shelra/settings.local.json` (proposal) | `~/.shelra/user-settings.json` |
| Settings | `.shelra/settings.json` | `.shelra/settings.local.json` | `~/.shelra/user-settings.json` |
| Custom prompt | `systemPrompt` in settings, `.shelra/prompts/<name>.md` | same | same |
| History of edits | `.shelra/history/<kind>s/<name>/` | | `~/.shelra/history/` |

Read-only compatibility: `.agents/skills`, `.claude/skills`, `.claude/agents`, `.claude/rules`, `CLAUDE.md`, `.claude/settings.json`
(§9). The user folder is `~/.shelra` (the `HOME` the process runs under; the benchmark clean room moves it, and every cache here
is keyed by it).

Precedence is decided per kind, and "the last file wins" is not one of the rules:

- **Instructions** are additive, general to specific: user → user rules → project chain from the git root to the working folder
  (in each folder `AGENTS.md`, then `SHELRA.md`; `AGENTS.override.md` replaces that folder's `AGENTS.md`; `CLAUDE.md` only when
  the folder has neither) → project rules → local → path-scoped rules whose globs match the files the request names. A later source
  refines an earlier one. Nothing in them can grant a permission or turn off a check: they are prompt text, and the checks do not read it.
- **Skills and agents** override by name: project over user; inside a scope `.shelra` over `.agents` over `.claude`; the nearest
  project folder first. The registry lists what a name shadows.
- **Overrides** (`skillOverrides`, `agentOverrides`): the more restrictive of project and user wins; the local file may relax either
  (it is the person's own). A model can restrict, and can lift only a restriction in the local file.
- **Hooks** merge: every active hook for an event runs, user then project then local, a hook defined twice runs once.
- **Permissions** are never set by a file. `allowed-tools` is informational, a hook's `permissionDecision: allow` is recorded and
  ignored, and an agent's `tools` can only narrow what the run would have had.
- **`disableAllHooks`** counts only in the user's own settings (a file an agent can write must not switch every hook off).
- **`instructionExcludes`** counts only from user and local settings (a repository must not hide the person's own rules).

## 4. Instructions and the custom system prompt

`loadInstructionSet(cwd, {paths})` rebuilds the instructions from their files every time a prompt is built (cost: ~0.4 ms), never
from a summary, so a restart, a recovery or a compaction cannot lose them. It returns the text, each source with path, kind,
scope, hash, bytes, order and why it is there, and the diagnostics: an alias present twice, an override that hides an `AGENTS.md`,
an import that is missing, too deep, too large, a cycle or outside the project, an exclusion, a secret-looking string.
`/instructions`, `shelra instructions` and `extensions({action:"instructions"})` print that explanation. `@path/file.md` imports
(Markdown or text only; 4 levels; 64 KB per file; inside the project, or the user folder for user files; a file already loaded is not
loaded again; code blocks and inline code are not scanned).

Updating by natural language: `extension_write({kind:"instructions", target, section, content, mode})` edits the right file
atomically, keeps the previous version, adds `.shelra/SHELRA.local.md` to `.gitignore`, then **reloads the effective set from the
files and reports `verified: true` only if the new text is in it**. It applies from the next turn (the current turn's prompt was
already built); a sub-agent launched afterwards reads it; a new session reads the file again. The result says so.

The custom prompt (`--append-system-prompt`, `--append-system-prompt-file`, `--system-prompt-file`, `--profile`, settings
`systemPrompt.{append,appendFile,file,profile}`, files in `.shelra/prompts/`): appended text goes after the base prompt in
general-to-specific order. A replacement file swaps **only the opening role paragraph**; the environment, how-to-work, standards and
tool guidance stay. It cannot touch permissions because nothing that enforces them reads the prompt (the broker's policy, the
read-only guard, hooks, the completion gate, Free mode). Flags are fixed for the process (and checked at start: a missing file is an
error at the command line); settings and files are re-read every turn. `/prompt` shows what is in force and says all this.

## 5. Skills

Lifecycle: discover → validate → register → select → load → apply → verify → record.

- **Format**: the open standard (`name` ≤ 64 lowercase/digits/hyphens matching the folder, `description` ≤ 1024, optional `license`,
  `compatibility` ≤ 500, `metadata`, `allowed-tools`), plus `scripts/`, `references/`, `assets/`. Shelra's switches live in
  `metadata` as `shelra-*` keys (`shelra-invocation: auto|explicit`, `shelra-arguments`, `shelra-requires`, `shelra-context`,
  `shelra-agent`, `shelra-keywords`, `shelra-status: candidate`, `shelra-provenance`, `shelra-version`), so a skill stays valid
  everywhere. The fields other agents use for the same things are read too (see §9).
- **Index**: built from the first 18 KB of each `SKILL.md` and cached per (root, user folder); revalidated once per turn by
  asynchronous stats; invalidated by Shelra's own writes. Problems are listed (`/doctor`), not thrown. At most 2000 folders.
- **Selection**: lexical, in both languages (`src/memory/terms.ts`), over an inverted index (0.3 ms for 500 skills). A skill is
  suggested only when two of its terms are in the request, or one that is also in its name. Measured on a realistic bilingual
  catalog (14 skills, 36 requests, `selection-benchmark.test.ts`): right skill among the top 3 in 19 of 20 requests, **silent on
  all 16 requests that need no skill**. Selection never calls a model.
- **Catalog in the prompt**: bounded (≤ 3 000 characters): small catalogs are listed, large ones show the skills that match the
  request and say how to search the rest. 500 skills: 152 806 characters before, 528 now.
- **Invocation**: the `skill` tool (model), `/<skill> args` (person; expanded inside `Agent.runTurn`, so TUI, headless and Telegram
  share it; memory sees only what the person typed). `explicit` skills load only when the user named them. Missing arguments,
  missing programs (`shelra-requires`) and unreviewed text are reported in the result, not hidden. A skill with
  `shelra-context: agent` runs through that agent and says so. Loading never completes the procedure.
- **Writing**: `extension_write` and `/skills`: validated (name rules, secrets refused, injection-shaped text warned), written
  atomically under a cross-process lock, versioned in `.shelra/history/`, refused when `expected_hash` is stale, then registered
  without a restart. Skills promoted from memory arrive as `candidate`: never selected on their own until a person runs
  `/skills promote`.
- **Compaction**: the prompt of each turn lists the skills loaded earlier in the session with their versions (from a record, not a
  summary) and says to load one again if its text is gone.

## 6. Agents and delegation

An agent definition is instructions plus a tool policy, skills and limits, resolved into a **snapshot at launch**: editing the file
changes the next launch, never a run in progress, and never widens one. The orchestrator keeps the result: a delegated agent's
report is to be read as evidence to check, and the prompt it gets asks for verified facts, hypotheses, changes made and work left, apart.

- **Tools**: `tools` (names or groups `read write shell web memory skills`) and `disallowed-tools` only narrow. `access: read-only`
  removes everything but reading, and the shell is gated by `classifyReadOnlyShell`: deny by default, every simple command on a
  short list, no redirection, no substitution, no grouping or brace expansion, no assignments, no interpreters, `git` only
  with read subcommands and `--no-ext-diff --no-textconv` where a repository's config could run a program. It also applies to the
  built-in `explore`, `plan` and `verify-detect` agents, whose shell used to be limited only by their prompt. The text classifier
  is the layer that holds everywhere; where the Shuru sandbox exists it is the stronger boundary.
- **Context**: the child gets the delegated brief, the project's instructions (the same loader), the memory ranked against the
  brief and its preloaded skills; not the conversation.
- **Limits**: `max-steps` (≤ 200), `timeout-minutes` (≤ 120) enforced; at most 3 runs at once (`SHELRA_MAX_PARALLEL_AGENTS`),
  the rest wait; the session's spend limits and budget checks apply. No agent can start an agent.
- **Parallel writes**: the first agent to write a file holds it until it ends; another agent's write to it, and the main agent's, is
  refused naming the holder. Writes by shell are not tracked (said, not hidden).
- **Records** (`~/.shelra/agent-runs/<project>/<run>.json`): id, parent session, agent and definition version, task, skills, the
  tools it ended up with, read-only or not, model, limits, status (running, completed, failed, cancelled, interrupted), files
  changed, evidence, result excerpt. A run whose process is gone reads as `interrupted`. A cancelled or failed run's result lists the
  files it had already changed and says not to redo them. `/agents runs`, `extensions({action:"runs"})`.
- **Model**: in Free mode the session's model, whatever the file names (and the run record says so); in Mixed the file's model.

## 7. Hooks

Events (`src/hooks/types.ts`): `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `SubagentStart`,
`SubagentStop`, `PreCompact`, `PostCompact`, `Stop`, `StopFailure`, `SessionEnd`, `TaskCreated`, `TaskCompleted`, `Notification`,
`InstructionsLoaded`, `CwdChanged`, plus Shelra's own `SkillActivated` and `ExtensionChanged`. **Where the runtime waits and
obeys** (`PreToolUse` at the broker, `UserPromptSubmit` before any model call, `Stop` before a turn counts as finished) a hook can
prevent; everywhere else a hook observes, an exit code of 2 is an ordinary failure, and the run log says `observed`, never
`prevented`.

A hook is a command: `{type:"command", command, args?, shell?, timeout (1–600 s, default 30), id?, description?, enabled?,
failurePolicy: open|closed, async?}`, per event and optional matcher (`*`, `a|b`, or a regular expression). It receives the event as
JSON on stdin and answers with an exit code and optional JSON (`decision`, `reason`, `continue`, `additionalContext`, or the
`hookSpecificOutput.permissionDecision` shape). Properties, each tested with real processes:

- **Deterministic**: whether it fires and what it returns is a script's result. Nothing here asks a model.
- **Failure policy**: on an event that can block, `open` lets the action go on and reports the failure; `closed` blocks it (a timeout,
  a crash, a missing program and unreadable JSON all count). `async` hooks never wait and never block.
- **Cancellation and cleanup**: a timeout or an Esc kills the process tree (`taskkill /T` on Windows, the process group elsewhere);
  stdout is capped at 256 KB, stderr at 64 KB; background hooks are awaited (bounded) at exit.
- **No recursion**: every hook runs with `SHELRA_HOOK_DEPTH` set; a Shelra started by a hook runs no hooks of its own.
- **Order and merge**: stable (user, project, local; file order); results are recorded in definition order.
- **Log**: `/hooks runs`, `extensions({action:"runs"})`: time, event, hook, source, effect, duration, masked reason.

**Trust.** A project or local hook is a proposal. What runs is the **approved snapshot** in `~/.shelra/trust.json`, outside the
workspace, stored by `/hooks approve` or `shelra hooks approve` (the CLI shows the commands and asks y/N, or takes `--yes`). So an
agent that edits an approved hook, empties the file, or sets `enabled:false` changes nothing about what is enforced: the state
becomes `modified` and the approved version keeps running until the person removes it. A model's `extension_write` can propose a hook
(pending, inert), edit or delete a pending one, and `test` a hook it wrote itself; it cannot approve, change, disable or remove an approved
one, and the file tools and any command or path that names `trust.json`, `user-settings.json` or `auth.json` are refused. That last guard is a
text match on the command and the path: an unsandboxed shell can still build such a path indirectly (`$f=trust; … ~/.shelra/$f.json`), so
it is advisory for `bash`; `--sandbox` is what puts those files out of the shell's reach. A hook defined in the repository runs without
`SHELRA_TOKEN` and without variables named `*_API_KEY`, `*_TOKEN`, `*_SECRET` or `*_PASSWORD` (`hookEnvironment`); a hook the person
wrote in their own settings keeps the whole environment.

## 8. Tools the model has, and commands the person has

| Model tool | Does |
| --- | --- |
| `skill({name, arguments?, resource?})` | Loads a skill's instructions (wrapped with its version and resource list) or a bundled file; one load per version per turn. |
| `extensions({action, kind?, name?, query?})` | `list`, `search`, `inspect`, `instructions`, `hooks`, `runs`, `doctor`, `compat`. Read-only. |
| `extension_write({kind, action, …})` | skill, agent, hook, instructions: create, update, validate, set_enabled, delete, test. Every result: what was written, where, version, active or not. Absent in a delegated agent's tool set. |
| `task({agent, description, prompt, skills?})` | The existing delegation; `agent` is checked when it runs (an agent created earlier in the same turn works), and unknown names get the valid ones. |

The three new tools cost about 1 300 tokens of schema per request (`scripts/extensions-e2e.ts` measured the shape; the cost is
`chars / 4` of the description and JSON schema).

Commands (TUI `/…`, CLI `shelra …`, same services): `skills [list|search|show|validate|on|off|explicit|promote|new|export|import [folder]]`,
`agents [list|show|validate|on|off|runs|new|export|edit]`, `hooks [list|approve|remove|test|runs]`, `instructions`, `prompt`, `doctor`,
`extensions [compat|import [--apply]]`, and `/<skill> args`. A person can lift a restriction, approve a hook and promote a
candidate; a model cannot.

## 9. Compatibility with other agents' files

The adapter (`src/extend/compat.ts`) reads, never writes, the originals, and gives each item a status:

| Item | Result |
| --- | --- |
| `AGENTS.md` | **supported**, loaded as the cross-agent brief |
| `CLAUDE.md` | **supported** as a fallback only when the folder has no `SHELRA.md` or `AGENTS.md`; `@AGENTS.md` imports inside it are followed once |
| `.claude/rules/*.md` | **supported** as path-scoped rules |
| `.agents/skills`, `.claude/skills` | **supported**, read in place; `/skills import` or `extensions import --apply` copies them with their resources into `.shelra/skills` |
| skill `disable-model-invocation`, `user-invocable`, `arguments`, `context: fork`+`agent`, `when_to_use`, `paths` | **translated** to Shelra's switches |
| skill `allowed-tools`, `` !`cmd` ``, `${CLAUDE_*}` | **partial**: recorded or left as written, never a grant, never executed |
| `.claude/agents/*.md` | **translated**: `Read→read_file`, `Grep→grep`, `Glob→grep`, `Edit/Write→edit_file/write_file`, `Bash→bash`, `WebFetch/WebSearch→open_web/search_web`, `permissionMode: plan→read-only`, `maxTurns→max-steps`; `model` aliases become `inherit` (an Anthropic alias is not a Shelra model); unmapped or scoped tool rules are dropped (narrower, never wider); a tool list that maps to nothing becomes "skills only", never "inherit everything" |
| agent `permissionMode: bypassPermissions|acceptEdits|auto|dontAsk`, `isolation`, `mcpServers`, `hooks`, a scoped `disallowedTools` | **rejected**: the agent is listed as blocked, with the reason, and cannot run (honoring them would widen a permission, drop an isolation or skip a control it relied on) |
| `.claude/settings.json` hooks | **translated** (`Bash→bash` in matchers) and imported only as pending proposals; `http`/`prompt`/`agent`/`mcp_tool` hooks and events Shelra does not fire are **rejected** |

Executable content never becomes active on import: hooks arrive pending; skills' scripts only run when the agent runs them
under its normal permissions. `shelra extensions compat` prints this matrix for the project in front of you.

## 10. Free mode, memory, performance

- **Free mode**: no module here calls a model. A delegated agent uses the session's guarded provider; in Free mode it uses the
  session's model whatever its file says (`effectiveAgentModel`, tested in `agents.test.ts` and, through the real `Agent` and
  `SHELRA_MODEL_POLICY`, in `extensions-vertical.test.ts`). Skill selection, hooks and instructions are model-free.
- **Memory**: separate from instructions, agents and skills. A procedure promoted from memory (`shelra memory promote`) becomes a
  `candidate` skill with provenance, validated by a person before it is selected automatically. Instructions written from memory
  or by a tool are files with hashes and history, correctable and deletable. Nothing is stored in a second knowledge base.
- **Performance** (`bun run scripts/extensions-bench.ts`, 500 fixture skills, this machine, measured):

| | Before | After |
| --- | --- | --- |
| Catalog in the system prompt | 152 806 characters, every prompt | 528 characters |
| Skill scan | 49 ms, synchronous, every prompt build | 98 ms once per session (cold); 0.3 ms per prompt; 6 ms per turn (async revalidation) |
| Whole prompt build | — | 1.6 ms (6 134 characters) |
| Hook lookup per tool call | 0.015 ms (no hooks) | 0.036 ms (resolved by file signature, rechecked at most every 150 ms) |
| Instruction chain | 0.23 ms | 0.4 ms |

## 11. Security model

Hostile inputs considered: a repository's files (skills, agents, hooks, rules, settings), a prompt-injected model, a malformed or
oversized definition, concurrent sessions, a path in a name.

| Threat | Defense | Test |
| --- | --- | --- |
| A read-only agent writes through the shell | file tools absent; shell deny-by-default; parentheses, braces, redirections, assignments, interpreters refused | `policy.test.ts`, `redteam.test.ts`, the real run |
| A file grants tools or lifts read-only | policy built from the definition by the host, narrow only; `allowed-tools` never a grant | `agents.test.ts`, `policy.test.ts` |
| A repository runs a command on open | project/local hooks inert until approved; approved snapshot outside the workspace | `hooks-runtime.test.ts` |
| An agent disables or edits the hook stopping it | snapshot keeps running; `disableAllHooks` only from user settings; control files unreachable | `hooks-runtime.test.ts`, `redteam.test.ts` |
| A model plants a user-wide definition from a repo | user-scope writes need the person's request to ask for that scope | `redteam.test.ts` |
| A name is a path (`../x`) | name validated before any path is built (create, delete, history) | `redteam.test.ts` |
| Lost update from concurrent edits | cross-process lock, atomic replace, `expected_hash` | `store.test.ts`, `skills.test.ts`, `agents.test.ts` |
| Two agents overwrite one file | per-file lease | `policy.test.ts`, `extensions-vertical.test.ts` |
| Prompt text widens permissions | nothing that enforces permissions reads the prompt | `extensions-vertical.test.ts` (K) |
| Secrets in definitions, logs, traces | refused on write; masked in logs, traces and `inspect` | `skills.test.ts`, `hooks-runtime.test.ts`, `redteam.test.ts` |
| A hook loops or hangs | `SHELRA_HOOK_DEPTH`, timeouts, process-tree kill, output caps | `hooks-runtime.test.ts` |

Residual risks, stated: the read-only shell guard is a text classifier, not an OS sandbox (a hostile *file name* such as `-o…`
expanded by a glob is not defended); hooks you approve run with your environment and no sandbox; `bash` writes are not leased;
`settings.local.json` is the person's convenience layer, not a trust boundary except for hooks.

Portability (`src/extend/portability.ts`): `skills export <name> <folder>` copies a skill with its resources in the open format;
`skills import <folder>` validates a skill from anywhere (it must be a real skill, at most 5 MB, never over an existing one) and stamps
its provenance; `skills new` and `agents new` start a valid skill or a read-only agent from a name and a description;
`agents export` copies a definition to a file. The terminal log draws command output in a code block (`asFencedText`), because it
renders Markdown and would eat the backslashes of a Windows path.

## 12. Evidence and open items

Commands, 2026-10-07 (this machine, Windows 11): `bun run typecheck`, `bun run lint`, `bun run format` exit 0;
`bunx vitest run --pool=forks src/extend src/hooks src/agent/extensions-vertical.test.ts`; `bun test src/ui/app.test.tsx`; the full
`bun run test` result is in the session report. A real model (OpenRouter, Free mode, `scripts/extensions-e2e.ts`, two runs): the
model created a skill and a read-only agent that preloads it, delegated twice, tried to write through `New-Item` and was refused by
the host; two run records, `completed`, `readOnly`, no `write_file`. The first run found a real defect no scripted test had (an
enum of agent names fixed per round refused an agent created in the same turn); the scripted provider now validates every call
against the tool's input schema as the SDK does.

With the owner signed in (2026-10-07), through the real CLI (`shelra -p`, free models, OpenRouter): a natural-language run updated
`SHELRA.md`, proposed a hook (the model reported it as pending, correctly) and created a skill, and the session moved to the next free
model when one failed; `shelra -p "/ship-it staging"` loaded an explicit-only skill with its argument and the model wrote
`shipped-staging.txt` with the exact content, leaving `instructions.in_force` and `skill.loaded` events in the trace; with a project
hook approved (`failurePolicy: closed`), a model asked to create `locked.txt` and `open.txt` was blocked on the first before the write
(the file does not exist) and created the second. (Git Bash on Windows rewrites a leading `/name` argument into `C:/Program
Files/Git/name`: set `MSYS_NO_PATHCONV=1` when testing `/skill` by hand.)

Tests added after the first report: `readonly-differential.test.ts` runs 1 500 generated commands through the classifier and
executes the 453 it allows in a real shell, comparing the disk before and after (0 changes); `stress.test.ts` has six real processes
write the same skills and agents at once (216 of 216 writes ok, every file whole and valid, no temporaries left); the Agent-level
tests cover a blocking `UserPromptSubmit`, a refusing `Stop`, `SessionStart` context and path-scoped rules.

Blocked or not done, exactly: Groq was configured but not exercised
(its free plan is not declared free here); the TUI's new text outputs have not had the three rendered passes the UI rules ask for;
selection misses "notas de la versión" for a `release-notes` skill (a lexicon gap in `src/memory/terms.ts`).
