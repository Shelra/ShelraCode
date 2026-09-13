import path from "node:path";
import packageJson from "../package.json" with { type: "json" };
import { installExecutable } from "../src/cli/installation";
import { CLI_NAME, PRODUCT_NAME } from "../src/product/identity";

const projectRoot = path.resolve(import.meta.dir, "..");
const distDirectory = path.join(projectRoot, "dist");
const entrypoint = path.join(projectRoot, "src", "index.ts");

// OpenTUI loads the native package for the current operating system at runtime.
// Keeping these packages external in the JavaScript bundle avoids shipping a
// platform-specific native module in dist/index.js. The compiled executable is
// built separately with Bun and carries the native runtime it needs.
const opentuiNativePackages = [
  "@opentui/core-darwin-x64",
  "@opentui/core-darwin-arm64",
  "@opentui/core-linux-x64",
  "@opentui/core-linux-arm64",
  "@opentui/core-linux-x64-musl",
  "@opentui/core-linux-arm64-musl",
  "@opentui/core-win32-x64",
  "@opentui/core-win32-arm64",
];

function printBuildLogs(logs: readonly unknown[]): void {
  for (const log of logs) console.error(log);
}

const bundle = await Bun.build({
  entrypoints: [entrypoint],
  outdir: distDirectory,
  target: "bun",
  conditions: ["browser"],
  external: opentuiNativePackages,
  sourcemap: "external",
});

if (!bundle.success) {
  printBuildLogs(bundle.logs);
  throw new Error(`${PRODUCT_NAME} JavaScript bundle failed.`);
}

// Keep package consumers and editor tooling supplied with declarations while
// using the bundled index.js as the executable entrypoint.
const declarations = Bun.spawn(["bun", "x", "tsc", "--emitDeclarationOnly", "--pretty", "false"], {
  cwd: projectRoot,
  stdout: "inherit",
  stderr: "inherit",
});
if ((await declarations.exited) !== 0) {
  throw new Error(`${PRODUCT_NAME} declaration build failed.`);
}

const executableName = process.platform === "win32" ? `${CLI_NAME}.exe` : CLI_NAME;
const executablePath = path.join(distDirectory, executableName);
const compileTarget =
  process.platform === "win32"
    ? process.arch === "x64"
      ? "bun-windows-x64"
      : process.arch === "arm64"
        ? "bun-windows-arm64"
        : undefined
    : undefined;

if (process.platform === "win32" && compileTarget === undefined) {
  throw new Error(`Standalone ${PRODUCT_NAME} builds do not support Windows architecture ${process.arch}.`);
}

const compileOptions: Bun.CompileBuildOptions = {
  outfile: executablePath,
  // The executable is intended to run from any working directory and must not
  // resolve the checkout's bunfig, .env, package.json, or node_modules.
  autoloadBunfig: false,
  autoloadDotenv: true,
  autoloadPackageJson: false,
  ...(compileTarget === undefined ? {} : { target: compileTarget }),
  ...(process.platform === "win32"
    ? {
        windows: {
          hideConsole: false,
          title: PRODUCT_NAME,
          publisher: PRODUCT_NAME,
          version: packageJson.version,
          description: "Local-first autonomous coding agent",
          copyright: "Copyright ShelraCode",
        },
      }
    : {}),
};

const executable = await Bun.build({
  entrypoints: [entrypoint],
  target: "bun",
  conditions: ["browser"],
  // Standalone binaries cannot depend on the source checkout's node_modules.
  packages: "bundle",
  compile: compileOptions,
});

if (!executable.success) {
  printBuildLogs(executable.logs);
  throw new Error(`${PRODUCT_NAME} standalone executable build failed.`);
}

console.log(`Built bundle: ${path.relative(projectRoot, path.join(distDirectory, "index.js"))}`);
console.log(`Built standalone executable: ${path.relative(projectRoot, executablePath)}`);

if (process.env.SHELRA_BUILD_SKIP_INSTALL === "1") {
  console.log("Skipped per-user installation (SHELRA_BUILD_SKIP_INSTALL=1).");
} else {
  const installDir = process.env.SHELRA_INSTALL_BIN?.trim() || undefined;
  try {
    const installed = await installExecutable({
      sourcePath: executablePath,
      version: packageJson.version,
      installDir,
      platform: process.platform,
      architecture: process.arch,
    });
    console.log(`Installed active ${PRODUCT_NAME} ${installed.manifest.version}.`);
    console.log(`Global command: ${CLI_NAME}`);
    console.log(`Install directory: ${installed.paths.binDir}`);
    if (installed.pathPersisted) {
      console.log("User PATH updated. Open a new terminal to use shelra everywhere.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isLock =
      message.includes("still running or locked") || message.includes("EPERM") || message.includes("EBUSY");
    if (!isLock) throw error;
    console.warn(
      "The executable in %USERPROFILE%\\.shelra\\bin is locked. The bundle in dist/ was built successfully.",
    );
    console.warn(message);
    console.warn(
      "Close running shelra processes and run `bun run build` again, or set SHELRA_BUILD_SKIP_INSTALL=1 to skip installation.",
    );
  }
}
