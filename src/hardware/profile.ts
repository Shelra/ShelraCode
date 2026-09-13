import { execFile as execFileCallback } from "child_process";
import fs from "fs";
import os from "os";
import { promisify } from "util";
import type { LocalModelCandidate } from "../runtimes/types";

const execFile = promisify(execFileCallback);

export interface GpuProfile {
  vendor: string;
  model: string;
  vramTotalGb?: number;
  vramAvailableGb?: number;
  accelerationBackends: string[];
}

export interface HardwareProfile {
  platform: string;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  memoryGb: number;
  memoryAvailableGb?: number;
  gpu?: GpuProfile[];
  storageAvailableGb?: number;
}

function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Fast, synchronous profile used by routing and tests. */
export function inspectHardware(): HardwareProfile {
  return {
    platform: process.platform,
    arch: process.arch,
    cpuModel: os.cpus()[0]?.model?.trim() || "Unknown CPU",
    cpuCores: os.cpus().length,
    memoryGb: round(os.totalmem() / 1024 ** 3),
    memoryAvailableGb: round(os.freemem() / 1024 ** 3),
    gpu: [],
  };
}

type CommandRunner = (command: string, args: string[]) => Promise<string>;

const defaultCommandRunner: CommandRunner = async (command, args) => {
  const result = await execFile(command, args, { timeout: 2_500, windowsHide: true, maxBuffer: 1024 * 1024 });
  return result.stdout;
};

function parseNvidia(output: string): GpuProfile[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const [model, total, available] = line.split(",").map((part) => part?.trim());
      const vramTotalGb = total ? Number(total) / 1024 : undefined;
      const vramAvailableGb = available ? Number(available) / 1024 : undefined;
      if (!model) return [];
      return [
        {
          vendor: "NVIDIA",
          model,
          ...(Number.isFinite(vramTotalGb) ? { vramTotalGb: round(vramTotalGb as number) } : {}),
          ...(Number.isFinite(vramAvailableGb) ? { vramAvailableGb: round(vramAvailableGb as number) } : {}),
          accelerationBackends: ["cuda"],
        },
      ];
    });
}

function parseRocm(output: string): GpuProfile[] {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const model = lines.find((line) => /card series|gpu\d|^[A-Za-z].*radeon/i.test(line));
  if (!model) return [];
  return [{ vendor: "AMD", model, accelerationBackends: ["rocm"] }];
}

function parseMacDisplays(output: string): GpuProfile[] {
  const profiles: GpuProfile[] = [];
  let current: GpuProfile | undefined;
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    const model = line.match(/^(?:Chipset Model|Chip|Model Name):\s*(.+)$/i)?.[1];
    if (model) {
      current = { vendor: /apple/i.test(model) ? "Apple" : "Unknown", model, accelerationBackends: ["metal"] };
      profiles.push(current);
      continue;
    }
    const vram = line.match(/^(?:VRAM|Total.*VRAM):\s*([\d.]+)\s*(GB|MB)/i);
    if (current && vram) {
      const amount = Number(vram[1]);
      current.vramTotalGb = round(vram[2]!.toUpperCase() === "MB" ? amount / 1024 : amount);
    }
  }
  return profiles;
}

async function detectGpus(platform: NodeJS.Platform, run: CommandRunner): Promise<GpuProfile[]> {
  try {
    const output = await run("nvidia-smi", [
      "--query-gpu=name,memory.total,memory.free",
      "--format=csv,noheader,nounits",
    ]);
    const parsed = parseNvidia(output);
    if (parsed.length) return parsed;
  } catch {
    // Probe the next backend. Missing vendor utilities are normal.
  }

  if (platform === "darwin") {
    try {
      return parseMacDisplays(await run("system_profiler", ["SPDisplaysDataType"]));
    } catch {
      return [];
    }
  }

  try {
    return parseRocm(await run("rocm-smi", ["--showproductname"]));
  } catch {
    return [];
  }
}

function detectStorageAvailableGb(): number | undefined {
  try {
    const statfs = (fs as typeof fs & { statfsSync?: (path: string) => { bavail: number; bsize: number } }).statfsSync;
    if (!statfs) return undefined;
    const stats = statfs(process.cwd());
    return round((stats.bavail * stats.bsize) / 1024 ** 3);
  } catch {
    return undefined;
  }
}

/** Detailed asynchronous scan used by startup and onboarding. */
export async function detectHardware(run: CommandRunner = defaultCommandRunner): Promise<HardwareProfile> {
  const base = inspectHardware();
  const gpu = await detectGpus(process.platform, run);
  return {
    ...base,
    gpu,
    storageAvailableGb: detectStorageAvailableGb(),
  };
}

function estimateModelMemoryGb(model: LocalModelCandidate): number | undefined {
  if (model.memoryRequiredGb && model.memoryRequiredGb > 0) return model.memoryRequiredGb;
  if (!model.parameters) return undefined;
  const quant = model.quantization?.toLowerCase() ?? "";
  const bits = quant.includes("q8")
    ? 8
    : quant.includes("q6")
      ? 6
      : quant.includes("q5")
        ? 5
        : quant.includes("q4")
          ? 4
          : 16;
  return (model.parameters / 1_000_000_000) * (bits / 8) * 1.12;
}

/** Conservative fit score. GPU memory is the strongest signal when present. */
export function localModelFitScore(model: LocalModelCandidate, hardware = inspectHardware()): number {
  let score = model.loaded ? 25 : 0;
  if (model.tools) score += 20;
  if (model.capabilityClass === "agent") score += 15;
  else if (model.capabilityClass === "coding") score += 10;
  else if (model.structuredOutput) score += 5;
  if (model.contextWindow >= 32_000) score += 8;

  const memory = estimateModelMemoryGb(model);
  const gpus = hardware.gpu ?? [];
  const availableGpu = gpus.reduce((sum, gpu) => sum + (gpu.vramAvailableGb ?? gpu.vramTotalGb ?? 0), 0);
  const totalGpu = gpus.reduce((sum, gpu) => sum + (gpu.vramTotalGb ?? 0), 0);
  const usableGpu = Math.max(0, (availableGpu || totalGpu) * 0.82);
  if (memory !== undefined && usableGpu > 0) {
    if (memory <= usableGpu * 0.65) score += 38;
    else if (memory <= usableGpu) score += 20;
    else if (memory <= usableGpu * 1.4 && hardware.memoryGb >= memory * 1.5) score += 4;
    else score -= 60;
  } else if (memory !== undefined) {
    const usableRam = (hardware.memoryAvailableGb ?? hardware.memoryGb) * 0.65;
    if (memory <= usableRam) score += 30;
    else if (memory <= hardware.memoryGb * 0.9) score += 10;
    else score -= 45;
  }

  if (memory !== undefined && usableGpu > 0 && memory <= usableGpu) {
    score += Math.max(0, Math.round((1 - memory / usableGpu) * 12));
  }
  if (model.estimatedTokensPerSecond) score += Math.min(10, Math.round(model.estimatedTokensPerSecond / 5));
  return score;
}

export function estimateLocalModelMemoryGb(model: LocalModelCandidate): number | undefined {
  return estimateModelMemoryGb(model);
}
