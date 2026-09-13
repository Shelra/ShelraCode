import { tool } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
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
});
