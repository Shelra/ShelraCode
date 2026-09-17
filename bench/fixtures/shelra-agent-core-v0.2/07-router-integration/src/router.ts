export interface Route {
  method: string;
  pattern: string;
  handler: (request: Request, params: Record<string, string>) => Response | Promise<Response>;
}

export interface Router {
  get(path: string, handler: Route["handler"]): void;
  post(path: string, handler: Route["handler"]): void;
  handle(request: Request): Promise<Response>;
}

export function createRouter(): Router {
  const routes: Route[] = [];
  return {
    get(path, handler) {
      routes.push({ method: "GET", pattern: path, handler });
    },
    post(path, handler) {
      routes.push({ method: "POST", pattern: path, handler });
    },
    async handle(request) {
      const route = routes.find(
        (candidate) => candidate.method === request.method && candidate.pattern === new URL(request.url).pathname,
      );
      if (!route) return new Response("Not found", { status: 404 });
      return route.handler(request, {});
    },
  };
}
