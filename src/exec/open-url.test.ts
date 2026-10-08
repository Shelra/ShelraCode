import { describe, expect, it } from "vitest";
import { checkOpenableUrl, NO_BROWSER_ENV, openWithSystem } from "./open-url";

describe("what the agent may open for the person", () => {
  it("opens http and https pages on this machine", () => {
    expect(checkOpenableUrl("http://localhost:5173")).toEqual({ ok: true, url: "http://localhost:5173/" });
    expect(checkOpenableUrl("http://127.0.0.1:3000/app?x=1&y=2")).toEqual({
      ok: true,
      url: "http://127.0.0.1:3000/app?x=1&y=2",
    });
    expect(checkOpenableUrl(" https://localhost:8443/ ")).toMatchObject({ ok: true });
    expect(checkOpenableUrl("http://[::1]:4000/")).toMatchObject({ ok: true });
  });

  it("turns the address a server listens on into one a browser can visit", () => {
    expect(checkOpenableUrl("http://0.0.0.0:8080/")).toEqual({ ok: true, url: "http://localhost:8080/" });
  });

  it("refuses other sites, other schemes and garbage, and says what to do instead", () => {
    const remote = checkOpenableUrl("https://example.com/page");
    expect(remote.ok).toBe(false);
    expect(remote.ok ? "" : remote.reason).toContain("give them this address in your answer");
    // A host that only starts like a local one is not local.
    expect(checkOpenableUrl("http://localhost.evil.test/")).toMatchObject({ ok: false });
    expect(checkOpenableUrl("http://127.0.0.1.evil.test/")).toMatchObject({ ok: false });
    expect(checkOpenableUrl("file:///C:/Windows/win.ini")).toMatchObject({ ok: false });
    expect(checkOpenableUrl("javascript:alert(1)")).toMatchObject({ ok: false });
    expect(checkOpenableUrl("not a url")).toMatchObject({ ok: false });
  });
});

describe("openWithSystem", () => {
  it("opens nothing when SHELRA_NO_BROWSER is set", async () => {
    expect(await openWithSystem("http://localhost:1/", { [NO_BROWSER_ENV]: "1" })).toBe(false);
  });
});
