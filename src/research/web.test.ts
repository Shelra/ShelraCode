import { describe, expect, it, vi } from "vitest";
import { buildResearchQuery, openWebPage, searchWeb } from "./web";

describe("web research", () => {
  it("uses the configured Google Custom Search JSON API", async () => {
    const fetchImpl = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
        new Response(
          JSON.stringify({
            items: [{ title: "Official docs", link: "https://docs.example.test/api", snippet: "Primary reference" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );

    const result = await searchWeb("OpenRouter models", {
      googleApiKey: "secret-key",
      googleSearchEngineId: "engine-id",
      fetchImpl,
    });

    expect(result).toMatchObject({ provider: "google-api", success: true });
    expect(result.sources).toEqual([
      { title: "Official docs", url: "https://docs.example.test/api", snippet: "Primary reference" },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("cx=engine-id");
    expect(result.output).not.toContain("secret-key");
  });

  it("parses Google HTML results without credentials", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('<a href="https://docs.example.test/guide"><h3>Guide &amp; Reference</h3></a>', {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    );

    const result = await searchWeb("Shelra guide", { fetchImpl, maxResults: 3 });

    expect(result.provider).toBe("google");
    expect(result.sources).toEqual([{ title: "Guide & Reference", url: "https://docs.example.test/guide" }]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("prefers Tavily when configured, before Google or DuckDuckGo are even tried", async () => {
    const fetchImpl = vi.fn(
      async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
        new Response(
          JSON.stringify({
            results: [{ title: "Tavily result", url: "https://docs.example.test/tavily", content: "From Tavily" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );

    const result = await searchWeb("OpenRouter models", {
      tavilyApiKey: "tvly-secret",
      googleApiKey: "should-not-be-used",
      googleSearchEngineId: "should-not-be-used",
      fetchImpl,
    });

    expect(result).toMatchObject({ provider: "tavily", success: true });
    expect(result.sources).toEqual([
      { title: "Tavily result", url: "https://docs.example.test/tavily", snippet: "From Tavily" },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const requestUrl = fetchImpl.mock.calls[0]?.[0];
    const requestInit = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(String(requestUrl)).toBe("https://api.tavily.com/search");
    expect((requestInit.headers as Record<string, string>).Authorization).toBe("Bearer tvly-secret");
    expect(result.output).not.toContain("tvly-secret");
  });

  it("falls back to Exa, then SearXNG, then Brave, in order, when earlier providers fail", async () => {
    const fetchImpl = vi
      .fn()
      // Google HTML (no key configured) fails to parse
      .mockResolvedValueOnce(new Response("<html>no result</html>", { status: 200 }))
      // DuckDuckGo HTML fails to parse
      .mockResolvedValueOnce(new Response("<html>no result</html>", { status: 200 }))
      // Exa returns nothing
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }))
      // SearXNG errors
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      // Brave succeeds
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ web: { results: [{ title: "Brave result", url: "https://docs.example.test/brave" }] } }),
          { status: 200 },
        ),
      );

    const result = await searchWeb("fallback chain", {
      exaApiKey: "exa-secret",
      searxngBaseUrl: "https://searx.example.test",
      braveApiKey: "brave-secret",
      fetchImpl,
    });

    expect(result).toMatchObject({ provider: "brave", success: true });
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    const searxngCall = String(fetchImpl.mock.calls[3]?.[0]);
    expect(searxngCall).toContain("https://searx.example.test/search");
    expect(searxngCall).toContain("format=json");
  });

  it("falls back to DuckDuckGo when Google has no parseable result", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("<html>no result</html>", { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdocs.example.test%2Ffallback">Fallback docs</a>',
          { status: 200 },
        ),
      );

    const result = await searchWeb("fallback docs", { fetchImpl });

    expect(result.provider).toBe("duckduckgo");
    expect(result.sources[0]).toEqual({ title: "Fallback docs", url: "https://docs.example.test/fallback" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("opens bounded documentation pages and strips executable markup", async () => {
    const page = await openWebPage("https://docs.example.test/reference", {
      maxChars: 30,
      fetchImpl: async () =>
        new Response("<title>Docs</title><script>secret()</script><main>Useful documentation text.</main>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    });

    expect(page).toMatchObject({ success: true, title: "Docs", url: "https://docs.example.test/reference" });
    expect(page.text).toContain("Useful documentation text.");
    expect(page.text).not.toContain("secret()");
  });

  it("does not let the documentation reader access local network targets", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 }));
    const page = await openWebPage("http://127.0.0.1:8080/secret", { fetchImpl });

    expect(page).toMatchObject({ success: false, error: "Private and local network URLs are not allowed." });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not follow a public redirect into a local network target", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/" } }),
    );
    const page = await openWebPage("https://docs.example.test/redirect", { fetchImpl });

    expect(page).toMatchObject({ success: false, error: "Private and local network URLs are not allowed." });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("adds an explicit research suffix to every task query", () => {
    expect(buildResearchQuery("Fix the parser\nusing the official API")).toBe(
      "Fix the parser using the official API official documentation technical reference",
    );
  });
});
