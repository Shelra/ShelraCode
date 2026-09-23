import type { KeyBinding } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, useState } from "react";
import { describe, expect, it } from "vitest";
import { TextArea } from "./text-area";

const SUBMIT_ON_ENTER: KeyBinding[] = [{ name: "return", action: "submit" }];

/** Re-renders with a new submit handler on the first Enter, like a component whose state changed. */
function Harness({ calls, raw }: { calls: string[]; raw: boolean }) {
  const [version, setVersion] = useState(1);
  const onSubmit = () => {
    calls.push(`v${version}`);
    setVersion((current) => current + 1);
  };
  return raw ? (
    <textarea focused keyBindings={SUBMIT_ON_ENTER} onSubmit={onSubmit as never} />
  ) : (
    <TextArea focused keyBindings={SUBMIT_ON_ENTER} onSubmit={onSubmit} />
  );
}

async function pressEnterTwice(raw: boolean): Promise<string[]> {
  const calls: string[] = [];
  const setup = await testRender(<Harness calls={calls} raw={raw} />, { width: 40, height: 5 });
  await setup.renderOnce();
  // act() lets React re-render between the two presses, as the app does between two submits.
  await act(async () => setup.mockInput.pressEnter());
  await setup.renderOnce();
  await act(async () => setup.mockInput.pressEnter());
  await setup.renderOnce();
  setup.renderer.destroy();
  return calls;
}

describe("TextArea", () => {
  it("calls the handler of the latest render", async () => {
    expect(await pressEnterTwice(false)).toEqual(["v1", "v2"]);
  });

  it("works around OpenTUI's textarea keeping its first handler", async () => {
    // If this starts failing, OpenTUI now updates onSubmit on textareas and TextArea is optional.
    expect(await pressEnterTwice(true)).toEqual(["v1", "v1"]);
  });
});
