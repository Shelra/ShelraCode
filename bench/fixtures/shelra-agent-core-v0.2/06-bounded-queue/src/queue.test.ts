import { expect, test } from "bun:test";
import { runQueue } from "./queue";

test("settles values in input order", async () => {
  await expect(runQueue([1, 2], async (value) => value * 2)).resolves.toEqual([
    { status: "fulfilled", value: 2 },
    { status: "fulfilled", value: 4 },
  ]);
});
