import { APICallError } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import { classifyFailure, HealthTracker } from "./health";

function clock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const apiError = (statusCode: number, extra: Partial<ConstructorParameters<typeof APICallError>[0]> = {}) =>
  new APICallError({
    message: `HTTP ${statusCode}`,
    url: "https://x.invalid",
    requestBodyValues: {},
    statusCode,
    ...extra,
  });

describe("classifyFailure", () => {
  it("reads each kind of provider failure", () => {
    expect(classifyFailure("groq", apiError(429, { responseHeaders: { "retry-after": "20" } }))).toEqual({
      kind: "rate-limit",
      retryAfterMs: 20_000,
    });
    expect(classifyFailure("groq", apiError(401)).kind).toBe("credentials");
    expect(classifyFailure("groq", apiError(403)).kind).toBe("credentials");
    expect(classifyFailure("groq", apiError(402)).kind).toBe("quota");
    expect(classifyFailure("groq", apiError(404)).kind).toBe("model-unavailable");
    expect(classifyFailure("groq", apiError(503)).kind).toBe("unavailable");
    expect(classifyFailure("groq", new Error("fetch failed: ECONNREFUSED")).kind).toBe("unavailable");
    expect(classifyFailure("groq", new Error("something odd")).kind).toBe("other");
  });

  it("recognizes a spent daily allowance and when it returns", () => {
    const failure = classifyFailure(
      "groq",
      apiError(429, {
        responseBody: '{"error":{"message":"requests per day exceeded"}}',
        responseHeaders: { "retry-after": "7200" },
      }),
      new Date(0),
    );
    expect(failure.kind).toBe("quota");
    expect(failure.retryAfterMs).toBe(7_200_000);
  });

  it("never throws on a strange error", () => {
    expect(classifyFailure("x", undefined).kind).toBe("other");
    expect(classifyFailure("x", { weird: true }).kind).toBe("other");
  });
});

describe("HealthTracker", () => {
  it("skips a failed route until its cooldown passes, then takes it back", () => {
    const time = clock();
    const health = new HealthTracker({ now: time.now });
    expect(health.isAvailable("groq/a", "groq")).toBe(true);
    health.recordFailure("groq/a", "groq", { kind: "rate-limit" });
    expect(health.isAvailable("groq/a", "groq")).toBe(false);
    expect(health.cooldownRemaining("groq/a", "groq")).toBe(60_000);
    time.advance(59_999);
    expect(health.isAvailable("groq/a", "groq")).toBe(false);
    time.advance(2);
    expect(health.isAvailable("groq/a", "groq")).toBe(true);
  });

  it("backs off further for each failure in a row and clears on success", () => {
    const time = clock();
    const health = new HealthTracker({ now: time.now });
    health.recordFailure("x/a", "x", { kind: "unavailable" });
    expect(health.cooldownRemaining("x/a", "x")).toBe(30_000);
    time.advance(30_001);
    health.recordFailure("x/a", "x", { kind: "unavailable" });
    expect(health.cooldownRemaining("x/a", "x")).toBe(60_000);
    health.recordSuccess("x/a", "x", 400);
    expect(health.isAvailable("x/a", "x")).toBe(true);
    expect(health.view("x/a")?.failures).toBe(0);
  });

  it("obeys the wait a provider asks for", () => {
    const time = clock();
    const health = new HealthTracker({ now: time.now });
    health.recordFailure("x/a", "x", { kind: "rate-limit", retryAfterMs: 5_000 });
    expect(health.cooldownRemaining("x/a", "x")).toBe(5_000);
  });

  it("puts the whole provider on cooldown for a refused key or a spent quota", () => {
    const time = clock();
    const health = new HealthTracker({ now: time.now });
    health.recordFailure("gemini/a", "gemini", { kind: "credentials" });
    expect(health.isAvailable("gemini/b", "gemini")).toBe(false);
    expect(health.isAvailable("groq/a", "groq")).toBe(true);
    health.recordSuccess("gemini/b", "gemini");
    expect(health.isAvailable("gemini/c", "gemini")).toBe(true);
  });

  it("trips the provider breaker when several of its models fail in a row", () => {
    const time = clock();
    const health = new HealthTracker({ now: time.now });
    health.recordFailure("p/a", "p", { kind: "unavailable" });
    health.recordFailure("p/b", "p", { kind: "unavailable" });
    expect(health.isAvailable("p/c", "p")).toBe(true);
    health.recordFailure("p/c", "p", { kind: "unavailable" });
    expect(health.isAvailable("p/d", "p")).toBe(false);
  });

  it("does not let a missing model cool its provider down", () => {
    const time = clock();
    const health = new HealthTracker({ now: time.now });
    for (const id of ["a", "b", "c", "d"]) health.recordFailure(`p/${id}`, "p", { kind: "model-unavailable" });
    expect(health.isAvailable("p/other", "p")).toBe(true);
  });

  it("stays bounded however many routes fail", () => {
    const health = new HealthTracker({ now: clock().now });
    for (let index = 0; index < 5_000; index += 1)
      health.recordFailure(`p/${index}`, `q${index % 7}`, { kind: "other" });
    expect(health.size()).toBeLessThanOrEqual(512);
  });

  it("forgets one provider without touching the rest", () => {
    const health = new HealthTracker({ now: clock().now });
    health.recordFailure("a/x", "a", { kind: "credentials" });
    health.recordFailure("b/x", "b", { kind: "rate-limit" });
    health.reset("a");
    expect(health.isAvailable("a/x", "a")).toBe(true);
    expect(health.isAvailable("b/x", "b")).toBe(false);
  });
});

describe("HealthTracker.isTransient", () => {
  it("is true only for a passing fault, not for a spent quota, a rate limit or a refused key", () => {
    const health = new HealthTracker({ now: () => 1_000_000 });
    health.recordFailure("x/overloaded", "x", { kind: "unavailable" });
    health.recordFailure("x/other", "x", { kind: "other" });
    health.recordFailure("y/limited", "y", { kind: "rate-limit" });
    health.recordFailure("z/spent", "z", { kind: "quota" });
    health.recordFailure("w/key", "w", { kind: "credentials" });
    expect(health.isTransient("x/overloaded", "x")).toBe(true);
    expect(health.isTransient("x/other", "x")).toBe(true);
    expect(health.isTransient("y/limited", "y")).toBe(false);
    expect(health.isTransient("z/spent", "z")).toBe(false);
    expect(health.isTransient("w/key", "w")).toBe(false);
  });
});
