# Operation, tool and trust audit

Source owner: `src/toolset/tools.ts` / `createTools` and `hardenToolSet`. This inventory distinguishes inspection from executed fault tests. Optional groups were not enabled against real desktops, wallets, schedulers or Telegram accounts. No messages, payments or schedules were sent by this audit.

## Tool inventory

All registered built-ins use Zod input schemas and tool hardening. Hardening represents thrown errors as failed results and fires failure hooks; it does **not** impose a universal deadline on arbitrary `execute`. JSON/schema repair can recover some model argument mistakes, but repairs are not semantic validation. MCP tools inherit discovered external schemas.

| Registered tools | Owner / execution characteristics | Failure, limits and trust finding | Executed evidence |
| --- | --- | --- | --- |
| `bash` | `tools/bash.ts`, `exec/command.ts`, `exec/shell.ts`; ignored stdin; process-tree kill; bounded captures | Foreground deadlines and signal; background has explicit lifetime. Raw log is separate from capture cap. Commands inherit environment. Regex permission checks are not an OS sandbox | Windows mixed failure, never-close abort, long stderr, existing Bash regressions |
| `process_logs`, `process_stop`, `process_list` | Bash-owned background registry / log tail | Log tail bounds read; missing/unreadable logs may appear empty; stop ownership matters | Existing Bash/process tests and 1/3/5 manager ownership regression |
| `read_file` | `tools/file.ts`; realpath workspace guard; line/output limits | Synchronous full-file read occurs before range/output limit; generated/binary text can cost large allocation | 32 MiB one-line profiling; existing read/binary/path tests |
| `write_file`, `edit_file`, `delete_file`, `restore_file` | File tools, line-ending preservation, recoverable trash | No broad automatic retry; edit requires unique match. Concurrent edits are not a task transaction. File guard is stronger than arbitrary shell scope | Existing file/CRLF/path/trash tests; live fixture edits |
| `grep` | `tools/grep.ts`; ripgrep process with arguments and result limit | Discovery is textual, not a call graph. Large scans and synchronous filesystem fallback need bounded-work treatment | Existing tests; live fixture discovery |
| `search_web`, `open_web` | `research/web.ts`; 8-second HTTP request signals, limits, public-host/redirect checks for page opening | Results are untrusted leads; host pre-task search bounded to 10 seconds. Hostname checks are not complete DNS-rebinding protection. Search retries/fallbacks can add latency | Existing malformed/timeout/private-host tests; baseline network and real-provider fixture |
| `task`, `delegate`, `delegation_read`, `delegation_list` | Agent children and delegation persistence | Same provider, bounded attempts and steps; optional persistent subprocess. Child activity mostly descriptive, not complete correlated metrics. Different agents may edit same source | Existing delegation/resilience suites; live independent-check tail |
| `generate_plan`, `update_plan_step`, `report_blocker` | `plans/state.ts`, kernel/gate | Plan is model authored; claimed is distinct from verified complete. Blocker ends generation. Tool success is publication, not task success | Plan regressions; objective/closing/episode tests |
| `memory_list`, `memory_read`, `memory_write`, `memory_delete` | Store + deterministic admission gate | Scope/provenance and duplicate controls; no full semantic truth oracle. Bounded owner-checked lock with fair tickets; index/body/history still separate commits | Actual multi-process admission; full-suite owner/fairness regressions; 11-scenario suite; 92-query stress |
| `propose_decision` | Decision ledger, user approval | Proposal is not active until approval; scope/check metadata governs enforcement | Existing ledger and decision tests; no owner approvals fabricated |
| `lsp` | Opt-in LSP protocol tool and diagnostics | Server-specific lifecycle/timeout, schema enums; not a complete repository semantic index | Existing LSP tests; no live language-server campaign |
| `telegram_send_file` | Configured bridge file delivery | External write requires connected account; local path/file privacy matters | Source inspected; no delivery attempted |
| `computer_snapshot`, `computer_screenshot`, `computer_click`, `computer_mouse_move`, `computer_type`, `computer_press`, `computer_scroll`, `computer_launch`, `computer_list_windows`, `computer_focus_window`, `computer_wait`, `computer_get` | Opt-in desktop group; agent-desktop wrapper | Launch/wait have individual bounds. External app commands/actions are privileged; universal tool timeout is absent | Existing computer tests; no live desktop activity |
| `schedule_create`, `schedule_list`, `schedule_remove`, `schedule_read_log`, `schedule_daemon_status`, `schedule_daemon_start`, `schedule_daemon_stop` | Opt-in schedules group | Subprocess/log/config ownership separate; persistent side effects require explicit user scope | Existing schedule tests; no live schedule created |
| `wallet_info`, `wallet_history`, `fetch_payment_info`, `paid_request` | Opt-in payment group | Provider/wallet side effects and URL requests require spend/authorization boundaries; not coding-core reliability evidence | Source inspected; no live payment/API call |
| Discovered MCP tools | `mcp/runtime.ts`, AI SDK client | Transport initialization/close bounded and stderr drained after repair; isError is now SDK error-text and remains failed in resumed evidence; no common execution output-size/deadline wrapper | Real 2 MiB-stderr handshake; late-client/hung-transport, model converter and persistence regressions |

No generic duplicate-call suppression exists because repeated reads/checks can be correct. Repetition and lack of new lexical information stop generations after bounded windows. Edit oscillation and repeated failing checks add host stops. Those distinguish repeated evidence from endless loops better than no safeguards, but do not recognize every semantically futile strategy.

## External operation ownership

| Boundary | Cancellation / deadline | Remaining question |
| --- | --- | --- |
| Main/child model generation | Parent signal, SDK total/step/chunk budgets, idle watchdog, recovery attempts | Abort now wakes reader; underlying uncooperative network work may still outlive control settlement |
| Auxiliary model work | Specific helper timeouts; reflection deferred on failure | Child/recap/audit timings not fully visible in one primary stream |
| HTTP research | Request signals and bounded host research | Limits across fallback attempts and response parsing need an operation-level view |
| Image input | Shared 10-second preparation deadline; 10 MiB source cap | Local synchronous file read cannot be interrupted mid-call; URL/local source policy differs from `open_web` |
| Foreground command/check/build/git | Shell timeout, signal, tree kill, capture bound, 5-second safety settlement | Windows `taskkill` callback and log close can independently wait; a reported kill is not confirmed tree exit |
| Background process | Registry owner, explicit stop, exit sweep, readiness checks | Intentional long lifetime needs visible ownership and crash cleanup; no blanket foreground timeout |
| MCP | Bounded connect/list/close; SDK receives execution signal | No uniform tool execution cap; transport cleanup rejection must remain diagnosable |
| SQLite | Synchronous local API, WAL, 5-second busy timeout | Three real contention trials delay a 20 ms cancel timer until 5337–5394 ms; SQLITE_BUSY, integrity ok; no async mid-call cancellation |
| Memory/filesystem | Atomic replacement, monotonic bounded contention, fair owner-checked lock, synchronous reads/writes | Up to one second writer contention blocks loop; compound commit/crash atomicity and abandoned-reaper recovery incomplete |
| Installer/bootstrap/bridge downloads | Mixed caller-signal and helper-specific policies | Source paths still exist without a hard request/body settlement deadline |
| Browser smoke | Host-owned browser/server checks and bounded contract checks | Browser creation/shutdown and platform dependency availability need independent fault tests |

## Failure taxonomy derived from the runtime

The runtime already distinguishes `Limited`, `Paused`, `Cancelled`, `Stopped`, `Not verified` and checked completion. Provider events distinguish error/abort; command states distinguish completed, timed out, killed and spawn error; host stops distinguish repeating, stalled, oscillating, plateau and blocked. These are multiple representations, not a single typed failure vocabulary.

| Proposed diagnostic code | Derivation / evidence | Retry or completion meaning |
| --- | --- | --- |
| `PROVIDER_SILENCE`, `PROVIDER_TRANSPORT`, `PROVIDER_REJECTED_KEY`, `PROVIDER_ALLOWANCE` | Existing recovery/credential/limits classifiers | Preserve completed steps; policy-compliant retry/fallback; allowance is Limited, not verified |
| `TOOL_REJECTED`, `TOOL_FAILED`, `TOOL_PROTOCOL` | Tool refusal/error and F14 conversion | Failed result stays failed; do not promote to evidence |
| `COMMAND_TIMEOUT`, `COMMAND_CANCEL_UNSETTLED`, `COMMAND_SPAWN` | Command states, F02/F03 | Unconfirmed closure distinct from completed exit; retain owner |
| `MCP_INITIALIZATION`, `MCP_BACKPRESSURE`, `MCP_CLEANUP` | F10 | Failed resource unavailable; drain/close diagnostic preserved |
| `GENERATION_REPEAT`, `GENERATION_NO_NEW_EVIDENCE`, `EDIT_OSCILLATION`, `CHECK_PLATEAU` | Existing host stop conditions | Explain once, allow another strategy, then completion gate |
| `CONTEXT_OVERFLOW`, `MEMORY_BUSY`, `PERSISTENCE_INCOMPLETE` | Overflow recovery and F05/F12/F19 | Reduced context must retain task constraints; unsaved state must be explicit |
| `CHECK_FAILED`, `CHECK_UNAVAILABLE`, `CHECK_ROLE_CONFLICT`, `ACCEPTANCE_UNPROVED` | Actual evidence gate and F13/F16 | Never equate unavailable with pass; baseline failure remains unverified |
| `USER_CANCELLED`, `INTERNAL_FAILURE` | Parent signal and unexpected runtime failure | End/record work; unknown errors preserve source and correlation |

This table is a diagnostic mapping recommendation. The audit did not claim to have implemented a universal new error enum across every subsystem.

## Watchdog and measurable freeze condition

The new trace metadata supplies primary first/last model activity, active stage, outstanding tools, prepared context sizes and durations. Existing idle/repetition/circle detectors are retained. A future lightweight watchdog should observe owned operations, not kill every turn after a fixed age:

- **Long running:** verified step completion, new relevant observation or advancing owned operation exists.
- **Waiting externally:** an identified provider/tool/queue entry is pending within its budget; record last real activity and deadline.
- **Rate limited:** provider allowance/error evidence, with retry/reset time if known.
- **Tool blocked:** approval/input/owned child is identified; no inference of progress from animated UI text.
- **Model loop / no progress:** existing repeat/circle stop or unchanged acceptance state plus repeated observation fingerprints.
- **Stuck:** an operation exceeds its declared progress/settlement contract, with owner and last event; cancellation/diagnostic path is exercised.
- **Dead:** process exited or heartbeat/event-loop sampling confirms no execution; lack of content alone is insufficient.

F16 needs child event correlation to distinguish a busy checker, tool stall, retry and provider silence. The diagnostic rerun now proves one busy checker continued using tools after primary generation ended, then closing reflection waited beyond the budget. It does not attribute every delayed trial. The declared Bun runtime hint was corrected with regressions. Increasing timeouts before resolving remaining distinctions would conceal the condition. The watchdog is not yet a complete implemented operation registry.

## Trust and persistence boundaries

Realpath checks protect built-in file access against traversal/symlink escapes; shell commands have broader privileges. A shared scratch directory is not tenant isolation. AGENTS/CLAUDE files intentionally become privileged project instructions, while web search results are tool data with an injection filter. This is a trust choice, not proof that malicious repository content cannot redirect a model.

SQLite stores sessions/transcripts/checkpoints/usage/objectives; filesystem memory stores topic/index/history/episodes. WAL and selected transactions help, but there is no atomic transaction spanning source edits, tool side effects and task completion. Abnormal termination can leave partial edits and processes. The real-Agent killed-refactor memory test establishes interruption recognition and plan recall, not automatic rollback or confirmed cleanup of every external child.

Trace redaction/14-day retention and swallowed-error diagnostics exist. Raw command logs use different privacy and retention rules; pattern redaction does not cover arbitrary passwords, personal data or every credential family. Privacy validation must use intentionally seeded fixture secrets, not capture real user values. No live exfiltration, destructive command or disk-fill campaign was performed.

The isolated synthetic-secret experiment now confirms both the known-format key and arbitrary password reach actual command capture and disk RunLog. Trace redaction removes the key but retains the password (`privacy.json`). The child receives only the artificial values and OS variables; no real credential or network is involved. This is a measured trust gap, not merely a speculative leak. A per-chunk regex alone is not an adequate streaming fix because secret strings can span chunks and arbitrary values need an explicit policy.

SDK behavior was checked against installed source and primary references: [AI SDK streaming](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text), [AI SDK tool execution](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling), and [Bun child processes](https://bun.sh/docs/runtime/child-process). These references explain contracts; the reproduced defects and measurements come from this checkout.
