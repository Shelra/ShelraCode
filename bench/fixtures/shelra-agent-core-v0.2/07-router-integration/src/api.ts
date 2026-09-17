import { createRouter } from "./router";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function createApiRouter() {
  const router = createRouter();
  router.get("/health", () => json({ ok: true }));
  router.get("/users/:id", (_request, params) => json({ id: params.id, verbose: false }));
  router.post("/users", async (request) => {
    const body = (await request.json()) as { name?: string };
    return json({ id: "new", name: body.name ?? "" }, 201);
  });
  return router;
}
