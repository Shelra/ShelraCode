import { testRender } from "@opentui/react/test-utils";
import { describe, expect, it } from "vitest";
import { RuntimeActivityTree } from "./app";
import type { UiActivityEvent } from "./observability";
import { dark } from "./theme";

const NOW = 1_000_000;

function exploring(): UiActivityEvent[] {
  return [
    { id: "1", kind: "tool", status: "active", label: "read_file", operation: "read_file", at: NOW - 5_000 },
    { id: "2", kind: "tool", status: "active", label: "read_file", operation: "read_file", at: NOW - 4_000 },
    { id: "3", kind: "tool", status: "active", label: "grep", operation: "grep", at: NOW - 3_000 },
  ];
}

describe("RuntimeActivityTree", () => {
  it("renders grouped counts, Found, and Next as a branch tree — the mandated live-activity format", async () => {
    const screen = await testRender(
      <RuntimeActivityTree
        t={dark}
        title="Investigating session restoration"
        elapsedMs={42_000}
        activities={exploring()}
        now={NOW}
        found="Task state isn't restored on resume."
        next="Patch hydration and run restart test."
        isProcessing
      />,
      { width: 100, height: 20 },
    );
    await screen.renderOnce();
    const frame = screen.captureCharFrame();

    expect(frame).toContain("● Investigating session restoration");
    expect(frame).toContain("42s");
    expect(frame).toContain("├─ Explored 2 files");
    expect(frame).toContain("├─ Searched 1 symbol");
    expect(frame).toContain("├─ Found");
    expect(frame).toContain("Task state isn't restored on resume.");
    expect(frame).toContain("└─ Next");
    expect(frame).toContain("Patch hydration and run restart test.");
    // Raw per-file rows must never appear — only the collapsed counts.
    expect(frame).not.toContain("Reading");
    screen.renderer.destroy();
  });

  it("renders a failed event with the × marker and no Next callout", async () => {
    const events: UiActivityEvent[] = [
      { id: "1", kind: "tool", status: "failed", label: "bash", operation: "bash", detail: "1 test failed", at: NOW },
    ];
    const screen = await testRender(
      <RuntimeActivityTree
        t={dark}
        title="Running restart test"
        elapsedMs={11_000}
        activities={events}
        now={NOW}
        found={null}
        next="Should never appear when a check just failed"
        isProcessing={false}
      />,
      { width: 100, height: 20 },
    );
    await screen.renderOnce();
    const frame = screen.captureCharFrame();

    expect(frame).toContain("× Running restart test");
    expect(frame).toContain("1 test failed");
    expect(frame).not.toContain("Should never appear");
    screen.renderer.destroy();
  });

  it("renders nothing when there is no title and no groupable activity", async () => {
    const screen = await testRender(
      <RuntimeActivityTree
        t={dark}
        title={null}
        elapsedMs={null}
        activities={[]}
        now={NOW}
        found={null}
        next={null}
        isProcessing={false}
      />,
      { width: 100, height: 20 },
    );
    await screen.renderOnce();
    const frame = screen.captureCharFrame();

    expect(frame.trim()).toBe("");
    screen.renderer.destroy();
  });
});
