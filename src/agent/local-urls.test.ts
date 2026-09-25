import { describe, expect, it } from "vitest";
import type { BrowserObservation } from "../exec/types";
import { answered, checkLocalUrls, describeUrlChecks, localUrlsIn, urlRepairRequest } from "./local-urls";

const page = (status: number, type = "text/html"): typeof fetch =>
  (async () =>
    new Response("<html></html>", {
      status,
      statusText: status === 500 ? "Internal Server Error" : "OK",
      headers: { "content-type": type },
    })) as unknown as typeof fetch;

const seen = (overrides: Partial<BrowserObservation> = {}): BrowserObservation => ({
  url: "http://localhost:8080/",
  ok: true,
  status: 200,
  consoleErrors: [],
  pageErrors: [],
  failedRequests: [],
  badResponses: [],
  externalRequests: [],
  assertions: [],
  ...overrides,
});

describe("the local pages an answer names (seen live 2026-09-25)", () => {
  it("finds each local URL once, without trailing punctuation", () => {
    expect(
      localUrlsIn(
        "Open http://localhost:8080/public/index.html. Also http://127.0.0.1:3000, http://0.0.0.0:5173/ and https://example.com; again http://localhost:8080/public/index.html!",
      ),
    ).toEqual(["http://localhost:8080/public/index.html", "http://127.0.0.1:3000", "http://localhost:5173/"]);
    expect(localUrlsIn("Deployed to https://shelra.dev")).toEqual([]);
  });

  it("reports a page that answers 500 as not working, without opening a browser", async () => {
    let opened = false;
    const [check] = await checkLocalUrls(["http://localhost:8080/public/index.html"], {
      fetchImpl: page(500),
      observe: async () => {
        opened = true;
        return seen();
      },
    });
    expect(check).toMatchObject({ status: 500, detail: "HTTP 500 Internal Server Error" });
    expect(answered(check as never)).toBe(false);
    expect(opened).toBe(false);
    expect(describeUrlChecks([check as never])).toBe(
      "[Shelra requested the local page the answer names when the turn ended: http://localhost:8080/public/index.html → HTTP 500 Internal Server Error]",
    );
  });

  it("opens a page that answers 200 and reports what broke in the browser", async () => {
    const [check] = await checkLocalUrls(["http://localhost:8080/"], {
      fetchImpl: page(200),
      observe: async () =>
        seen({
          pageErrors: ["TypeError: Cannot read properties of undefined (reading 'position')"],
          badResponses: ["404 http://localhost:8080/src/kart.js"],
        }),
    });
    expect(answered(check as never)).toBe(false);
    const note = describeUrlChecks([check as never]);
    expect(note).toContain("HTTP 200 OK, in a headless browser: uncaught error: TypeError: Cannot read properties");
    expect(note).toContain("request answered 404 http://localhost:8080/src/kart.js");
    expect(urlRepairRequest([check as never])).toContain("Do not say it works unless it loads without errors.");
  });

  it("counts a page that loads without an error as working", async () => {
    const [check] = await checkLocalUrls(["http://localhost:8080/"], {
      fetchImpl: page(200),
      observe: async () => seen(),
    });
    expect(answered(check as never)).toBe(true);
    expect(describeUrlChecks([check as never])).toContain("HTTP 200 OK, loaded in a headless browser with no error");
  });

  it("says when nothing answers, and never throws", async () => {
    const refused = (async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    }) as unknown as typeof fetch;
    const [check] = await checkLocalUrls(["http://localhost:9"], { fetchImpl: refused, observe: null });
    expect(check).toMatchObject({ status: null, detail: "nothing answered (connection refused)" });
    expect(answered(check as never)).toBe(false);
  });
});
