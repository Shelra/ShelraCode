import { describe, expect, it } from "vitest";
import type { ToolResult } from "../types/index";
import { extractToolResultFromOutput } from "./tool-results";

describe("transcript media tool results", () => {
  it("preserves media metadata when stored tool output is normalized", () => {
    const mediaResult: ToolResult = {
      success: true,
      output: "Generated 1 image.\n- /tmp/example.png",
      media: [
        {
          kind: "image",
          path: "/tmp/example.png",
          url: "https://example.com/generated.png",
          sourcePath: "/tmp/source.png",
          prompt: "Create a new hero image",
          modelId: "image-model",
        },
      ],
    };

    expect(extractToolResultFromOutput(mediaResult)).toEqual(mediaResult);
  });

  it("preserves explicit plan progress for session resume", () => {
    const update: ToolResult = {
      success: true,
      output: "Plan step 2 is working.",
      planUpdate: { index: 1, status: "working", evidence: "Running restart test" },
    };

    expect(extractToolResultFromOutput(update)).toMatchObject({ planUpdate: update.planUpdate });
  });
});
