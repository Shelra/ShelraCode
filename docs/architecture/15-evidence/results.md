# Experiment results (audit doc 15, §6)

Generated from the benchmark run logs; one sample per cell. Method: §6.1 of the audit report.
Outcomes: PASS; FAIL, a false completion (the agent ended as done and the oracle failed); fail·NV, the
agent ended with a host note such as `[Not verified]`; timeout, the benchmark stopped the agent at its time
limit (it never claimed to be done); infra, the provider refused before the agent could
act. `*` marks a task re-run in a supplement run after an infrastructure loss. Runs A0-A6 use the
post-audit code (§6.4).

| Run | Agent | Model | Ablation | Resolved | Infra-lost | False completions | Honest unverified | Timed out | Median time (s) | Median steps | Total tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A0-smoke-nemotron-after | shelra | nvidia/nemotron-3-ultra-550b-a55b:free | none | 1/1 | 0 | 0 | 0 | 0 | 368 | 27 | 128,779 |
| A3-silent-full-nemotron-after | shelra | nvidia/nemotron-3-ultra-550b-a55b:free | none | 7/8 | 0 | 0 | 0 | 1 | 338 | 24 | 2,499,450 |
| C1-core-claude-sonnet | claude-code | claude-code/sonnet | none | 8/8 | 0 | 0 | 0 | 0 | 29 | 7 | 1,714,124 |
| C2-silent-claude-sonnet | claude-code | claude-code/sonnet | none | 8/8 | 0 | 0 | 0 | 0 | 32 | 7 | 1,983,356 |
| C3-memory-claude-sonnet | claude-code | claude-code/sonnet | none | 6/6 | 0 | 0 | 0 | 0 | 21 | 11 | 1,405,888 |
| S1-core-full-nemotron | shelra | nvidia/nemotron-3-ultra-550b-a55b:free | none | 7/8 | 1 | 0 | 0 | 0 | 252 | 15 | 780,678 |
| S2-core-bare-nemotron | shelra | nvidia/nemotron-3-ultra-550b-a55b:free | bare | 1/8 | 6 | 1 | 0 | 0 | 1 | 1 | 155,296 |
| S3-silent-full-nemotron | shelra | nvidia/nemotron-3-ultra-550b-a55b:free | none | 6/8 | 1 | 1 | 0 | 0 | 271 | 18 | 1,101,414 |
| S4-silent-nogate-nemotron | shelra | nvidia/nemotron-3-ultra-550b-a55b:free | gate | 7/8 | 0 | 1 | 0 | 0 | 104 | 8 | 1,155,255 |
| S5-memory-full-nemotron | shelra | nvidia/nemotron-3-ultra-550b-a55b:free | none | 3/6 | 3 | 0 | 0 | 0 | 9 | 4 | 292,723 |
| X1-core-codex-luna | codex | codex/gpt-5.6-luna@max | none | 8/8 | 0 | 0 | 0 | 0 | 101 | 1 | 2,070,063 |
| X2-silent-codex-luna | codex | codex/gpt-5.6-luna@max | none | 8/8 | 0 | 0 | 0 | 0 | 139 | 1 | 1,677,682 |
| X3-memory-codex-luna | codex | codex/gpt-5.6-luna@max | none | 5/6 | 0 | 1 | 0 | 0 | 78 | 1 | 852,151 |

| Run | 01-input-normalization | 02-config-pipeline | 03-ttl-cache | 04-retry-policy | 05-state-migration | 06-bounded-queue | 07-router-integration | 08-workflow-orchestrator | a-learn | b-recall-with-memory | b-recall-without-memory | c-learn | d-recall-with-memory | d-recall-without-memory |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A0-smoke-nemotron-after | PASS 368s |  |  |  |  |  |  |  |  |  |  |  |  |  |
| A3-silent-full-nemotron-after | PASS 281s | PASS 456s | PASS 271s | PASS 338s | PASS 223s | timeout 1261s | PASS 354s | PASS 655s |  |  |  |  |  |  |
| C1-core-claude-sonnet | PASS 22s | PASS 29s | PASS 17s | PASS 26s | PASS 32s | PASS 38s | PASS 38s | PASS 118s |  |  |  |  |  |  |
| C2-silent-claude-sonnet | PASS 22s | PASS 32s | PASS 18s | PASS 30s | PASS 34s | PASS 46s | PASS 61s | PASS 172s |  |  |  |  |  |  |
| C3-memory-claude-sonnet |  |  |  |  |  |  |  |  | PASS 20s | PASS 14s | PASS 22s | PASS 30s | PASS 21s | PASS 24s |
| S1-core-full-nemotron | PASS 180s | PASS 354s | PASS 345s | PASS 252s | PASS 54s | PASS* 568s | infra* 1s | PASS* 847s |  |  |  |  |  |  |
| S2-core-bare-nemotron | infra 1s | infra 1s | infra 9s | infra 3s | infra 1s | infra 1s | PASS 316s | FAIL 289s |  |  |  |  |  |  |
| S3-silent-full-nemotron | PASS 118s | PASS 271s | PASS 367s | PASS 246s | PASS 406s | FAIL 170s | PASS 320s | infra 897s |  |  |  |  |  |  |
| S4-silent-nogate-nemotron | PASS 54s | PASS 189s | PASS 93s | PASS 104s | PASS 69s | PASS 207s | FAIL 167s | PASS 844s |  |  |  |  |  |  |
| S5-memory-full-nemotron |  |  |  |  |  |  |  |  | PASS 107s | PASS 81s | infra 1s | infra 9s | infra 1s | PASS 377s |
| X1-core-codex-luna | PASS 53s | PASS 79s | PASS 51s | PASS 201s | PASS 146s | PASS 101s | PASS 169s | PASS 625s |  |  |  |  |  |  |
| X2-silent-codex-luna | PASS 54s | PASS 120s | PASS 78s | PASS 179s | PASS 139s | PASS 188s | PASS 154s | PASS 385s |  |  |  |  |  |  |
| X3-memory-codex-luna |  |  |  |  |  |  |  |  | PASS 102s | PASS 99s | PASS 64s | PASS 100s | FAIL 53s | PASS 78s |

## Failures

- A3-silent-full-nemotron-after `06-bounded-queue` [timeout]: Agent turn exceeded 1200s and was aborted; Benchmark acceptance criteria not satisfied: AC-ORACLE, AC-TESTS
- S1-core-full-nemotron `07-router-integration` [infra]: Agent turn failed: openrouter/nvidia/nemotron-3-ultra-550b-a55b:free cannot serve this request (Provider returned error) and no fallback model is left. Everythi
- S2-core-bare-nemotron `01-input-normalization` [infra]: Agent turn failed: openrouter/nvidia/nemotron-3-ultra-550b-a55b:free cannot serve this request (Provider returned error) and no fallback model is left. Everythi
- S2-core-bare-nemotron `02-config-pipeline` [infra]: Agent turn failed: openrouter/nvidia/nemotron-3-ultra-550b-a55b:free cannot serve this request (Provider returned error) and no fallback model is left. Everythi
- S2-core-bare-nemotron `03-ttl-cache` [infra]: Agent turn failed: openrouter/nvidia/nemotron-3-ultra-550b-a55b:free cannot serve this request (Provider returned error) and no fallback model is left. Everythi
- S2-core-bare-nemotron `04-retry-policy` [infra]: Agent turn failed: openrouter/nvidia/nemotron-3-ultra-550b-a55b:free cannot serve this request (Provider returned error) and no fallback model is left. Everythi
- S2-core-bare-nemotron `05-state-migration` [infra]: Agent turn failed: openrouter/nvidia/nemotron-3-ultra-550b-a55b:free cannot serve this request (Provider returned error) and no fallback model is left. Everythi
- S2-core-bare-nemotron `06-bounded-queue` [infra]: Agent turn failed: openrouter/nvidia/nemotron-3-ultra-550b-a55b:free cannot serve this request (Provider returned error) and no fallback model is left. Everythi
- S2-core-bare-nemotron `08-workflow-orchestrator` [false]: Benchmark acceptance criteria not satisfied: AC-ORACLE
- S3-silent-full-nemotron `06-bounded-queue` [false]: Benchmark acceptance criteria not satisfied: AC-ORACLE
- S3-silent-full-nemotron `08-workflow-orchestrator` [infra]: Agent turn failed: openrouter/nvidia/nemotron-3-ultra-550b-a55b:free cannot serve this request (Provider returned error) and no fallback model is left. Everythi
- S4-silent-nogate-nemotron `07-router-integration` [false]: Benchmark acceptance criteria not satisfied: AC-ORACLE
- S5-memory-full-nemotron `b-recall-without-memory` [infra]: Agent turn failed: openrouter/nvidia/nemotron-3-ultra-550b-a55b:free cannot serve this request (Provider returned error) and no fallback model is left. Everythi
- S5-memory-full-nemotron `c-learn` [infra]: Agent turn failed: openrouter/nvidia/nemotron-3-ultra-550b-a55b:free cannot serve this request (Provider returned error) and no fallback model is left. Everythi
- S5-memory-full-nemotron `d-recall-with-memory` [infra]: Agent turn failed: openrouter/nvidia/nemotron-3-ultra-550b-a55b:free cannot serve this request (Provider returned error) and no fallback model is left. Everythi
- X3-memory-codex-luna `d-recall-with-memory` [false]: Benchmark acceptance criteria not satisfied: AC-ORACLE
