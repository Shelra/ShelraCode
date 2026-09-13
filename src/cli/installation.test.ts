import { Buffer } from "node:buffer";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultInstallDirectory, installExecutable, mergePathEntries, readActiveInstallation } from "./installation";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

describe("Shelra executable installation", () => {
  it("resolves the user-level install directory on Windows", () => {
    expect(defaultInstallDirectory("win32", { USERPROFILE: "C:\\Users\\test" })).toBe(
      path.join("C:\\Users\\test", ".shelra", "bin"),
    );
  });

  it("merges PATH entries idempotently", () => {
    const entry = "C:\\Users\\test\\.shelra\\bin";
    const existing = `C:\\Tools${path.delimiter}${entry}\\`;
    expect(mergePathEntries(existing, entry).split(path.delimiter)).toHaveLength(2);
    expect(mergePathEntries("C:\\Tools", entry)).toBe(`C:\\Tools${path.delimiter}${entry}`);
  });

  it("atomically installs the executable, backs up the previous version, and writes the active manifest", async () => {
    const root = await temporaryDirectory("shelra-install-");
    const profile = path.join(root, "profile");
    const installDir = path.join(profile, ".shelra", "bin");
    const sourceOne = path.join(root, "shelra-one.exe");
    const sourceTwo = path.join(root, "shelra-two.exe");
    const firstBytes = Buffer.from([0x4d, 0x5a, 0x01]);
    const secondBytes = Buffer.from([0x4d, 0x5a, 0x02]);
    await writeFile(sourceOne, firstBytes);
    await writeFile(sourceTwo, secondBytes);

    const first = await installExecutable({
      sourcePath: sourceOne,
      version: "1.1.7",
      platform: "win32",
      architecture: "x64",
      installDir,
      environment: { USERPROFILE: profile, Path: "C:\\Windows" },
      persistUserPath: false,
      now: new Date("2026-09-06T12:00:00.000Z"),
    });
    expect(await readFile(first.paths.executablePath)).toEqual(firstBytes);
    expect(JSON.parse(await readFile(first.paths.manifestPath, "utf8"))).toMatchObject({
      product: "ShelraCode",
      command: "shelra",
      version: "1.1.7",
      executable: "shelra.exe",
    });

    const second = await installExecutable({
      sourcePath: sourceTwo,
      version: "1.1.8",
      platform: "win32",
      architecture: "x64",
      installDir,
      environment: { USERPROFILE: profile, Path: "C:\\Windows" },
      persistUserPath: false,
      now: new Date("2026-09-06T12:01:00.000Z"),
    });
    expect(await readFile(second.paths.executablePath)).toEqual(secondBytes);
    expect(await readFile(`${second.paths.executablePath}.previous`)).toEqual(firstBytes);
    expect(second.previousVersionBackedUp).toBe(true);
    await expect(stat(second.paths.executablePath)).resolves.toBeDefined();

    const active = await readActiveInstallation(profile);
    expect(active?.manifest).toMatchObject({
      product: "ShelraCode",
      command: "shelra",
      version: "1.1.8",
      platform: "win32",
      architecture: "x64",
    });
    expect(active?.paths.executablePath).toBe(second.paths.executablePath);
  });
});
