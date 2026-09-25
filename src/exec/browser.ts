import type { Browser, Page } from "playwright";
import type { BrowserObservation, DomAssertion } from "./types";

interface ObservePageOptions {
  viewport: { width: number; height: number };
  assertions: DomAssertion[];
  screenshotPath?: string;
  timeoutMs?: number;
  /** When the page counts as loaded. "networkidle" (the default) never comes for a page a dev server keeps a socket to. */
  waitUntil?: "load" | "networkidle";
  /** Time the page gets after it loads, and after the interaction, for what its first frames throw. */
  settleMs?: number;
  /** Click the first visible button and press Enter, Space and ArrowUp, as a person starting the app would. */
  interact?: boolean;
  /** Count the colors of the whole viewport (`distinctColors`, up to 3): one color is a blank screen. */
  measureBlank?: boolean;
}

/** Browser observation is deliberately an optional capability: missing Playwright browsers become evidence. */
export async function observePage(url: string, options: ObservePageOptions): Promise<BrowserObservation> {
  const observation: BrowserObservation = {
    url,
    ok: false,
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    badResponses: [],
    externalRequests: [],
    assertions: [],
    viewport: options.viewport,
  };

  let browser: Browser | undefined;
  try {
    // Playwright is loaded only when a page is observed. Its bundle runs its own package files
    // through paths fixed at build time, so importing it at startup would tie the standalone
    // executable to the machine that built it.
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: options.viewport });
    const appOrigin = new URL(url).origin;
    page.on("console", (message) => {
      if (message.type() === "error") observation.consoleErrors.push(message.text().slice(0, 1_000));
    });
    page.on("pageerror", (error) => observation.pageErrors.push(String(error).slice(0, 1_000)));
    page.on("response", (response) => {
      if (response.status() >= 400) {
        observation.badResponses?.push(`${response.status()} ${response.url()}`.slice(0, 1_000));
      }
    });
    page.on("requestfailed", (request) => {
      observation.failedRequests.push(
        `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "failed"}`.slice(0, 1_000),
      );
    });
    page.on("request", (request) => {
      const requestUrl = request.url();
      try {
        const parsed = new URL(requestUrl);
        if ((parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.origin !== appOrigin) {
          if (!observation.externalRequests.includes(requestUrl)) observation.externalRequests.push(requestUrl);
        }
      } catch {
        // Browser-internal/data URLs are not external network dependencies.
      }
    });

    const response = await page.goto(url, {
      waitUntil: options.waitUntil ?? "networkidle",
      timeout: options.timeoutMs ?? 30_000,
    });
    observation.status = response?.status();
    observation.ok = Boolean(response);
    observation.title = await page.title().catch(() => undefined);

    for (const assertion of options.assertions) {
      observation.assertions.push(await evaluateAssertion(page, assertion));
    }

    observation.horizontalOverflowPx = await page.evaluate(() => {
      const browserWindow = globalThis as unknown as {
        innerWidth: number;
        document: { documentElement: { scrollWidth: number } };
      };
      return Math.max(0, browserWindow.document.documentElement.scrollWidth - browserWindow.innerWidth);
    });
    if (options.settleMs) await page.waitForTimeout(options.settleMs);
    if (options.interact) {
      const button = page.locator("button:visible, input[type=button]:visible, [role=button]:visible").first();
      if ((await button.count().catch(() => 0)) > 0) await button.click({ timeout: 2_000 }).catch(() => undefined);
      for (const key of ["Enter", "Space", "ArrowUp"]) await page.keyboard.press(key).catch(() => undefined);
      await page.waitForTimeout(options.settleMs ?? 1_500);
    }
    if (options.measureBlank) {
      const shot = await page.screenshot({ type: "png" }).catch(() => null);
      if (shot) observation.distinctColors = await countColors(page, shot.toString("base64"));
    }
    if (options.screenshotPath) {
      await page.screenshot({ path: options.screenshotPath, fullPage: true });
      observation.screenshotPath = options.screenshotPath;
    }
    return observation;
  } catch (error) {
    observation.error = error instanceof Error ? error.message : String(error);
    return observation;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

/**
 * The colors of a screenshot, counted in the page itself (no image library): 1 is a blank screen, and counting stops at
 * 3. Colors are compared at 5 bits a channel, so noise in one flat color is not a second one. Undefined when the page
 * cannot decode it (a policy that forbids data: images).
 */
async function countColors(page: Page, png: string): Promise<number | undefined> {
  return page
    .evaluate(async (data: string) => {
      const scope = globalThis as unknown as {
        Image: new () => { src: string; width: number; height: number; decode(): Promise<void> };
        document: {
          createElement(tag: "canvas"): {
            width: number;
            height: number;
            getContext(kind: "2d"): {
              drawImage(image: unknown, x: number, y: number): void;
              getImageData(x: number, y: number, width: number, height: number): { data: ArrayLike<number> };
            } | null;
          };
        };
      };
      const image = new scope.Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = scope.document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (!context) return undefined;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, image.width, image.height).data;
      const colors = new Set<number>();
      for (let at = 0; at < pixels.length && colors.size < 3; at += 4) {
        colors.add(
          (((pixels[at] as number) >> 3) << 10) |
            (((pixels[at + 1] as number) >> 3) << 5) |
            ((pixels[at + 2] as number) >> 3),
        );
      }
      return colors.size;
    }, png)
    .catch(() => undefined);
}

async function evaluateAssertion(
  page: Page,
  assertion: DomAssertion,
): Promise<{ id: string; description: string; passed: boolean; detail: string }> {
  try {
    if (assertion.waitForChangeMs && assertion.selector) {
      const changing = page.locator(assertion.selector).first();
      if ((await changing.count()) === 0) {
        return {
          id: assertion.id,
          description: assertion.description,
          passed: false,
          detail: `element ${assertion.selector} was not found before the change observation`,
        };
      }
      const before = await changing.textContent();
      await page.waitForTimeout(Math.max(250, Math.min(assertion.waitForChangeMs, 5_000)));
      const after = await changing.textContent();
      if (before === after) {
        return {
          id: assertion.id,
          description: assertion.description,
          passed: false,
          detail: `element ${assertion.selector} did not change within ${assertion.waitForChangeMs}ms`,
        };
      }
    }
    if (assertion.selector) {
      const locator = page.locator(assertion.selector);
      const count = await locator.count();
      const visible = await locator.evaluateAll(
        (elements) =>
          elements.filter((rawElement) => {
            const element = rawElement as unknown as { getBoundingClientRect: () => { width: number; height: number } };
            const tagName = (rawElement as unknown as { tagName?: string }).tagName?.toLowerCase();
            // Metadata and resource elements are intentionally zero-sized. A
            // selector targeting them asserts presence, not visual layout.
            if (tagName === "meta" || tagName === "link" || tagName === "script" || tagName === "style") return true;
            const browserWindow = globalThis as unknown as {
              getComputedStyle: (value: unknown) => { visibility: string; display: string };
            };
            const style = browserWindow.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
          }).length,
      );
      const minimum = assertion.minCount ?? 1;
      if (visible < minimum) {
        return {
          id: assertion.id,
          description: assertion.description,
          passed: false,
          detail: `expected ${minimum} visible match(es), found ${count} (${visible} visible)`,
        };
      }
    }
    if (assertion.textContains) {
      const expected = assertion.textContains.toLowerCase();
      const body = await page.locator("body").innerText();
      const selected = assertion.selector
        ? await page.locator(assertion.selector).evaluateAll((elements) =>
            elements
              .map((element) => {
                const raw = element as unknown as { textContent?: string; outerHTML?: string };
                return `${raw.textContent ?? ""} ${raw.outerHTML ?? ""}`;
              })
              .join(" "),
          )
        : "";
      if (!body.toLowerCase().includes(expected) && !selected.toLowerCase().includes(expected)) {
        return {
          id: assertion.id,
          description: assertion.description,
          passed: false,
          detail: `page text does not contain "${assertion.textContains}"`,
        };
      }
    }
    if (assertion.expression) {
      const passed = await page.evaluate(
        (source) => Boolean(new Function(`return (${source})`)()),
        assertion.expression,
      );
      if (!passed)
        return {
          id: assertion.id,
          description: assertion.description,
          passed: false,
          detail: "page expression returned false",
        };
    }
    return { id: assertion.id, description: assertion.description, passed: true, detail: "assertion passed" };
  } catch (error) {
    return {
      id: assertion.id,
      description: assertion.description,
      passed: false,
      detail: `assertion error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
