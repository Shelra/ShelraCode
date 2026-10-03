#!/usr/bin/env node
// ShelraCode's npm entry point: runs this platform's release binary, installed as an optional dependency
// (src/release/npm.ts). Arguments, the terminal and the exit code pass straight through.
"use strict";

const { spawnSync } = require("node:child_process");

const PACKAGES = {
  "win32-x64": ["shelra-windows-x64", "shelra.exe"],
  "linux-x64": ["shelra-linux-x64", "shelra"],
  "darwin-arm64": ["shelra-darwin-arm64", "shelra"],
};

const key = `${process.platform}-${process.arch}`;
const entry = PACKAGES[key];
if (!entry) {
  console.error(
    `ShelraCode has no build for ${key} yet (there are builds for ${Object.keys(PACKAGES).join(", ")}). See https://github.com/Shelra/ShelraCode.`,
  );
  process.exit(1);
}

let binary;
try {
  binary = require.resolve(`${entry[0]}/bin/${entry[1]}`);
} catch {
  console.error(
    `ShelraCode's binary package ${entry[0]} is not installed. Install again with optional dependencies enabled, for example: npm install -g shelra`,
  );
  process.exit(1);
}

const result = spawnSync(binary, process.argv.slice(2), { stdio: "inherit", windowsHide: false });
if (result.error) {
  console.error(`Could not start ShelraCode (${binary}): ${result.error.message}`);
  process.exit(1);
}
if (result.signal) process.kill(process.pid, result.signal);
process.exit(result.status ?? 1);
