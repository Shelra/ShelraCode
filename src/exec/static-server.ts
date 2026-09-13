import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { ManagedProcess } from "./types";

/**
 * An in-process static file server.
 *
 * A plain HTML/CSS/JS project has no dev server, so without this the runtime could create a
 * site and then have no way to actually load it — and an unloadable page cannot be verified.
 * Running in-process rather than shelling out keeps startup instant and cleanup reliable.
 */

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

interface StaticServerHandle {
  server: Server;
  process: ManagedProcess;
}

const servers = new Map<string, StaticServerHandle>();

function resolveWithin(root: string, urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  const candidate = normalize(join(root, decoded));
  // Reject traversal outside the served root.
  const rootResolved = resolve(root);
  if (candidate !== rootResolved && !candidate.startsWith(rootResolved + sep)) return null;
  return candidate;
}

export async function startStaticServer(dir: string, preferredPort = 0): Promise<ManagedProcess> {
  const root = resolve(dir);
  const id = `static-${randomUUID().slice(0, 8)}`;

  const server = createServer((req, res) => {
    const target = resolveWithin(root, req.url ?? "/");
    if (!target) {
      res.writeHead(403).end("Forbidden");
      return;
    }

    let filePath = target;
    try {
      if (existsSync(filePath) && statSync(filePath).isDirectory()) {
        filePath = join(filePath, "index.html");
      }
    } catch {
      // Fall through to the 404 below.
    }

    if (!existsSync(filePath)) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }

    res.writeHead(200, { "content-type": MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream" });
    createReadStream(filePath)
      .on("error", () => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      })
      .pipe(res);
  });

  const port = await new Promise<number>((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(preferredPort, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") resolvePort(address.port);
      else reject(new Error("static server did not report a port"));
    });
  });

  const managed: ManagedProcess = {
    id,
    command: `static file server (${root})`,
    cwd: root,
    port,
    url: `http://127.0.0.1:${port}`,
    state: "ready",
    startedAt: Date.now(),
    logPath: "",
  };

  servers.set(id, { server, process: managed });
  return managed;
}

export async function stopStaticServer(id: string): Promise<void> {
  const handle = servers.get(id);
  if (!handle) return;
  servers.delete(id);
  handle.process.state = "stopped";
  await new Promise<void>((done) => {
    handle.server.close(() => done());
    // Sockets kept alive by a browser would otherwise delay close indefinitely.
    handle.server.closeAllConnections?.();
  });
}

export function isStaticServer(id: string): boolean {
  return servers.has(id);
}

export async function stopAllStaticServers(): Promise<void> {
  await Promise.all([...servers.keys()].map((id) => stopStaticServer(id)));
}
