import { APICallError } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import { describeLimit, limitFromError, parseDuration } from "./limits";

const now = new Date("2026-09-24T22:30:00.000Z");

function tooMany(body: string, headers: Record<string, string> = {}): APICallError {
  return new APICallError({
    message: "Rate limit exceeded",
    url: "https://example.test/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 429,
    responseHeaders: headers,
    responseBody: body,
  });
}

describe("a provider's free allowance, used up", () => {
  it("reads OpenRouter's reset from the header, the error body, or its UTC day", () => {
    const header = limitFromError(
      "openrouter",
      tooMany('{"error":{"message":"Rate limit exceeded: free-models-per-day"}}', {
        "X-RateLimit-Reset": String(Date.parse("2026-09-25T00:00:00.000Z")),
      }),
      now,
    );
    expect(header).toMatchObject({ provider: "openrouter", estimated: false });
    expect(header?.resetsAt?.toISOString()).toBe("2026-09-25T00:00:00.000Z");

    const body = limitFromError(
      "openrouter",
      tooMany(
        '{"error":{"message":"Rate limit exceeded: free-models-per-day","metadata":{"headers":{"X-RateLimit-Reset":"1790294400000"}}}}',
      ),
      now,
    );
    expect(body?.resetsAt?.getTime()).toBe(1790294400000);

    const documented = limitFromError("openrouter", new Error("Rate limit exceeded: free-models-per-day"), now);
    expect(documented).toMatchObject({ estimated: true });
    expect(documented?.resetsAt?.toISOString()).toBe("2026-09-25T00:00:00.000Z");
  });

  it("reads Groq's daily reset, and counts Gemini's day in Pacific time and Cloudflare's in UTC", () => {
    const groq = limitFromError(
      "groq",
      tooMany("Rate limit reached for requests per day (RPD)", {
        "retry-after": "5",
        "x-ratelimit-reset-requests": "2h30m",
      }),
      now,
    );
    expect(groq?.resetsAt?.toISOString()).toBe("2026-09-25T01:00:00.000Z");

    const gemini = limitFromError("gemini", tooMany('{"error":{"status":"RESOURCE_EXHAUSTED"}}'), now);
    // 22:30 UTC is 15:30 in Los Angeles (PDT, UTC-7): the next Pacific midnight is 07:00 UTC.
    expect(gemini?.resetsAt?.toISOString()).toBe("2026-09-25T07:00:00.000Z");

    const cloudflare = limitFromError(
      "cloudflare",
      tooMany("you have used up your daily free allocation of neurons"),
      now,
    );
    expect(cloudflare?.resetsAt?.toISOString()).toBe("2026-09-25T00:00:00.000Z");
  });

  it("leaves a burst a retry gets past, and any other failure, to the usual recovery", () => {
    expect(limitFromError("openrouter", tooMany("Rate limit exceeded", { "retry-after": "20" }), now)).toBeNull();
    expect(limitFromError("openrouter", new Error("No endpoints found for vendor/model"), now)).toBeNull();
    expect(
      limitFromError(
        "openrouter",
        new APICallError({ message: "Unauthorized", url: "u", requestBodyValues: {}, statusCode: 401 }),
        now,
      ),
    ).toBeNull();
  });

  it("finds the provider error inside the SDK's retry wrapper, and says when to come back", () => {
    const wrapped = Object.assign(new Error("Failed after 3 attempts"), {
      lastError: tooMany("Rate limit exceeded: free-models-per-day"),
    });
    const limit = limitFromError("openrouter", wrapped, now);
    expect(limit).not.toBeNull();
    expect(describeLimit(limit as never)).toMatch(
      /^OpenRouter's free models reached the limit of the free plan; it resets around /,
    );
  });

  it("parses the durations providers send", () => {
    expect(parseDuration("2m59.56s")).toBe(179_560);
    expect(parseDuration("7.66s")).toBe(7_660);
    expect(parseDuration("1h2m")).toBe(3_720_000);
    expect(parseDuration("30")).toBe(30_000);
    expect(parseDuration("soon")).toBeNull();
  });
});
