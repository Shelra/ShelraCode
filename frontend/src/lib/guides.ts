// Copy of the guide pages (/memory, /local, /free-models). Like content.ts, every statement comes from the repository:
// docs/design/shelra-memory-engine.md, README.md, docs/architecture/OPENROUTER-RUNTIME.md, AGENTS.md (resilience),
// src/models/huggingface.ts and recommendation.ts, src/runtimes/bootstrap.ts; external limits cite their source.
// Measured numbers never appear here: the pages read them from bench-summary.json (bun run bench:sync).
//
// Inline markup in any text: `code`, **strong**, [label](href). Internal hrefs start with "/".
import { links } from "./content";

export type Block =
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[]; ordered?: boolean }
  | { kind: "code"; lines: string[] }
  | { kind: "table"; columns: string[]; rows: string[][] }
  | { kind: "note"; text: string }
  // Measured results, rendered from bench-summary.json by the page.
  | { kind: "data"; name: "memory-runs" | "field-case-requests" | "free-model-results" };

export type GuideSection = { id: string; heading: string; blocks: Block[] };

export type Guide = {
  path: "/memory" | "/local" | "/free-models";
  /** Short name for breadcrumbs, the footer and related links. */
  name: string;
  /** One line for the related-guide cards. */
  summary: string;
  badge: string;
  /** Title without the site name (the layout's template adds it). */
  title: string;
  description: string;
  heading: [string, string];
  lede: string;
  sections: GuideSection[];
  action: { label: string; href: string };
};

export const memoryGuide: Guide = {
  path: "/memory",
  name: "Project memory",
  summary: "What it keeps between sessions, and what its write gate refuses.",
  badge: "PROJECT MEMORY",
  title: "Coding agent memory: what it keeps and refuses",
  description:
    "How ShelraCode's project memory works: what it retrieves before each request, what one bounded reflection may add, and what its write gate refuses to store.",
  heading: ["Project memory that keeps the thread. ", "And a gate that decides what it may keep."],
  lede: "ShelraCode keeps what it learns about a project in plain files under `.shelra/memory/`. Before each request it loads the entries that matter; after real work, one bounded reflection proposes new ones, and a deterministic gate decides. The gate refuses secrets and prompt-injection phrasing, and never lets an inference replace a rule you stated.",
  sections: [
    {
      id: "what-it-keeps",
      heading: "What it keeps",
      blocks: [
        {
          kind: "p",
          text: "Durable facts about the project: how it builds and tests, decisions and the reasons behind them, procedures that worked, failures and their fixes, and the rules you state.",
        },
        {
          kind: "list",
          items: [
            "**Rules you state** (“always …”, “never …”, “prefer …”) are saved as you said them, without a model call, and marked as yours.",
            "**Facts learned from work** come from a reflection after a turn that changed files, worked through a failure or investigated at length. What a turn that ended unverified teaches is kept too, marked unverified, and never outranks a confirmed fact.",
            "**Procedures** that proved themselves in two or more turns become project skills in `.agents/skills/<name>/SKILL.md`, with their origin written in the file.",
          ],
        },
        {
          kind: "p",
          text: "Entries are Markdown files you can read and edit, listed in an index (`MEMORY.md`), and `history.jsonl` records every change as JSON Lines. Memory that applies to all your projects lives in `~/.shelra/memory` and is loaded beside the project's.",
        },
      ],
    },
    {
      id: "what-it-refuses",
      heading: "What it refuses to keep",
      blocks: [
        {
          kind: "p",
          text: "A memory fails at the write, not the read: once something wrong is stored, every later session trusts it. So every write, automatic or requested by the model, passes one gate: a plain function that gives a reason for each decision.",
        },
        {
          kind: "list",
          items: [
            "**Secrets.** Text shaped like a credential is rejected.",
            "**Prompt injection.** Phrasing that tries to steer the agent, such as “ignore previous instructions”, “bypass the checks” or “pretend to be…”, is rejected.",
            "**Replacing what you said.** Whatever the model writes is recorded as an inference, and an inference never replaces a rule you stated.",
            "**Repeats.** An exact repeat is skipped, and a close rewrite of an entry either updates it or is dropped: it never becomes a second copy.",
            "**Sprawl.** Entries that are too short or too long are rejected, each kind of entry is capped, and the index stops at 200 lines.",
          ],
        },
        {
          kind: "p",
          text: "Each entry records where it came from (you, a command the host saw run, or the model's inference) and how sure it is, and retrieval weighs it accordingly.",
        },
      ],
    },
    {
      id: "how-it-recalls",
      heading: "How it finds what matters",
      blocks: [
        {
          kind: "p",
          text: "Before every request, and before every sub-agent's brief, retrieval ranks the entries against the task: the words and file paths they share, weighted by trust, by recency, and by whether the files an entry depends on changed since it was last confirmed. Up to four entries are loaded in full, within 3,000 characters; the next twelve are listed by title and the rest counted, and `memory_list` shows them all.",
        },
        {
          kind: "p",
          text: "Retrieval is lexical: no embeddings, no vector index to keep in sync, nothing sent to another service. The trade-off is in the limits below.",
        },
      ],
    },
    {
      id: "how-it-learns",
      heading: "How it learns",
      blocks: [
        {
          kind: "p",
          text: "After a turn that did real work, a bounded reflection (30 seconds and 1,500 output tokens per attempt, at most three attempts) reads a digest of the turn: the request, the files changed, the last commands and how they ended, the final report and the entries that already exist. It may propose up to five durable facts; the gate decides which survive.",
        },
        {
          kind: "p",
          text: "You can also manage it directly: the agent has `memory_list`, `memory_read`, `memory_write` and `memory_delete`, and every write goes through the same gate.",
        },
      ],
    },
    {
      id: "evidence",
      heading: "The evidence",
      blocks: [
        {
          kind: "p",
          text: "A benchmark suite asks the one question that matters: does the memory change what a later session achieves? In phase A the agent implements a function whose tests depend on an undocumented code-generation step. Phase B changes the schema and must regenerate, twice, from phase A's finished workspace: once with the memory phase A wrote, once with it wiped. The check reads a hash of the schema inside the generated module, so only a real regeneration passes.",
        },
        { kind: "data", name: "memory-runs" },
      ],
    },
    {
      id: "limits",
      heading: "Limits",
      blocks: [
        {
          kind: "list",
          items: [
            "Retrieval is lexical: a request that shares no words with an entry will not load its body, although its title is still listed.",
            "Reflection is only as good as the model running the turn; the gate limits the damage of a poor extraction but cannot make a good one.",
            "Promoted skills are written into your repository under `.agents/skills`: review them like any other committed file.",
            "Entries do not link to one another; what an entry replaces and the files it depends on are its only references.",
            "Deleting is not gated: the agent's `memory_delete` can remove any entry, yours included; `history.jsonl` keeps the record.",
          ],
        },
        {
          kind: "p",
          text: `The full design, with the research behind each decision: [docs/design/shelra-memory-engine.md](${links.memoryDesign}).`,
        },
      ],
    },
  ],
  action: { label: "Read the design", href: links.memoryDesign },
};

export const localGuide: Guide = {
  path: "/local",
  name: "Local mode",
  summary: "The same agent on your own hardware: llama.cpp, a verified model, no key.",
  badge: "LOCAL MODE",
  title: "Run a coding agent locally with llama.cpp",
  description:
    "shelra --local runs the same coding agent against a model on your own hardware: a managed llama.cpp server and a verified GGUF model, no API key, no model provider.",
  heading: ["Run ShelraCode offline. ", "One flag, no API key, the model on your own hardware."],
  lede: "With `--local`, ShelraCode runs its usual agent loop against a model on your own hardware. It installs and starts a llama.cpp server on loopback, downloads a verified GGUF model the first time, and checks both before the chat opens. No account, no key, no configuration file.",
  sections: [
    {
      id: "start",
      heading: "Start it",
      blocks: [
        { kind: "code", lines: ["$ shelra --local"] },
        { kind: "p", text: "The first run sets everything up, with progress in the terminal:" },
        {
          kind: "list",
          ordered: true,
          items: [
            "It reads the hardware: memory, and NVIDIA GPUs through `nvidia-smi`.",
            "It picks a model that fits (below) and downloads it from Hugging Face. The download resumes after an interruption and is checked against a pinned SHA-256.",
            "It downloads llama.cpp release `b10826` from the official ggml-org releases, also checked against a pinned SHA-256.",
            "It starts `llama-server` on loopback and runs a health check before the chat opens.",
          ],
        },
        {
          kind: "p",
          text: "Later runs reuse the model and the engine stored under `~/.shelra`. Starting ShelraCode never downloads or starts a local model: that happens when you ask for local mode, or when a cloud session falls back to a model you already installed (below).",
        },
      ],
    },
    {
      id: "models",
      heading: "Which model it picks",
      blocks: [
        {
          kind: "table",
          columns: ["Model", "Picked when", "Memory", "Download", "Context loaded"],
          rows: [
            [
              "Qwen2.5 Coder 1.5B · Q4_K_M",
              "no GPU memory reported, or under 5 GB of it usable",
              "about 2.2 GB",
              "1.1 GB",
              "8K on a CPU, 16K on an NVIDIA GPU",
            ],
            [
              "Qwen2.5 Coder 7B · Q4_K_M",
              "5 GB or more of usable GPU memory",
              "about 5.3 GB",
              "4.7 GB",
              "8K on a CPU, 16K on an NVIDIA GPU",
            ],
          ],
        },
        {
          kind: "p",
          text: "Usable GPU memory is 72% of what the GPUs report. Without it the smaller model is the default and the larger one is offered as the quality option. Both models accept 32K tokens of context; the managed server loads less by default to fit ordinary machines, and `SHELRA_CONTEXT` (CPU) or `SHELRA_GPU_CONTEXT` (GPU) raises it. To choose the model yourself, set its id:",
        },
        { kind: "code", lines: ["$ export SHELRA_ONBOARDING_MODEL=hf:Qwen/Qwen2.5-Coder-7B-Instruct-GGUF:Q4_K_M"] },
      ],
    },
    {
      id: "platforms",
      heading: "Platforms",
      blocks: [
        {
          kind: "list",
          items: [
            "**Windows x64**: the CPU build, or the CUDA 12.4 build when an NVIDIA GPU is found (force it with `SHELRA_RUNTIME_BACKEND=cuda`).",
            "**macOS**: Apple silicon and Intel.",
            "**Linux x64**.",
          ],
        },
        {
          kind: "p",
          text: "Elsewhere, or if you already run a model server, point ShelraCode at any OpenAI-compatible endpoint on your machine:",
        },
        { kind: "code", lines: ["$ export SHELRA_LOCAL_ENDPOINT=http://127.0.0.1:8080/v1", "$ shelra --local"] },
      ],
    },
    {
      id: "same-agent",
      heading: "The same agent, locally",
      blocks: [
        {
          kind: "p",
          text: "Local mode changes where the model runs, not what ShelraCode does: the same tools, [project memory](/memory), sub-agents and saved sessions, and the same rule that a change is not done until a real check has run.",
        },
        {
          kind: "p",
          text: "The model runs on your machine, so no model provider sees your code or your prompts. The agent's web research (`search_web`, `open_web`) and the commands it runs can still reach the network when a task calls for them.",
        },
        {
          kind: "p",
          text: "Local mode is also the last fallback of a cloud session, with a model that is already installed; nothing is downloaded mid-task. When OpenRouter rejects your key, ShelraCode moves to another OpenRouter key you have, then to the local model; when another provider rejects its key, it moves to OpenRouter's free models, then to the local model.",
        },
      ],
    },
    {
      id: "expectations",
      heading: "What to expect",
      blocks: [
        {
          kind: "list",
          items: [
            "These are compact 2024 models (1.5 and 7 billion parameters), run with 8K to 16K tokens of context by default: a fraction of the size of current cloud models. Start with focused tasks, and let the checks tell you when a task is beyond them.",
            "Speed depends on your hardware, and a CPU is much slower than a GPU. On a slow machine, raise the time limits in milliseconds: `SHELRA_MODEL_STEP_TIMEOUT_MS` for one model step and `SHELRA_MODEL_IDLE_TIMEOUT_MS` for the wait between streamed chunks.",
            "No benchmark runs of local mode have been published yet: the runs on record use cloud models.",
          ],
        },
      ],
    },
  ],
  action: { label: "Local mode in the README", href: links.localMode },
};

export const freeModelsGuide: Guide = {
  path: "/free-models",
  name: "Free models",
  summary: "OpenRouter's free tier: the limits it sets and how the free policy routes around them.",
  badge: "FREE MODELS",
  title: "OpenRouter free models in a coding agent",
  description:
    "How ShelraCode runs on OpenRouter's free models: the daily limits OpenRouter sets, how the free policy picks and falls back, and how to cap spending.",
  heading: ["ShelraCode on free models. ", "What OpenRouter's free tier allows, and what the agent does with it."],
  lede: "By default ShelraCode runs on OpenRouter's free models, under a policy that never picks a paid model without your say. A free OpenRouter key is all it needs.",
  sections: [
    {
      id: "setup",
      heading: "Set it up",
      blocks: [
        { kind: "code", lines: ["$ shelra auth openrouter <your-key>", "$ shelra"] },
        {
          kind: "p",
          text: "The key is stored in `~/.shelra/auth.json`, never in your project; the `OPENROUTER_API_KEY` environment variable works too.",
        },
      ],
    },
    {
      id: "limits",
      heading: "The limits OpenRouter sets",
      blocks: [
        {
          kind: "list",
          items: [
            "**20 requests a minute** on free models.",
            "**50 requests a day**, or **1,000 a day** once you have bought at least $10 of OpenRouter credits.",
            "The limits apply to your account: more keys or more accounts do not raise them. Past a limit, OpenRouter answers HTTP 429.",
          ],
        },
        {
          kind: "note",
          text: "Source: [OpenRouter's rate-limit documentation](https://openrouter.ai/docs/api_reference/limits), checked on 2026-09-23. OpenRouter can change these limits; its page is the authority.",
        },
        { kind: "data", name: "field-case-requests" },
      ],
    },
    {
      id: "policy",
      heading: "How the free policy picks a model",
      blocks: [
        {
          kind: "list",
          items: [
            "It reads OpenRouter's live model catalog (cached for six hours) and keeps only the free models that support tool calling, the one capability an agent cannot work without.",
            "It ranks the free ones by a documented heuristic over what the catalog exposes (reasoning support, model size, context). That is not a benchmark, and ShelraCode does not present it as one.",
            "It routes to the best candidate, then the second, then `openrouter/free`, OpenRouter's own router, which picks a free model at request time: a busy model gives way to another free one instead of failing.",
            "A model you pin with `shelra models use <id>` or `--model` wins. A saved paid model is ignored under the free policy.",
            "A price the catalog does not report is treated as unknown, never as free.",
          ],
        },
      ],
    },
    {
      id: "when-it-says-no",
      heading: "When the free tier says no",
      blocks: [
        {
          kind: "p",
          text: "A rate limit, an overloaded model or a stalled stream does not end the turn. The finished steps are kept, the round is retried after a pause, and after two failures in a row it moves to the next fallback. If no model answers for many attempts, the turn pauses with its progress saved and says how to resume. Only Esc ends a turn.",
        },
        {
          kind: "p",
          text: "For work a daily limit would cut short, run [the same agent on your own hardware](/local): local mode has no request limit.",
        },
      ],
    },
    {
      id: "paying",
      heading: "When you choose to pay",
      blocks: [
        {
          kind: "p",
          text: "Paid routing is opt-in, with `--model-policy auto`, `economy`, `balanced`, `quality` or `max`. Spending caps run before each request is sent:",
        },
        { kind: "code", lines: ["$ shelra --model-policy economy --max-cost 5 --max-request-cost 0.25"] },
        {
          kind: "p",
          text: "`--max-cost` caps the whole session in dollars and `--max-request-cost` a single request; a cap of `0` allows only requests the catalog prices at zero. When a price is unknown and a cap is set, the request is blocked until you refresh the catalog (`shelra models --refresh`).",
        },
      ],
    },
    {
      id: "results",
      heading: "What free models have shown so far",
      blocks: [{ kind: "data", name: "free-model-results" }],
    },
  ],
  action: { label: "Read the routing design", href: links.routingDesign },
};

export const guides: Guide[] = [memoryGuide, localGuide, freeModelsGuide];
