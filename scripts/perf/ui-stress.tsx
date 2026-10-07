/**
 * Responsiveness harness: mounts the REAL <App> on a REAL Agent (only the model is scripted) in OpenTUI's
 * test renderer, drives it through the composer like a user, and records what the user would feel:
 * event-loop stalls, React commits, terminal frames, input-to-screen latency, CPU and memory.
 *
 *   bun run scripts/perf/ui-stress.tsx                      # prints a table
 *   SHELRA_PERF_OUT=out.json SHELRA_PERF_WARM=120 bun run scripts/perf/ui-stress.tsx
 *
 * Knobs (env): SHELRA_PERF_SIZE=120x40, SHELRA_PERF_WARM=<turns of prior history>, SHELRA_PERF_SPEED=<delay
 * multiplier of the stress turn>, SHELRA_PERF_REPEAT=<measured turns>, SHELRA_PERF_LABEL, SHELRA_PERF_OUT.
 * HOME/USERPROFILE point at a scratch folder: nothing of the owner's profile is read or written.
 */

import { samplingProfilerStackTraces, startSamplingProfiler } from "bun:jsc";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import { createElement, Profiler } from "react";

const OUT = process.env.SHELRA_PERF_OUT ? resolvePath(process.env.SHELRA_PERF_OUT) : undefined;
const scratch = mkdtempSync(join(tmpdir(), "shelra-perf-"));
const home = join(scratch, "home");
const dir = join(scratch, "project");
mkdirSync(home, { recursive: true });
mkdirSync(dir, { recursive: true });
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.SHELRA_TRACE = process.env.SHELRA_TRACE ?? "off";
process.env.SHELRA_PERF_PROBE = "1";
process.env.GIT_CEILING_DIRECTORIES = dirname(dir);

// Every synchronous child process the product starts holds the event loop until it exits: count them and time them.
const syncSpawns = new Map<string, { calls: number; ms: number; maxMs: number }>();
{
  const cp = (await import("node:child_process")).default as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const name of ["spawnSync", "execSync", "execFileSync"] as const) {
    const original = cp[name];
    if (!original) continue;
    cp[name] = (...args: unknown[]) => {
      const started = performance.now();
      try {
        return original.apply(cp, args);
      } finally {
        const took = performance.now() - started;
        const first = String(args[0] ?? "");
        const rest = Array.isArray(args[1]) ? (args[1] as string[]) : [];
        const label =
          `${name} ${first.split(" ")[0]} ${rest.find((a) => !a.startsWith("-") && a !== "-C" && !a.includes("/") && !a.includes("\\")) ?? ""}`.trim();
        const entry = syncSpawns.get(label) ?? { calls: 0, ms: 0, maxMs: 0 };
        entry.calls += 1;
        entry.ms += took;
        entry.maxMs = Math.max(entry.maxMs, took);
        syncSpawns.set(label, entry);
      }
    };
  }
}

const { createTestRenderer } = await import("@opentui/core/testing");
const { createRoot } = await import("@opentui/react");
const { Agent } = await import("../../src/agent/agent");
const { App } = await import("../../src/ui/app");
const { createFixture } = await import("../ui-demo/fixture");
const { ScriptedProvider } = await import("../ui-demo/scripted-provider");
const { heavyTurn, lightTurn } = await import("./stress-scenarios");
const { perfSnapshot } = await import("../../src/utils/perf-probe");

process.chdir(dir);
createFixture(dir);
// A real project is a git repository: the product asks git about it every turn.
if (process.env.SHELRA_PERF_NOGIT !== "1") {
  const git = (...args: string[]) =>
    Bun.spawnSync(["git", "-c", "user.name=perf", "-c", "user.email=perf@example.com", ...args], { cwd: dir });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "fixture");
}
// The demo project ships failing tests; here they pass, so the completion gate stays quiet and every scripted
// turn is consumed by the request it was written for.
{
  const authPath = join(dir, "src", "auth.ts");
  const fixed = readFileSync(authPath, "utf8")
    .replace("session.expiresAt < now;", "session.expiresAt <= now;")
    .replace("token: session.token, expiresAt", 'token: "tok_" + now.toString(36), expiresAt');
  writeFileSync(authPath, fixed, "utf8");
}

const [WIDTH, HEIGHT] = (process.env.SHELRA_PERF_SIZE ?? "120x40").split("x").map(Number) as [number, number];
const WARM = Number(process.env.SHELRA_PERF_WARM ?? 0);
const SPEED = Number(process.env.SHELRA_PERF_SPEED ?? 1);
const REPEAT = Number(process.env.SHELRA_PERF_REPEAT ?? 1);
const LABEL = process.env.SHELRA_PERF_LABEL ?? "run";
const now = () => performance.now();
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

const MODEL = {
  id: "qwen/qwen3-coder:free",
  name: "Qwen3 Coder",
  contextWindow: 262_144,
  inputPrice: 0,
  outputPrice: 0,
  pricingKnown: true,
  reasoning: false,
  description: "Free cloud model routed through OpenRouter",
  supportsClientTools: true,
  category: "cloud" as const,
  provider: "OpenRouter",
};

// Every turn the harness will request, in order: warm-up history first, then the measured turns.
const turns = [
  ...Array.from({ length: WARM }, (_, i) => lightTurn(i)),
  // The model takes a while to answer: the UI only shows its "waiting" state.
  [[{ wait: 3000 }, { say: "WAITDONE: finally." }]],
  ...Array.from({ length: REPEAT + 1 }, (_, i) => heavyTurn({ marker: `STRESS${i}` })),
  // One more heavy turn to cancel, then a short one that must still answer.
  heavyTurn({ marker: "CANCELLED" }),
  [[{ say: "AFTERCANCEL: ready again." }]],
];
const providerOptions = { turns, model: MODEL, speed: 0 };
const provider = new ScriptedProvider(providerOptions);
const agent = new Agent(undefined, undefined, MODEL.id, 24, {
  provider,
  persistSession: true,
  cwd: dir,
  sandboxMode: "off",
});

// What the UI asks the agent for from its render path: calls and the time they take, per method.
const agentCalls: Record<string, { calls: number; ms: number; maxMs: number }> = {};
for (const name of [
  "getContextStats",
  "getSessionUsage",
  "getKernelState",
  "getDelegations",
  "getContextSummary",
  "getVerificationStatus",
  "getChatEntries",
  "consumeBackgroundNotifications",
] as const) {
  // biome-ignore lint/suspicious/noExplicitAny: measurement wrapper over arbitrary agent methods
  const target = agent as any;
  const original = target[name]?.bind(agent);
  if (!original) continue;
  agentCalls[name] = { calls: 0, ms: 0, maxMs: 0 };
  target[name] = (...args: unknown[]) => {
    const t = performance.now();
    const result = original(...args);
    const took = performance.now() - t;
    const c = agentCalls[name] as { calls: number; ms: number; maxMs: number };
    c.calls += 1;
    c.ms += took;
    c.maxMs = Math.max(c.maxMs, took);
    return result;
  };
}

const test = await createTestRenderer({
  width: WIDTH,
  height: HEIGHT,
  exitOnCtrlC: false,
  useMouse: true,
  ...(process.env.SHELRA_PERF_MAXFPS ? { maxFps: Number(process.env.SHELRA_PERF_MAXFPS) } : {}),
});
const { renderer, mockInput, mockMouse, captureCharFrame } = test;

// ── Instrumentation ────────────────────────────────────────────────────────────────────────────
interface Sample {
  t: number;
  v: number;
}
const lag: Sample[] = [];
const commits: Sample[] = [];
const frames: Sample[] = [];
const probes: { t: number; label: string; ms: number }[] = [];
const resources: { t: number; rss: number; heap: number; cpuMs: number }[] = [];
const phases: { name: string; t0: number; t1: number }[] = [];
const PROFILE = process.env.SHELRA_PERF_PROFILE === "1";
if (PROFILE) startSamplingProfiler();
const t0Run = now();

const LAG_TICK = 4;
let lastTick = now();
const lagTimer = setInterval(() => {
  const t = now();
  lag.push({ t, v: Math.max(0, t - lastTick - LAG_TICK) });
  lastTick = t;
}, LAG_TICK);

let cpuPrev = process.cpuUsage();
const resourceTimer = setInterval(() => {
  const cpu = process.cpuUsage(cpuPrev);
  cpuPrev = process.cpuUsage();
  const m = process.memoryUsage();
  resources.push({ t: now(), rss: m.rss, heap: m.heapUsed, cpuMs: (cpu.user + cpu.system) / 1000 });
}, 250);

// A frame is layout + paint into the cell buffer + the native diff; React work is counted by the Profiler.
// biome-ignore lint/suspicious/noExplicitAny: instrumenting OpenTUI internals for measurement only
const anyRenderer = renderer as any;
const rootRender = anyRenderer.root.render.bind(anyRenderer.root);
let frameStart = 0;
anyRenderer.root.render = (...args: unknown[]) => {
  frameStart = now();
  return rootRender(...args);
};
const renderNative = anyRenderer.renderNative.bind(anyRenderer);
anyRenderer.renderNative = () => {
  const r = renderNative();
  frames.push({ t: now(), v: now() - frameStart });
  return r;
};

function onRender(_id: string, _phase: string, actualDuration: number) {
  commits.push({ t: now(), v: actualDuration });
}

// ── Mount ──────────────────────────────────────────────────────────────────────────────────────
const root = createRoot(renderer);
root.render(
  createElement(
    Profiler,
    { id: "app", onRender },
    createElement(App, {
      agent,
      startupConfig: {
        apiKey: "demo",
        baseURL: "https://openrouter.ai/api/v1",
        model: MODEL.id,
        localModels: [MODEL],
        onSelectLocalModel: async () => ({ success: true }),
        modelMode: "free",
        onSetModelMode: async () => ({ success: true }),
        maxToolRounds: 24,
        sandboxMode: "off",
        sandboxSettings: undefined,
        version: "perf",
      },
      onExit: () => {},
    }),
  ),
);

// ── Helpers ────────────────────────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const tick = () => new Promise<void>((r) => setImmediate(r));

async function waitFor(check: () => boolean, timeoutMs: number, what: string): Promise<number> {
  const start = now();
  while (!check()) {
    if (now() - start > timeoutMs) {
      console.error(
        captureCharFrame()
          .split(String.fromCharCode(10))
          .filter((l) => l.trim())
          .slice(0, 30)
          .join(String.fromCharCode(10)),
      );
      throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    }
    await sleep(2);
  }
  return now() - start;
}

async function send(text: string) {
  await mockInput.typeText(text);
  await mockInput.pressEnter();
}

/** Typing latency: from the key event until the character is on screen. */
let probeSeq = 0;
async function probeTyping(): Promise<number> {
  const mark = "Ж";
  const before = captureCharFrame().split(mark).length - 1;
  const t = now();
  await mockInput.typeText(mark);
  await waitFor(() => captureCharFrame().split(mark).length - 1 > before, 5000, "typed char on screen");
  const ms = now() - t;
  probes.push({ t, label: "type", ms });
  probeSeq += 1;
  return ms;
}

async function probeScroll(direction: "up" | "down"): Promise<number> {
  const startFrames = frames.length;
  const t = now();
  await mockMouse.scroll(Math.floor(WIDTH / 2), Math.floor(HEIGHT / 2), direction);
  await waitFor(() => frames.length > startFrames, 5000, "a frame after the scroll");
  const ms = now() - t;
  probes.push({ t, label: `scroll-${direction}`, ms });
  return ms;
}

async function clearComposer() {
  for (let i = 0; i < probeSeq + 2; i += 1) await mockInput.pressBackspace();
  probeSeq = 0;
}

const probeDeltas: Record<string, Record<string, { calls: number; totalMs: number }>> = {};
async function phase<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const before = perfSnapshot();
  const t0 = now();
  try {
    return await fn();
  } finally {
    phases.push({ name, t0, t1: now() });
    const after = perfSnapshot();
    probeDeltas[name] = Object.fromEntries(
      Object.entries(after).map(([k, v]) => [
        k,
        {
          calls: v.calls - (before[k]?.calls ?? 0),
          totalMs: Math.round((v.totalMs - (before[k]?.totalMs ?? 0)) * 10) / 10,
        },
      ]),
    );
  }
}

// biome-ignore lint/suspicious/noExplicitAny: walking OpenTUI's tree to reach the log's scroll box
function findScrollBox(node: any): any {
  // biome-ignore lint/suspicious/noExplicitAny: same
  const boxes: any[] = [];
  // biome-ignore lint/suspicious/noExplicitAny: same
  const walk = (n: any) => {
    if (n?.constructor?.name === "ScrollBoxRenderable") boxes.push(n);
    for (const child of n?.getChildren?.() ?? []) walk(child);
  };
  walk(node);
  // The log is the tallest scroll box.
  return boxes.sort((x, y) => y.scrollHeight - x.scrollHeight)[0] ?? null;
}
const earlierLine = () => /▸ (\d+) earlier/.exec(captureCharFrame());

/**
 * The reader keeps scrolling up until nothing earlier is left. Every page must mount, and the line the reader
 * was looking at must stay where it was (the view is anchored, so scrollTop grows by what was added).
 */
async function readHistoryToTop() {
  const box = findScrollBox(anyRenderer.root);
  if (!box) throw new Error("log scroll box not found");
  const loads: { ms: number; nodes: number; anchored: boolean }[] = [];
  let guard = 0;
  while (guard < 80) {
    guard += 1;
    const heightBefore = box.scrollHeight;
    const nodesBefore = countTree(anyRenderer.root).nodes;
    const t = now();
    box.scrollBy(-1_000_000);
    if (guard < 3)
      console.error(
        "scrolled up: top",
        box.scrollTop,
        "manual",
        box._hasManualScroll,
        "listeners",
        box.verticalScrollBar.listenerCount("change"),
        "earlier line",
        !!earlierLine(),
        JSON.stringify(perfSnapshot()),
      );
    const startFrames = frames.length;
    // No frame follows a scroll that changes nothing (already at the top).
    await Promise.race([waitFor(() => frames.length > startFrames, 5000, "a frame after scrolling up"), sleep(400)]);
    await sleep(120);
    const grown = box.scrollHeight - heightBefore;
    const nodesAfter = countTree(anyRenderer.root).nodes;
    if (nodesAfter > nodesBefore) {
      // A page mounted: the view must sit `grown` lines down, i.e. on the same content as before.
      loads.push({
        ms: round(now() - t),
        nodes: nodesAfter,
        anchored: Math.abs(box.scrollTop - grown) <= 2,
        top: box.scrollTop,
        grown,
        probe: Object.fromEntries(
          Object.entries(perfSnapshot())
            .filter(([k]) => k.startsWith("window."))
            .map(([k, v]) => [k, v.calls]),
        ),
      });
      continue;
    }
    if (box.scrollTop === 0 && !earlierLine()) break;
  }
  return { loads, topReached: box.scrollTop === 0 && !earlierLine(), scrollTopAtEnd: box.scrollTop };
}

const frameHas = (s: string) => captureCharFrame().includes(s);
/** The composer says so while a turn runs (it queues follow-ups); this does not depend on where the log is scrolled. */
const busy = () => frameHas("Queue a follow-up") || frameHas("esc stop");
/** A turn that started and ended: the viewport can be anywhere, since the reader may be scrolling. */
async function turnFinished(label: string, timeoutMs: number) {
  await waitFor(busy, 30_000, `${label} to start`);
  await waitFor(() => !busy(), timeoutMs, `${label} to finish`);
}
const probeEvery = async (stop: () => boolean, intervalMs = 120) => {
  let n = 0;
  while (!stop()) {
    await sleep(intervalMs);
    if (stop()) break;
    n += 1;
    if (n % 3 === 0) await probeScroll(n % 2 ? "up" : "down");
    else await probeTyping();
  }
};

// ── Scenario ───────────────────────────────────────────────────────────────────────────────────
let failure: string | null = null;
let historyResult: unknown = null;
/** Heap census by constructor/type: what a snapshot holds, summed, so two snapshots can be subtracted. */
function heapCensus(): Map<string, { count: number; bytes: number }> {
  const snapshot = JSON.parse(Bun.generateHeapSnapshot("v8") as unknown as string) as {
    snapshot: { meta: { node_fields: string[]; node_types: (string | string[])[] } };
    nodes: number[];
    strings: string[];
  };
  const fields = snapshot.snapshot.meta.node_fields;
  const stride = fields.length;
  const typeIndex = fields.indexOf("type");
  const nameIndex = fields.indexOf("name");
  const sizeIndex = fields.indexOf("self_size");
  const types = snapshot.snapshot.meta.node_types[0] as string[];
  const census = new Map<string, { count: number; bytes: number }>();
  for (let i = 0; i < snapshot.nodes.length; i += stride) {
    const type = types[snapshot.nodes[i + typeIndex] as number] ?? "?";
    const name =
      type === "string" || type === "concatenated string"
        ? "(string)"
        : (snapshot.strings[snapshot.nodes[i + nameIndex] as number] ?? "?").slice(0, 60);
    const key = `${type}:${name}`;
    const entry = census.get(key) ?? { count: 0, bytes: 0 };
    entry.count += 1;
    entry.bytes += snapshot.nodes[i + sizeIndex] as number;
    census.set(key, entry);
  }
  return census;
}
let censusEarly: ReturnType<typeof heapCensus> | null = null;
let growth: string[] = [];
const memorySeries: { turn: number; rssMB: number; heapMB: number; nodes: number }[] = [];
try {
  await sleep(300);
  await renderer.idle();

  if (WARM > 0) {
    await phase("warm-history", async () => {
      for (let i = 0; i < WARM; i += 1) {
        await send(`warm ${i}`);
        await turnFinished(`warm turn ${i}`, 60_000);
      }
      await renderer.idle();
    });
  }

  let history: Awaited<ReturnType<typeof readHistoryToTop>> | null = null;
  if (WARM > 0) {
    const mountedBefore = countTree(anyRenderer.root).nodes;
    history = await phase("history-to-top", readHistoryToTop);
    (history as Record<string, unknown>).nodesWhileFollowingEnd = mountedBefore;
    (history as Record<string, unknown>).nodesAtTop = countTree(anyRenderer.root).nodes;
    // Back to the end of the log, as a reader returning to the conversation.
    findScrollBox(anyRenderer.root)?.scrollTo(findScrollBox(anyRenderer.root).scrollHeight);
    await sleep(200);
    await renderer.idle();
  }
  historyResult = history;

  providerOptions.speed = SPEED;
  await phase("quiet-idle", async () => {
    await renderer.idle();
    await sleep(3000);
  });
  await phase("waiting-model", async () => {
    await send("wait for the model");
    await turnFinished("the waiting turn", 60_000);
    await renderer.idle();
  });
  // First heavy turn is a warm-up of JIT, tools and caches; measured turns follow.
  await send("warm up the heavy turn");
  await turnFinished("the warm-up turn", 180_000);
  await renderer.idle();
  await sleep(500);

  for (let r = 1; r <= REPEAT; r += 1) {
    await phase(`stress-${r}-idle`, async () => {
      for (let i = 0; i < 6; i += 1) {
        await probeTyping();
        await sleep(60);
      }
      await clearComposer();
    });

    await phase(`stress-${r}-turn`, async () => {
      await send(`stress turn ${r}`);
      let finished = false;
      const done = () => finished;
      const interact = probeEvery(done);
      await turnFinished(`stress turn ${r}`, 240_000);
      finished = true;
      await interact;
      await clearComposer();
    });

    await renderer.idle();
    // What is still held once the turn is over and the garbage is collected: a leak shows as a climb here.
    Bun.gc(true);
    await sleep(150);
    const held = process.memoryUsage();
    if (process.env.SHELRA_PERF_HEAP === "1") {
      if (r === 2) censusEarly = heapCensus();
      if (r === REPEAT && censusEarly) {
        const late = heapCensus();
        growth = [...late.entries()]
          .map(([key, v]) => ({
            key,
            bytes: v.bytes - (censusEarly?.get(key)?.bytes ?? 0),
            count: v.count - (censusEarly?.get(key)?.count ?? 0),
          }))
          .sort((a, b) => b.bytes - a.bytes)
          .slice(0, 25)
          .map((g) => `${Math.round(g.bytes / 1024)} KB  +${g.count}  ${g.key}`);
      }
    }
    memorySeries.push({
      turn: r,
      rssMB: round(held.rss / 1048576, 0),
      heapMB: round(held.heapUsed / 1048576, 1),
      nodes: countTree(anyRenderer.root).nodes,
    });
  }

  // Cancellation: start the heavy turn, press Escape in the middle of it, then talk again.
  await phase("cancel", async () => {
    await renderer.idle();
    await send("cancel me");
    await waitFor(() => frameHas("Thinking") || frameHas("Writing response"), 30_000, "the cancelled turn to stream");
    await sleep(900);
    for (const [w, h] of [
      [WIDTH - 20, HEIGHT - 8],
      [WIDTH + 10, HEIGHT + 4],
      [WIDTH, HEIGHT],
    ] as const) {
      const t = now();
      test.resize(w, h);
      const before = frames.length;
      await waitFor(() => frames.length > before, 5000, "a frame after resize");
      probes.push({ t, label: "resize", ms: now() - t });
      await sleep(80);
    }
    const t = now();
    await mockInput.pressEscape();
    await waitFor(() => !busy(), 15_000, "the turn to stop");
    probes.push({ t, label: "cancel", ms: now() - t });
    await renderer.idle();
  });

  await phase("after-cancel", async () => {
    await send("are you still there");
    await turnFinished("the turn after cancel", 60_000);
    await renderer.idle();
  });
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
}

clearInterval(lagTimer);
clearInterval(resourceTimer);
const tEnd = now();
Bun.gc(true);
await sleep(200);
const finalMem = process.memoryUsage();
const frameText = captureCharFrame();

// ── Report ─────────────────────────────────────────────────────────────────────────────────────
function pct(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

function summarize(from: number, to: number) {
  const inRange = <T extends { t: number }>(xs: T[]) => xs.filter((x) => x.t >= from && x.t <= to);
  const dur = Math.max(1, to - from);
  const lags = inRange(lag).map((s) => s.v);
  const cs = inRange(commits);
  const fs = inRange(frames);
  const ps = probes.filter((p) => p.t >= from && p.t <= to);
  const typing = ps.filter((p) => p.label === "type").map((p) => p.ms);
  const scroll = ps.filter((p) => p.label.startsWith("scroll")).map((p) => p.ms);
  const res = inRange(resources);
  const cpu = res.reduce((a, r) => a + r.cpuMs, 0);
  return {
    seconds: round(dur / 1000),
    loopLagMaxMs: round(Math.max(0, ...lags)),
    loopLagP99Ms: round(pct(lags, 99)),
    stallsOver50ms: lags.filter((v) => v > 50).length,
    stallsOver250ms: lags.filter((v) => v > 250).length,
    stalledMs: round(
      lags.filter((v) => v > 16).reduce((a, b) => a + b, 0),
      0,
    ),
    commitsPerSec: round(cs.length / (dur / 1000)),
    commitMsAvg: round(cs.length ? cs.reduce((a, c) => a + c.v, 0) / cs.length : 0, 2),
    commitMsMax: round(Math.max(0, ...cs.map((c) => c.v))),
    framesPerSec: round(fs.length / (dur / 1000)),
    frameMsAvg: round(fs.length ? fs.reduce((a, f) => a + f.v, 0) / fs.length : 0, 2),
    frameMsMax: round(Math.max(0, ...fs.map((f) => f.v))),
    cpuPercent: round((cpu / dur) * 100, 0),
    typingMsP50: round(pct(typing, 50)),
    typingMsMax: round(Math.max(0, ...typing)),
    typingN: typing.length,
    scrollMsP50: round(pct(scroll, 50)),
    scrollMsMax: round(Math.max(0, ...scroll)),
    scrollN: scroll.length,
    rssMB: round(Math.max(0, ...res.map((r) => r.rss)) / 1048576, 0),
    heapMB: round(Math.max(0, ...res.map((r) => r.heap)) / 1048576, 0),
  };
}

/** How big the renderable tree is: every node costs layout and traversal on every frame. */
function countTree(node: { getChildren?: () => unknown[] }): { nodes: number; maxChildren: number } {
  let nodes = 0;
  let maxChildren = 0;
  const walk = (n: { getChildren?: () => unknown[] }) => {
    nodes += 1;
    const kids = (n.getChildren?.() ?? []) as { getChildren?: () => unknown[] }[];
    maxChildren = Math.max(maxChildren, kids.length);
    for (const k of kids) walk(k);
  };
  walk(node);
  return { nodes, maxChildren };
}

const report = {
  label: LABEL,
  size: `${WIDTH}x${HEIGHT}`,
  warmTurns: WARM,
  repeat: REPEAT,
  speed: SPEED,
  failure,
  whole: summarize(t0Run, tEnd),
  phases: Object.fromEntries(phases.map((p) => [p.name, summarize(p.t0, p.t1)])),
  singles: Object.fromEntries(
    ["resize", "cancel"].map((label) => [label, probes.filter((p) => p.label === label).map((p) => round(p.ms))]),
  ),
  tree: countTree(anyRenderer.root),
  syncSpawns: Object.fromEntries(
    [...syncSpawns].map(([k, v]) => [k, { calls: v.calls, totalMs: round(v.ms), maxMs: round(v.maxMs) }]),
  ),
  memorySeries,
  heapGrowthBetweenTurn2AndLast: growth,
  history: historyResult,
  probes: probeDeltas,
  probeTotals: perfSnapshot(),
  agentCalls: Object.fromEntries(
    Object.entries(agentCalls).map(([k, v]) => [k, { calls: v.calls, totalMs: round(v.ms), maxMs: round(v.maxMs, 2) }]),
  ),
  memoryAfterGcMB: { rss: round(finalMem.rss / 1048576, 0), heap: round(finalMem.heapUsed / 1048576, 0) },
  lastFrameTail: frameText
    .split("\n")
    .filter((l) => l.trim())
    .slice(-3),
};

// ── Optional CPU profile (JSC sampling profiler): where the samples of a phase went ────────────
interface JscFrame {
  name: string;
  sourceURL: string;
}
interface JscData {
  interval: number;
  traces: { timestamp: number; frames: JscFrame[] }[];
}
function profileTop(data: JscData, fromMs: number, toMs: number, offset: number) {
  const self = new Map<string, number>();
  const inclusive = new Map<string, number>();
  const appInclusive = new Map<string, number>();
  const appSelf = new Map<string, number>();
  let total = 0;
  const isApp = (f: JscFrame) => {
    const url = (f.sourceURL ?? "").split(String.fromCharCode(92)).join("/");
    return /\/(src|scripts)\//.test(url) && !url.includes("node_modules");
  };
  const label = (f: JscFrame) => `${f.name || "(anonymous)"} ${(f.sourceURL ?? "").split(/[\\/]/).slice(-2).join("/")}`;
  for (const trace of data.traces) {
    const t = (trace.timestamp - offset) * 1000;
    if (t < fromMs || t > toMs || trace.frames.length === 0) continue;
    total += 1;
    const leaf = trace.frames[0];
    if (leaf) self.set(label(leaf), (self.get(label(leaf)) ?? 0) + 1);
    for (const key of new Set(trace.frames.map(label))) inclusive.set(key, (inclusive.get(key) ?? 0) + 1);
    for (const key of new Set(trace.frames.filter(isApp).map(label)))
      appInclusive.set(key, (appInclusive.get(key) ?? 0) + 1);
    // The nearest product frame owns the sample: that is the code a change can reach.
    const owner = trace.frames.find(isApp);
    if (owner) appSelf.set(label(owner), (appSelf.get(label(owner)) ?? 0) + 1);
  }
  const top = (m: Map<string, number>, n: number) =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k, v]) => `${round((v / Math.max(1, total)) * 100)}%  ${k}`);
  return {
    samples: total,
    intervalMs: data.interval * 1000,
    self: top(self, 22),
    inclusive: top(inclusive, 30),
    appInclusive: top(appInclusive, 40),
    appOwner: top(appSelf, 30),
  };
}
if (PROFILE) {
  const data = samplingProfilerStackTraces() as unknown as JscData;
  const traces = data.traces;
  const last = traces[traces.length - 1];
  // JSC timestamps are in seconds on its own clock: align the last sample with "now".
  const offset = last ? last.timestamp - now() / 1000 : 0;
  const wanted = ["whole", ...phases.map((p) => p.name)];
  const out: Record<string, ReturnType<typeof profileTop>> = {};
  for (const name of wanted) {
    const p = phases.find((x) => x.name === name);
    out[name] = profileTop(data, p ? p.t0 : t0Run, p ? p.t1 : tEnd, offset);
  }
  (report as Record<string, unknown>).profile = out;
}

console.log(JSON.stringify(report, null, 2));
if (OUT) writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);

try {
  renderer.destroy();
  await agent.cleanup();
} catch {
  /* measurement is already written */
}
try {
  rmSync(scratch, { recursive: true, force: true });
} catch {
  /* the session database can still be open on Windows */
}
// A profile (`bun --cpu-prof`) is written on a natural exit, not on process.exit().
if (process.env.SHELRA_PERF_NATURAL_EXIT === "1") process.exitCode = failure ? 1 : 0;
else process.exit(failure ? 1 : 0);
