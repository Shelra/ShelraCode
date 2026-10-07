import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProviderRegistry } from "../providers/registry";
import { CatalogService } from "./catalog-service";
import { FakeControl, fakeDefinition, freeTier, publishedFree, resolveDepsFor } from "./test-fixtures";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })),
  );
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "shelra-catalog-"));
  dirs.push(dir);
  return dir;
}

function setup(
  configured: string[],
  options: {
    cacheDir?: string | null;
    ttlMs?: number;
    timeoutMs?: number;
    concurrency?: number;
    now?: () => number;
  } = {},
) {
  const controls = { a: new FakeControl(), b: new FakeControl(), c: new FakeControl() };
  const registry = new ProviderRegistry([
    fakeDefinition("a", [publishedFree("a", "one"), publishedFree("a", "two")], controls.a),
    fakeDefinition("b", [freeTier("b", "three")], controls.b),
    fakeDefinition("c", [publishedFree("c", "four")], controls.c),
  ]);
  const service = new CatalogService({
    registry,
    resolveDeps: resolveDepsFor(configured),
    cacheDir: options.cacheDir === undefined ? null : options.cacheDir,
    ...(options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs }),
    ...(options.timeoutMs === undefined ? {} : { discoveryTimeoutMs: options.timeoutMs }),
    ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
    ...(options.now ? { now: options.now } : {}),
  });
  return { controls, registry, service };
}

describe("CatalogService", () => {
  it("builds one catalog from every configured provider, in registration order", async () => {
    const { service } = setup(["a", "b", "c"]);
    expect(service.snapshot().entries).toEqual([]);
    await service.refresh();
    expect(service.snapshot().entries.map((entry) => entry.id)).toEqual(["a/one", "a/two", "b/three", "c/four"]);
    expect(service.status().map((row) => [row.providerId, row.status, row.modelCount])).toEqual([
      ["a", "ready", 2],
      ["b", "ready", 1],
      ["c", "ready", 1],
    ]);
  });

  it("does not ask a provider that is not configured, and says so", async () => {
    const { service, controls } = setup(["a"]);
    await service.refresh();
    expect(controls.b.discoveryCalls).toBe(0);
    expect(service.status().find((row) => row.providerId === "b")?.status).toBe("unconfigured");
  });

  it("asks providers at the same time, within the concurrency limit", async () => {
    const { service, controls } = setup(["a", "b", "c"], { concurrency: 2 });
    for (const control of Object.values(controls)) control.discoveryDelayMs = 60;
    const started = Date.now();
    await service.refresh();
    const elapsed = Date.now() - started;
    // Two at once, then the third: about two rounds, not three in sequence.
    expect(elapsed).toBeLessThan(170);
    expect(elapsed).toBeGreaterThanOrEqual(110);
  });

  it("shares one pass between overlapping refreshes", async () => {
    const { service, controls } = setup(["a"]);
    controls.a.discoveryDelayMs = 30;
    await Promise.all([service.refresh(), service.refresh(), service.refresh()]);
    expect(controls.a.discoveryCalls).toBe(1);
  });

  it("runs a forced pass after one that was not forced, since a key may have been added meanwhile", async () => {
    const { service, controls } = setup(["a"]);
    controls.a.discoveryDelayMs = 30;
    await Promise.all([service.refresh(), service.refresh({ force: true })]);
    expect(controls.a.discoveryCalls).toBe(2);
    // Forced passes that overlap each other still share one.
    await Promise.all([service.refresh({ force: true }), service.refresh({ force: true })]);
    expect(controls.a.discoveryCalls).toBe(3);
  });

  it("does not ask again within the TTL, and does after it", async () => {
    let now = 1_000;
    const { service, controls } = setup(["a"], { ttlMs: 10_000, now: () => now });
    await service.refresh();
    await service.refresh();
    expect(controls.a.discoveryCalls).toBe(1);
    now += 10_001;
    await service.refresh();
    expect(controls.a.discoveryCalls).toBe(2);
    await service.refresh({ force: true });
    expect(controls.a.discoveryCalls).toBe(3);
  });

  it("gives up on a provider that does not answer in time and goes on with the others", async () => {
    const { service, controls } = setup(["a", "b"], { timeoutMs: 40 });
    controls.a.discoveryDelayMs = 5_000;
    const started = Date.now();
    await service.refresh();
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(service.entriesOf("a")).toEqual([]);
    expect(service.entriesOf("b")).toHaveLength(1);
    expect(service.status().find((row) => row.providerId === "a")).toMatchObject({ status: "unavailable" });
  });

  it("keeps the last good catalog when a provider stops answering, and recovers after the backoff", async () => {
    let now = 1_000_000;
    const { service, controls } = setup(["a"], { ttlMs: 1_000, now: () => now });
    await service.refresh();
    controls.a.discoveryFails = true;
    now += 2_000;
    await service.refresh();
    expect(service.entriesOf("a")).toHaveLength(2);
    const failed = service.status()[0];
    expect(failed).toMatchObject({ status: "stale", error: "catalog unavailable" });
    expect(failed?.nextAttemptAt).toBeGreaterThan(now);
    // Inside the backoff it is not asked again.
    const calls = controls.a.discoveryCalls;
    now += 1_000;
    await service.refresh();
    expect(controls.a.discoveryCalls).toBe(calls);
    controls.a.discoveryFails = false;
    now += 60_000;
    await service.refresh();
    expect(service.status()[0]).toMatchObject({ status: "ready" });
  });

  it("swaps a provider's models atomically and tells subscribers once", async () => {
    const { service } = setup(["a", "b", "c"]);
    let calls = 0;
    const seen: number[] = [];
    const stop = service.subscribe(() => {
      calls += 1;
      seen.push(service.snapshot().entries.length);
    });
    await service.refresh();
    expect(calls).toBe(1);
    // A reader never sees a partial pass: the first notification already has every provider.
    expect(seen[0]).toBe(4);
    stop();
    await service.refresh({ force: true });
    expect(calls).toBe(1);
  });

  it("drops a provider's models when it is no longer configured", async () => {
    const configured = ["a", "b"];
    const { registry } = setup(configured);
    const service = new CatalogService({
      registry,
      resolveDeps: () => resolveDepsFor(configured)(),
      cacheDir: null,
    });
    await service.refresh();
    expect(service.snapshot().entries).toHaveLength(3);
    configured.pop();
    await service.refresh();
    expect(service.snapshot().entries.map((entry) => entry.provider)).toEqual(["a", "a"]);
  });

  it("refuses a model that claims another provider's id", async () => {
    const registry = new ProviderRegistry([
      fakeDefinition("a", [publishedFree("a", "ok"), publishedFree("b", "impostor")], new FakeControl()),
    ]);
    const service = new CatalogService({ registry, resolveDeps: resolveDepsFor(["a"]), cacheDir: null });
    await service.refresh();
    expect(service.snapshot().entries.map((entry) => entry.id)).toEqual(["a/ok"]);
  });

  it("starts from the disk cache before any network call, then refreshes it", async () => {
    const cacheDir = await tempDir();
    const first = setup(["a", "b"], { cacheDir });
    await first.service.refresh();
    // The write is not awaited by refresh; give it a moment.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(JSON.parse(await readFile(join(cacheDir, "catalog-a.json"), "utf8")).entries).toHaveLength(2);

    const second = setup(["a", "b"], { cacheDir });
    expect(second.service.snapshot().entries).toEqual([]);
    await second.service.loadCached();
    expect(second.service.snapshot().entries).toHaveLength(3);
    expect(second.service.status()[0]?.status).toBe("stale");
    expect(second.controls.a.discoveryCalls).toBe(0);
    await second.service.refresh();
    expect(second.controls.a.discoveryCalls).toBe(1);
    expect(second.service.status()[0]?.status).toBe("ready");
  });

  it("ignores a corrupt cache file", async () => {
    const cacheDir = await tempDir();
    await writeFile(join(cacheDir, "catalog-a.json"), "{not json");
    const { service } = setup(["a"], { cacheDir });
    await service.loadCached();
    expect(service.snapshot().entries).toEqual([]);
  });

  it("bounds how many models one provider can add", async () => {
    const many = Array.from({ length: 50 }, (_, index) => publishedFree("a", `m${index}`));
    const registry = new ProviderRegistry([fakeDefinition("a", many, new FakeControl())]);
    const service = new CatalogService({
      registry,
      resolveDeps: resolveDepsFor(["a"]),
      cacheDir: null,
      maxEntriesPerProvider: 10,
    });
    await service.refresh();
    expect(service.snapshot().entries).toHaveLength(10);
  });

  it("waits for a pass in progress, but never longer than asked", async () => {
    const { service, controls } = setup(["a"]);
    controls.a.discoveryDelayMs = 400;
    void service.refresh();
    const started = Date.now();
    expect(await service.whenReady(50)).toBe(false);
    expect(Date.now() - started).toBeLessThan(300);
    expect(await service.whenReady(2_000)).toBe(true);
  });

  it("does not poll: an automatic refresh inside the TTL asks nobody", async () => {
    const { service, controls } = setup(["a"], { ttlMs: 60_000 });
    await service.refresh();
    service.startAutoRefresh(10);
    await new Promise((resolve) => setTimeout(resolve, 80));
    service.dispose();
    expect(controls.a.discoveryCalls).toBe(1);
  });
});
