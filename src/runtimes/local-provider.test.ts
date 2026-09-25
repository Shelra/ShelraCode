import { tool } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createCircleDetector } from "../agent/circles";
import { createOpenAICompatibleProvider } from "./local-provider";

function streamResponse(chunks: Array<Record<string, unknown>>): Response {
  const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body, {
    headers: { "content-type": "text/event-stream" },
  });
}

describe("OpenAI-compatible tool protocol", () => {
  it("repairs a scalar tool call before the next provider request", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const execute = vi.fn(async ({ command }: { command: string }) => `ran:${command}`);
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(body);

      if (requests.length === 1) {
        return streamResponse([
          {
            id: "response-1",
            model: "test-model",
            choices: [
              {
                index: 0,
                delta: {
                  role: "assistant",
                  tool_calls: [
                    {
                      index: 0,
                      id: "call-1",
                      function: { name: "bash", arguments: "Get-Location" },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          },
        ]);
      }

      return streamResponse([
        {
          id: "response-2",
          model: "test-model",
          choices: [{ index: 0, delta: { role: "assistant", content: "done" }, finish_reason: "stop" }],
        },
      ]);
    };

    const provider = createOpenAICompatibleProvider("test-key", "https://provider.test/v1", "test-model", {
      fetch: fetchImpl,
    });
    const response = provider.stream({
      modelId: "test-model",
      system: "Use tools when needed.",
      messages: [{ role: "user", content: "run the command" }],
      tools: {
        bash: tool({
          inputSchema: z.object({ command: z.string() }),
          execute,
        }),
      },
      maxSteps: 2,
    });
    const events = [];
    for await (const event of response.events) events.push(event);
    await response.response;

    expect(execute).toHaveBeenCalledWith({ command: "Get-Location" }, expect.anything());
    expect(requests).toHaveLength(2);
    const messages = requests[1]?.messages as Array<Record<string, unknown>>;
    const assistant = messages.find((message) => message.role === "assistant");
    const toolCalls = assistant?.tool_calls as Array<Record<string, unknown>>;
    const functionCall = toolCalls?.[0]?.function as Record<string, unknown>;
    expect(functionCall?.arguments).toBe('{"command":"Get-Location"}');
    expect(events.some((event) => event.type === "tool-result")).toBe(true);
    expect(events.some((event) => event.type === "text-delta" && event.text === "done")).toBe(true);
  });

  it("clears old tool results from the later requests of a long generation", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      const n = requests.length;
      if (n <= 8) {
        return streamResponse([
          {
            id: `response-${n}`,
            model: "test-model",
            choices: [
              {
                index: 0,
                delta: {
                  role: "assistant",
                  tool_calls: [
                    { index: 0, id: `call-${n}`, function: { name: "read_file", arguments: `{"path":"f${n}.ts"}` } },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          },
        ]);
      }
      return streamResponse([
        {
          id: "response-final",
          model: "test-model",
          choices: [{ index: 0, delta: { role: "assistant", content: "done" }, finish_reason: "stop" }],
        },
      ]);
    };
    const provider = createOpenAICompatibleProvider("test-key", "https://provider.test/v1", "test-model", {
      fetch: fetchImpl,
    });
    const response = provider.stream({
      modelId: "test-model",
      system: "Read files when needed.",
      messages: [{ role: "user", content: "read eight files" }],
      tools: {
        read_file: tool({
          inputSchema: z.object({ path: z.string() }),
          execute: async ({ path }: { path: string }) => `${path}: ${"x".repeat(30_000)}`,
        }),
      },
      maxSteps: 10,
    });
    for await (const _event of response.events) {
      // drain
    }
    const final = await response.response;

    expect(requests).toHaveLength(9);
    const sent = (requests[8]?.messages as Array<Record<string, unknown>>)
      .filter((message) => message.role === "tool")
      .map((message) => String(message.content));
    expect(sent).toHaveLength(8);
    for (const content of sent.slice(0, 3)) expect(content).toContain("Cleared from this request");
    for (const content of sent.slice(5)) expect(content).toContain("x".repeat(30_000));
    // What the session keeps is whole.
    expect(JSON.stringify(final.messages)).not.toContain("Cleared from this request");
  });

  it("stops a generation whose steps only look and find nothing new, and says why", async () => {
    // Live 2026-09-25: a model read one line in slices, then as character codes, for 170 steps; every command and
    // result differed, so the repeat check never matched.
    const line = "check('shrink + invincibility', hurtOk ? +hurtOk.invincible.toFixed(2) : null);";
    let requests = 0;
    const fetchImpl: typeof fetch = async () => {
      requests += 1;
      const start = (requests - 1) * 4;
      return streamResponse([
        {
          id: `response-${requests}`,
          model: "test-model",
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: `call-${requests}`,
                    function: {
                      name: "bash",
                      arguments: JSON.stringify({ command: `node -e "dump(${start}, ${start + 4})"` }),
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        },
      ]);
    };
    const stops: string[] = [];
    const provider = createOpenAICompatibleProvider("test-key", "https://provider.test/v1", "test-model", {
      fetch: fetchImpl,
    });
    const response = provider.stream({
      modelId: "test-model",
      system: "Use tools when needed.",
      messages: [{ role: "user", content: "why does the audit fail?" }],
      tools: {
        bash: tool({
          inputSchema: z.object({ command: z.string() }),
          execute: async ({ command }: { command: string }) => {
            const [from, to] = [...command.matchAll(/\d+/gu)].map((match) => Number(match[0]));
            // The first step shows the line; every later one shows a few of its characters as codes.
            return from === 0
              ? line
              : [...line.slice(from, to)].map((char) => `${char.charCodeAt(0)} ${JSON.stringify(char)}`).join("\n");
          },
        }),
      },
      maxSteps: 60,
      onHostStop: (reason) => stops.push(reason),
    });
    for await (const _event of response.events) {
      // drain
    }
    await response.response;

    expect(stops).toEqual(["stalled"]);
    // One step that learned the line, then STALL_WINDOW (12) that learned nothing.
    expect(requests).toBe(13);
  });

  it("lets a generation that keeps finding something new run on", async () => {
    let requests = 0;
    const fetchImpl: typeof fetch = async () => {
      requests += 1;
      if (requests > 20) {
        return streamResponse([
          {
            id: "response-final",
            model: "test-model",
            choices: [{ index: 0, delta: { role: "assistant", content: "done" }, finish_reason: "stop" }],
          },
        ]);
      }
      return streamResponse([
        {
          id: `response-${requests}`,
          model: "test-model",
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                tool_calls: [
                  { index: 0, id: `call-${requests}`, function: { name: "read_file", arguments: `{"path":"f.ts"}` } },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        },
      ]);
    };
    const stops: string[] = [];
    const provider = createOpenAICompatibleProvider("test-key", "https://provider.test/v1", "test-model", {
      fetch: fetchImpl,
    });
    let page = 0;
    const response = provider.stream({
      modelId: "test-model",
      system: "Read files when needed.",
      messages: [{ role: "user", content: "read the whole file" }],
      tools: {
        read_file: tool({
          inputSchema: z.object({ path: z.string() }),
          // The same call every time, and every page holds functions the model has not seen.
          execute: async () => {
            page += 1;
            return `export function handlerNumber${"x".repeat(page)}() {}`;
          },
        }),
      },
      maxSteps: 60,
      onHostStop: (reason) => stops.push(reason),
    });
    for await (const _event of response.events) {
      // drain
    }
    await response.response;

    expect(stops).toEqual([]);
    expect(requests).toBe(21);
  });

  it("ends a generation on the caller's own stop condition, with what it saw (audit gap #3)", async () => {
    // Live 2026-09-25: a model flipped src/tracks/castle.ts between the same two versions for half an hour.
    let requests = 0;
    const fetchImpl: typeof fetch = async () => {
      requests += 1;
      const [from, to] = requests % 2 === 1 ? ["let a = 1;", "const a = 1;"] : ["const a = 1;", "let a = 1;"];
      return streamResponse([
        {
          id: `response-${requests}`,
          model: "test-model",
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: `call-${requests}`,
                    function: {
                      name: "edit_file",
                      arguments: JSON.stringify({ path: "src/a.ts", old_string: from, new_string: to }),
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        },
      ]);
    };
    const stops: Array<[string, string | undefined]> = [];
    const provider = createOpenAICompatibleProvider("test-key", "https://provider.test/v1", "test-model", {
      fetch: fetchImpl,
    });
    const response = provider.stream({
      modelId: "test-model",
      system: "Edit files when needed.",
      messages: [{ role: "user", content: "fix the track" }],
      tools: {
        edit_file: tool({
          inputSchema: z.object({ path: z.string(), old_string: z.string(), new_string: z.string() }),
          execute: async () => ({ success: true, output: "+1 -1" }),
        }),
      },
      maxSteps: 60,
      onHostStop: (reason, detail) => stops.push([reason, detail]),
      hostStops: [createCircleDetector().round()],
    });
    for await (const _event of response.events) {
      // drain
    }
    await response.response;

    expect(requests).toBe(3);
    expect(stops).toEqual([
      [
        "oscillating",
        'your edits to src/a.ts went back and forth between the same two versions ("let a = 1;" and "const a = 1;"): 2 of them undid the edit before',
      ],
    ]);
  });

  it("counts the tokens of the steps a round finished before it was cut short", async () => {
    // Live 2026-09-23: rounds cut by a stall were saved with 0 tokens, because the provider's
    // total never arrives; spend limits and the session's counts missed every step they held.
    const controller = new AbortController();
    const fetchImpl: typeof fetch = async (_input, init) => {
      if (!(init?.signal as AbortSignal | undefined)?.aborted && controller.signal.aborted === false) {
        const body = JSON.parse(String(init?.body)) as { messages: unknown[] };
        if (body.messages.length <= 2) {
          return streamResponse([
            {
              id: "response-1",
              model: "test-model",
              choices: [
                {
                  index: 0,
                  delta: {
                    role: "assistant",
                    tool_calls: [
                      { index: 0, id: "call-1", function: { name: "read_file", arguments: '{"path":"a.ts"}' } },
                    ],
                  },
                  finish_reason: "tool_calls",
                },
              ],
              usage: { prompt_tokens: 1_000, completion_tokens: 50, total_tokens: 1_050 },
            },
          ]);
        }
      }
      // The next step never answers until the round is cut.
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    };
    const finished: Array<{ inputTokens?: number; outputTokens?: number }> = [];
    const provider = createOpenAICompatibleProvider("test-key", "https://provider.test/v1", "test-model", {
      fetch: fetchImpl,
    });
    const response = provider.stream({
      modelId: "test-model",
      system: "Read files when needed.",
      messages: [{ role: "user", content: "read a.ts" }],
      tools: {
        read_file: tool({
          inputSchema: z.object({ path: z.string() }),
          execute: async ({ path }: { path: string }) => `${path}: contents`,
        }),
      },
      maxSteps: 5,
      signal: controller.signal,
      onStepFinish: () => setTimeout(() => controller.abort(new Error("idle")), 10),
      onFinish: (usage) => finished.push(usage),
    });
    for await (const _event of response.events) {
      // drain
    }
    await response.response.catch(() => undefined);

    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({ inputTokens: 1_000, outputTokens: 50 });
  });

  it("sends OpenRouter's nested reasoning.effort body field, not a flat reasoning_effort string", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return streamResponse([
        {
          id: "response-1",
          model: "test-model",
          choices: [{ index: 0, delta: { role: "assistant", content: "done" }, finish_reason: "stop" }],
        },
      ]);
    };

    const provider = createOpenAICompatibleProvider("test-key", "https://provider.test/v1", "test-model", {
      fetch: fetchImpl,
      providerId: "openrouter-transport",
    });
    const response = provider.stream({
      modelId: "test-model",
      system: "Be helpful.",
      messages: [{ role: "user", content: "hi" }],
      maxSteps: 1,
      reasoningEffort: "high",
    });
    for await (const _event of response.events) {
      // drain
    }
    await response.response;

    expect(requests).toHaveLength(1);
    // OpenRouter's docs (https://openrouter.ai/docs/use-cases/reasoning-tokens, checked
    // 2026-09-13) require the nested `reasoning: { effort }` object — a flat top-level
    // `reasoning_effort` string (the AI SDK's own built-in mapping) is not honored.
    expect(requests[0]?.reasoning).toEqual({ effort: "high" });
    expect(requests[0]?.reasoning_effort).toBeUndefined();
  });

  it("omits any reasoning field when no effort is requested", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return streamResponse([
        {
          id: "response-1",
          model: "test-model",
          choices: [{ index: 0, delta: { role: "assistant", content: "done" }, finish_reason: "stop" }],
        },
      ]);
    };

    const provider = createOpenAICompatibleProvider("test-key", "https://provider.test/v1", "test-model", {
      fetch: fetchImpl,
    });
    const response = provider.stream({
      modelId: "test-model",
      system: "Be helpful.",
      messages: [{ role: "user", content: "hi" }],
      maxSteps: 1,
    });
    for await (const _event of response.events) {
      // drain
    }
    await response.response;

    expect(requests[0]?.reasoning).toBeUndefined();
  });

  it("aborts a model request that never produces a response", async () => {
    let aborted = false;
    const fetchImpl: typeof fetch = async (_input, init) => {
      const signal = init?.signal;
      return await new Promise<Response>((_resolve, reject) => {
        if (!signal) {
          reject(new Error("The test fetch did not receive an abort signal."));
          return;
        }

        const onAbort = () => {
          aborted = true;
          reject(signal.reason ?? new Error("aborted"));
        };
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      });
    };

    const provider = createOpenAICompatibleProvider("test-key", "https://provider.test/v1", "test-model", {
      fetch: fetchImpl,
    });
    const response = provider.stream({
      modelId: "test-model",
      system: "Be helpful.",
      messages: [{ role: "user", content: "do not answer" }],
      maxSteps: 1,
      timeout: { totalMs: 150, stepMs: 150, chunkMs: 100 },
    });

    await expect(
      (async () => {
        for await (const _event of response.events) {
          // drain
        }
        await response.response;
      })(),
    ).rejects.toThrow();
    expect(aborted).toBe(true);
  });
});
