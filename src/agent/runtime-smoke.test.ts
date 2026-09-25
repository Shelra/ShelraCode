import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BrowserObservation } from "../exec/types";
import { changesWebFiles, findWebTarget, runSmokeCheck, withoutAnsi } from "./runtime-smoke";

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "shelra-smoke-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

const pkg = (scripts: Record<string, string>) => JSON.stringify({ name: "app", scripts });

describe("finding the app a turn changed (audit gap #1)", () => {
  it("serves the folder a static server script names, and a plain site's index.html", () => {
    const served = project({
      "package.json": pkg({ start: "npx http-server public -p 8080 -o" }),
      "public/index.html": "",
    });
    expect(findWebTarget(served)).toEqual({
      kind: "static",
      dir: join(served, "public"),
      how: "`npm run start` (npx http-server public -p 8080 -o)",
    });
    const site = project({ "www/index.html": "<h1>Hi</h1>" });
    expect(findWebTarget(site)).toEqual({ kind: "static", dir: join(site, "www"), how: "www/index.html" });
  });

  it("starts Vite with the script's own arguments, and never serves a bundler project's source", () => {
    expect(findWebTarget(project({ "package.json": pkg({ dev: "tsc && vite --open", build: "vite build" }) }))).toEqual(
      {
        kind: "vite",
        args: ["--open"],
        how: "`npm run dev` (tsc && vite --open)",
      },
    );
    expect(findWebTarget(project({ "package.json": pkg({ dev: "next dev" }) }))?.kind).toBe("unsupported");
    expect(
      findWebTarget(
        project({ "package.json": pkg({ build: "vite build" }), "index.html": '<script src="/src/main.ts">' }),
      )?.kind,
    ).toBe("unsupported");
    expect(findWebTarget(project({ "package.json": pkg({ test: "vitest" }), "src/lib.ts": "" }))).toBeNull();
  });

  it("counts only the files a web app shows", () => {
    expect(changesWebFiles(["src/tracks/castle.ts"])).toBe(true);
    expect(changesWebFiles(["package.json", "README.md"])).toBe(true);
    expect(changesWebFiles(["README.md", "notes/plan.txt", "scripts/deploy.py"])).toBe(false);
  });

  it("reads Vite's URL through its colors", () => {
    const esc = String.fromCharCode(27);
    expect(withoutAnsi(`Local:   ${esc}[36mhttp://localhost:${esc}[1m5173${esc}[22m/${esc}[39m`)).toBe(
      "Local:   http://localhost:5173/",
    );
  });
});

const clean: BrowserObservation = {
  url: "",
  ok: true,
  status: 200,
  consoleErrors: [],
  pageErrors: [],
  failedRequests: [],
  badResponses: [],
  externalRequests: [],
  assertions: [],
  distinctColors: 3,
};

describe("opening the app", () => {
  it("uses the server the session runs, on the page the answer names, and starts nothing", async () => {
    const opened: string[] = [];
    const result = await runSmokeCheck({
      workspace: project({}),
      target: { kind: "unsupported", how: "`npm run dev` (next dev)" },
      sessionUrls: ["http://localhost:3000"],
      answerUrls: ["http://127.0.0.1:3000/play.html", "http://localhost:9999/other"],
      observe: async (url) => {
        opened.push(url);
        return { ...clean, url };
      },
    });
    expect(opened).toEqual(["http://127.0.0.1:3000/play.html"]);
    expect(result).toMatchObject({ status: "passed", how: "the server this session runs" });
  });

  it("says what it could not open, without holding it against the turn", async () => {
    const vite = await runSmokeCheck({
      workspace: project({ "package.json": pkg({ dev: "vite" }) }),
      target: { kind: "vite", args: [], how: "`npm run dev` (vite)" },
      sessionUrls: [],
      answerUrls: [],
    });
    expect(vite).toMatchObject({ status: "unavailable", note: "vite is not installed (npm install)" });
    const next = await runSmokeCheck({
      workspace: project({}),
      target: { kind: "unsupported", how: "`npm run dev` (next dev)" },
      sessionUrls: [],
      answerUrls: [],
    });
    expect(next).toMatchObject({ status: "unavailable", note: "Shelra does not start `npm run dev` (next dev) yet" });
  });
});

let chromium = false;
try {
  const playwright = await import("playwright");
  chromium = existsSync(playwright.chromium.executablePath());
} catch {
  chromium = false;
}

/** Serves `files` as a static site and opens it in a real headless browser. */
async function smoke(files: Record<string, string>) {
  const dir = project(files);
  const target = findWebTarget(dir);
  if (target?.kind !== "static") throw new Error("not a static site");
  return { result: await runSmokeCheck({ workspace: dir, target, sessionUrls: [], answerUrls: [] }) };
}

describe.skipIf(!chromium)("the app in a real headless browser (seen live 2026-09-25)", () => {
  it("passes a page that draws and throws nothing", async () => {
    const { result } = await smoke({
      "index.html":
        '<body style="margin:0"><canvas id="c" width="400" height="300"></canvas><script>const x=document.getElementById("c").getContext("2d");x.fillStyle="#0a4";x.fillRect(0,0,200,300);x.fillStyle="#fff";x.fillText("Lap 1",220,40);</script></body>',
    });
    expect(result.status).toBe("passed");
    expect(result.problems).toEqual([]);
  }, 60_000);

  it("fails the game whose page loads its TypeScript source, as the racing game's did", async () => {
    const { result } = await smoke({
      "package.json": pkg({ start: "http-server public -p 8080", build: "tsc && esbuild src/index.ts --bundle" }),
      "public/index.html": '<body><script type="module" src="../src/index.ts"></script></body>',
      "src/index.ts": "const speed: number = 1; console.log(speed);",
    });
    expect(result.status).toBe("failed");
    expect(result.problems.join("\n")).toMatch(/src\/index\.ts/u);
  }, 60_000);

  it("fails a module the page cannot load, and TypeScript served raw", async () => {
    const missing = await smoke({ "index.html": '<script type="module" src="/src/missing.js"></script><h1>Race</h1>' });
    expect(missing.result.status).toBe("failed");
    expect(missing.result.problems.join("\n")).toContain("404");
    const raw = await smoke({
      "index.html": '<script type="module" src="./main.ts"></script><h1>Race</h1>',
      "main.ts": "",
    });
    expect(raw.result.status).toBe("failed");
  }, 60_000);

  it("fails an error thrown once the player presses Enter", async () => {
    const { result } = await smoke({
      "index.html":
        '<h1>Press Enter to start</h1><script>addEventListener("keydown",(e)=>{if(e.key==="Enter")requestAnimationFrame(()=>{throw new Error("track is undefined")})})</script>',
    });
    expect(result.status).toBe("failed");
    expect(result.problems.join("\n")).toContain("track is undefined");
  }, 60_000);

  it("fails a blank screen", async () => {
    const { result } = await smoke({
      "index.html": '<body style="margin:0;background:#000"><canvas id="game"></canvas></body>',
    });
    expect(result.status).toBe("failed");
    expect(result.problems.join("\n")).toContain("the screen is blank");
  }, 60_000);
});
