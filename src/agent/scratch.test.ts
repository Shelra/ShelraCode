import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { join, parse } from "path";
import { describe, expect, it } from "vitest";
import { resolveWorkspacePath, SCRATCH_ROOT } from "../security/workspace-guard";
import { isOutsideProject, scratchLineFor } from "./scratch";

const folder = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));

describe("isOutsideProject", () => {
  it("treats the home folder and a drive root as outside any project", () => {
    expect(isOutsideProject(homedir())).toBe(true);
    expect(isOutsideProject(parse(process.cwd()).root)).toBe(true);
  });

  it("treats a folder with no repository and no manifest as outside a project", () => {
    expect(isOutsideProject(folder("shelra-downloads-"))).toBe(true);
  });

  it("recognizes a project by its repository or its manifest", () => {
    const repo = folder("shelra-repo-");
    mkdirSync(join(repo, ".git"));
    expect(isOutsideProject(join(repo))).toBe(false);
    const node = folder("shelra-node-");
    writeFileSync(join(node, "package.json"), "{}");
    expect(isOutsideProject(node)).toBe(false);
    const dotnet = folder("shelra-dotnet-");
    writeFileSync(join(dotnet, "App.sln"), "");
    expect(isOutsideProject(dotnet)).toBe(false);
  });
});

describe("scratch folder", () => {
  it("is named in the prompt only outside a project", () => {
    const outside = folder("shelra-plain-");
    const line = scratchLineFor(outside);
    expect(line).toContain("This directory is not a project.");
    expect(line).toContain(SCRATCH_ROOT);
    const project = folder("shelra-project-");
    writeFileSync(join(project, "package.json"), "{}");
    expect(scratchLineFor(project)).toBe("");
  });

  it("is writable by the file tools from any workspace, while other outside paths stay closed", () => {
    const workspace = folder("shelra-workspace-");
    const helper = join(SCRATCH_ROOT, "test-session", "check_camera.ps1");
    expect(resolveWorkspacePath(helper, workspace).path).toBe(helper);
    expect(resolveWorkspacePath(helper, workspace).relativePath).toBe(helper.replaceAll("\\", "/"));
    expect(() => resolveWorkspacePath(join(tmpdir(), "elsewhere.ps1"), workspace)).toThrow("outside the workspace");
    expect(() => resolveWorkspacePath(join(SCRATCH_ROOT, "..", "escape.ps1"), workspace)).toThrow(
      "outside the workspace",
    );
  });
});
