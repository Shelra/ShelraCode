import { describe, expect, it } from "vitest";
import { auroraEdgeColor } from "./aurora";
import { dark, light } from "./theme";

describe("AuroraEdge", () => {
  it("uses one controlled emerald, cyan, violet sequence", () => {
    expect(auroraEdgeColor(dark, 0, 0)).toBe(dark.aurora.green);
    expect(auroraEdgeColor(dark, 11, 0)).toBe(dark.aurora.cyan);
    expect(auroraEdgeColor(dark, 22, 0)).toBe(dark.aurora.violet);
    expect(auroraEdgeColor(light, 8, 3)).toBe(light.aurora.cyan);
  });

  it("holds a static first frame when reduced motion is selected", () => {
    const firstFrame = Array.from({ length: 12 }, (_, index) => auroraEdgeColor(dark, index, 0));
    const reducedMotionFrame = Array.from({ length: 12 }, (_, index) => auroraEdgeColor(dark, index, 0));

    expect(reducedMotionFrame).toEqual(firstFrame);
  });
});
