import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OrionOAuthProvider } from "./orionmcp-oauth";

const scratch: string[] = [];
afterEach(() => {
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true });
});
describe("ORIONMCP OAuth credential isolation", () => {
  it("does not open a browser during a normal tool session", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "orion-oauth-"));
    scratch.push(directory);
    const provider = new OrionOAuthProvider("https://example.test/mcp", undefined, directory);
    expect(provider.tokens()).toBeUndefined();
    await expect(provider.redirectToAuthorization(new URL("https://example.test/authorize"))).rejects.toThrow(
      "shelra mcp orionmcp login",
    );
    expect(readdirSync(directory)).toEqual([]);
  });
  it("rejects substituted resources and authentication endpoints", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "orion-oauth-"));
    scratch.push(directory);
    const provider = new OrionOAuthProvider("https://example.test/mcp", undefined, directory);
    await expect(provider.validateResourceURL("https://example.test/mcp", "https://evil.test/mcp")).rejects.toThrow();
    await expect(provider.safeFetch("https://evil.test/token")).rejects.toThrow();
  });
  it.skipIf(process.platform !== "win32")(
    "protects tokens with Windows DPAPI and reopens only this endpoint's record",
    () => {
      const directory = mkdtempSync(path.join(os.tmpdir(), "orion-oauth-"));
      scratch.push(directory);
      const endpoint = "https://example.test/mcp",
        tokens = {
          access_token: "test-access-credential",
          refresh_token: "test-refresh-credential",
          token_type: "Bearer",
        };
      const provider = new OrionOAuthProvider(endpoint, undefined, directory);
      provider.saveTokens(tokens);
      const file = path.join(directory, readdirSync(directory)[0]);
      expect(readFileSync(file, "utf8")).not.toContain(tokens.access_token);
      expect(new OrionOAuthProvider(endpoint, undefined, directory).tokens()).toEqual(tokens);
      expect(new OrionOAuthProvider("https://another.test/mcp", undefined, directory).tokens()).toBeUndefined();
      provider.invalidateCredentials("all");
      expect(readdirSync(directory)).toEqual([]);
    },
  );
});
