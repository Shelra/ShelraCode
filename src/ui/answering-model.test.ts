import { describe, expect, it } from "vitest";
import { answeringModelLabel, isFreeModelId, limitedUntilLabel } from "./answering-model";

describe("the model the footer shows", () => {
  it("names the model a router picked, with the router", () => {
    expect(
      answeringModelLabel(
        { modelId: "openrouter/auto", servedModelId: "openrouter/vendor-x/model-y" },
        "openrouter/vendor-z/chosen",
      ),
    ).toBe("model-y · auto");
    expect(
      answeringModelLabel(
        { modelId: "openrouter/free", servedModelId: "openrouter/qwen/qwen3-coder:free" },
        "openrouter/free",
      ),
    ).toBe("qwen3-coder:free · free");
  });

  it("says when OpenRouter answered from its own fallback list", () => {
    expect(
      answeringModelLabel(
        { modelId: "openrouter/vendor-a/best:free", servedModelId: "openrouter/vendor-b/second:free" },
        "openrouter/vendor-a/best:free",
      ),
    ).toBe("second:free · fallback");
  });

  it("names a fallback, and nothing when the chosen model answers", () => {
    expect(answeringModelLabel({ modelId: "openrouter/vendor-x/fallback" }, "openrouter/vendor-z/chosen")).toBe(
      "openrouter/vendor-x/fallback",
    );
    expect(answeringModelLabel({ modelId: "openrouter/vendor-z/chosen" }, "openrouter/vendor-z/chosen")).toBeNull();
    expect(answeringModelLabel(null, "openrouter/vendor-z/chosen")).toBeNull();
  });

  it("says Limited until the reset, and nothing once it has passed", () => {
    const now = new Date(2026, 8, 24, 15, 0);
    expect(limitedUntilLabel(null, now)).toBeNull();
    expect(limitedUntilLabel({}, now)).toBe("");
    expect(limitedUntilLabel({ resetsAt: new Date(2026, 8, 24, 20, 0).toISOString() }, now)).toBe("8:00 PM");
    expect(limitedUntilLabel({ resetsAt: new Date(2026, 8, 25, 2, 0).toISOString() }, now)).toBe("Sep 25, 2:00 AM");
    expect(limitedUntilLabel({ resetsAt: new Date(2026, 8, 24, 14, 0).toISOString() }, now)).toBeNull();
  });

  it("says free models can queue only for a free model", () => {
    expect(isFreeModelId("openrouter/free")).toBe(true);
    expect(isFreeModelId("openrouter/qwen/qwen3-coder:free")).toBe(true);
    expect(isFreeModelId("openrouter/auto")).toBe(false);
    expect(isFreeModelId("openrouter/vendor-x/unknown-paid")).toBe(false);
  });
});
