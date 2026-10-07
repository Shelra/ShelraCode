import { modelMessageSchema } from "ai";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildVisionUserMessages } from "./vision-input";

describe("buildVisionUserMessages", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "shelra-vision-"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("reports an unavailable image instead of silently presenting a text-only request", async () => {
    const imagePath = path.join(tempDir, "missing.png");
    const messages = await buildVisionUserMessages(`Inspect ${imagePath}`, tempDir);
    expect(JSON.stringify(messages)).toContain("Image unavailable");
  });

  it.each([
    "local",
    "remote",
  ])("keeps %s image messages valid after the transcript's JSON round trip", async (source) => {
    const bytes = Buffer.from([1, 2, 3, 4]);
    const local = path.join(tempDir, "resume.png");
    fs.writeFileSync(local, bytes);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(bytes, { headers: { "content-type": "image/png" } })),
    );
    const messages = await buildVisionUserMessages(
      `Inspect ${source === "local" ? local : "https://fixture.invalid/resume.png"}`,
      tempDir,
    );
    expect(modelMessageSchema.safeParse(messages[0]).success).toBe(true);
    const replay = JSON.parse(JSON.stringify(messages));
    expect(modelMessageSchema.safeParse(replay[0]).success).toBe(true);
    expect(Buffer.from(replay[0].content[0].data, "base64")).toEqual(bytes);
  });

  it("uses the downloaded bytes rather than asking the provider to download the URL again", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array([1, 2]), {
          headers: { "content-type": "image/png" },
        }),
      ),
    );
    const messages = await buildVisionUserMessages("Inspect https://fixture.invalid/screen.png", tempDir);
    const content = messages[0]?.content as Array<Record<string, unknown>>;
    expect(Buffer.from(content[0]?.data as string, "base64")).toEqual(Buffer.from([1, 2]));
  });

  it("bounds a remote image that never returns headers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
              once: true,
            });
          }),
      ),
    );
    const started = Date.now();
    const messages = await buildVisionUserMessages("Inspect https://fixture.invalid/screen.png", tempDir, undefined, {
      timeoutMs: 25,
    });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(JSON.stringify(messages)).toContain("Image unavailable");
  });

  it("rejects an oversized image before reading its body", async () => {
    const body = new Response(new Uint8Array([1, 2]), { headers: { "content-length": "1000000" } });
    const read = vi.spyOn(body.body!, "getReader");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(body));
    const messages = await buildVisionUserMessages("Inspect https://fixture.invalid/screen.png", tempDir, undefined, {
      maxImageBytes: 10,
    });
    expect(JSON.stringify(messages)).toContain("Image unavailable");
    expect(read).not.toHaveBeenCalled();
  });

  it("bounds a response body that stops producing bytes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ start() {} }))));
    const started = Date.now();
    const messages = await buildVisionUserMessages("Inspect https://fixture.invalid/screen.png", tempDir, undefined, {
      timeoutMs: 25,
    });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(JSON.stringify(messages)).toContain("Image unavailable");
  });

  it("propagates user cancellation rather than substituting an image error", async () => {
    const parent = new AbortController();
    parent.abort();
    await expect(
      buildVisionUserMessages("Inspect https://fixture.invalid/screen.png", tempDir, parent.signal),
    ).rejects.toThrow();
  });

  it("builds a multimodal user message when the prompt contains a local image path", async () => {
    const imagePath = path.join(tempDir, "screen.png");
    fs.writeFileSync(imagePath, Buffer.from([1, 2, 3, 4]));

    const messages = await buildVisionUserMessages(`Validate the image at ${imagePath}`, tempDir);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("user");
    expect(Array.isArray(messages[0]?.content)).toBe(true);

    const content = messages[0]?.content as Array<Record<string, unknown>>;
    expect(content[0]).toMatchObject({
      type: "file",
      mediaType: "image/png",
    });
    expect(Buffer.from(content[0]?.data as string, "base64")).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(content[1]).toMatchObject({
      type: "text",
      text: `Validate the image at ${imagePath}`,
    });
  });

  it("recognizes shell-escaped screenshot paths", async () => {
    const imageName = "Screenshot 2026-05-06 at 10.02.18.png";
    const imagePath = path.join(tempDir, imageName);
    fs.writeFileSync(imagePath, Buffer.from([1, 2, 3, 4]));
    const escapedPath = path.join(tempDir, "Screenshot\\ 2026-05-06\\ at\\ 10.02.18.png");

    const messages = await buildVisionUserMessages(`${escapedPath}\nExplain this image`, tempDir);

    const content = messages[0]?.content as Array<Record<string, unknown>>;
    expect(content[0]).toMatchObject({
      type: "file",
      mediaType: "image/png",
    });
    expect(Buffer.from(content[0]?.data as string, "base64")).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(content[1]).toMatchObject({
      type: "text",
      text: `${escapedPath}\nExplain this image`,
    });
  });
});
