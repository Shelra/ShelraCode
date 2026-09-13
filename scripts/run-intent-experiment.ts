#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ClaudeCliProvider } from "../src/intelligence/claude-cli";
import { CORPUS } from "../src/intent/corpus";
import { runExperiment } from "../src/intent/experiment";
import { renderReport } from "../src/intent/scoring";

/**
 * Runs the intent-gap measurement and writes both the rendered summary and the raw record.
 *
 * The raw record matters more than the summary: every number in the report is recomputable from
 * it, including by someone who does not believe the summary.
 */

function flag(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

async function main(): Promise<void> {
  const samples = Number.parseInt(flag("samples", "5"), 10);
  const repeats = Number.parseInt(flag("repeats", "10"), 10);
  const seed = Number.parseInt(flag("seed", "20260907"), 10);
  const only = flag("only", "");
  const out = resolve(flag("out", "docs/research/results/intent-gap-run.json"));

  const cases = only ? CORPUS.filter((entry) => entry.id === only) : CORPUS;
  if (cases.length === 0) {
    console.error(`no cases matched "${only}"`);
    process.exit(1);
  }

  const provider = new ClaudeCliProvider();
  const availability = await provider.checkAvailability();
  if (!availability.available) {
    console.error(`intelligence unavailable: ${availability.detail}`);
    process.exit(1);
  }

  const decisions = cases.reduce((total, entry) => total + entry.decisions.length, 0);
  console.error(`running ${cases.length} case(s), ${decisions} decisions, ${samples} samples, ${repeats} repeats`);

  const report = await runExperiment(provider, cases, {
    samples,
    repeats,
    seed,
    onProgress: (message) => console.error(`  ${message}`),
  });

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2), "utf8");
  const rendered = renderReport(report);
  writeFileSync(out.replace(/\.json$/u, ".txt"), rendered, "utf8");

  console.log(`\n${rendered}\n`);
  console.error(`raw record: ${out}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
