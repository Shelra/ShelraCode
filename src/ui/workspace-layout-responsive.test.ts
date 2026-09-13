import { describe, expect, it } from "vitest";
import { resolveWorkspaceLayout } from "./workspace-layout";

describe("workspace visual breakpoints", () => {
  it("preserves a wide transcript and inspector at large desktop width", () => {
    expect(resolveWorkspaceLayout(160, true)).toEqual({ sidebarWidth: 38, showSidebar: true, chatWidth: 122 });
  });

  it("keeps a usable composer column on a normal laptop", () => {
    expect(resolveWorkspaceLayout(120, true)).toEqual({ sidebarWidth: 34, showSidebar: true, chatWidth: 86 });
  });

  it("removes the supporting sidebar before it can crush the conversation on narrow terminals", () => {
    expect(resolveWorkspaceLayout(117, true)).toEqual({ sidebarWidth: 34, showSidebar: false, chatWidth: 117 });
    expect(resolveWorkspaceLayout(80, true)).toEqual({ sidebarWidth: 34, showSidebar: false, chatWidth: 80 });
  });
});
