import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

/**
 * Windows DPAPI (current user) for ORIONMCP credentials.
 *
 * Why this is not "just PowerShell": every protect/unprotect used to start `powershell.exe` with `spawnSync`, which stops
 * the whole JavaScript thread for 300-600 ms (measured 2026-10-05; far longer on a loaded machine or with antivirus) and the
 * credentials were read again on EVERY turn. While the thread is stopped the terminal UI cannot repaint, its timers do not
 * fire and typing is not read: the screen "freezes". Under Bun the same DPAPI functions are called directly through
 * `bun:ffi` (microseconds, no process). PowerShell stays as the fallback for runtimes without FFI (Node, tests).
 *
 * Blob format is the one `ProtectedData.Protect(…, null, CurrentUser)` writes, so files written by either path open with
 * the other.
 */

const CRYPTPROTECT_UI_FORBIDDEN = 0x1;

type Ffi = {
  dlopen: (
    path: string,
    symbols: Record<string, unknown>,
  ) => { symbols: Record<string, (...args: unknown[]) => unknown> };
  ptr: (value: ArrayBufferView) => number;
  toArrayBuffer: (pointer: number, offset: number, length: number) => ArrayBuffer;
  FFIType: Record<string, unknown>;
};

interface Native {
  protect(data: Buffer): Buffer;
  unprotect(data: Buffer): Buffer;
}

let native: Native | null | undefined;

function loadNative(): Native | null {
  if (native !== undefined) return native;
  native = null;
  if (process.platform !== "win32" || !process.versions.bun) return native;
  try {
    const ffi = createRequire(import.meta.url)("bun:ffi") as Ffi;
    const { FFIType, ptr, toArrayBuffer } = ffi;
    const crypt32 = ffi.dlopen("crypt32.dll", {
      CryptProtectData: {
        args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr],
        returns: FFIType.i32,
      },
      CryptUnprotectData: {
        args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr],
        returns: FFIType.i32,
      },
    }).symbols;
    const kernel32 = ffi.dlopen("kernel32.dll", { LocalFree: { args: [FFIType.ptr], returns: FFIType.ptr } }).symbols;
    // DATA_BLOB on x64: DWORD cbData (+4 padding), BYTE* pbData.
    const blob = (data: Buffer) => {
      const header = Buffer.alloc(16);
      header.writeUInt32LE(data.length, 0);
      header.writeBigUInt64LE(BigInt(ptr(data)), 8);
      return header;
    };
    const run = (fn: (...args: unknown[]) => unknown, data: Buffer): Buffer => {
      const input = Buffer.from(data); // keep the bytes alive while the call runs
      const inHeader = blob(input);
      const out = Buffer.alloc(16);
      const ok = fn(ptr(inHeader), null, null, null, null, CRYPTPROTECT_UI_FORBIDDEN, ptr(out));
      if (!ok) throw new Error("DPAPI call failed");
      const length = out.readUInt32LE(0);
      const address = Number(out.readBigUInt64LE(8));
      const copy = Buffer.from(toArrayBuffer(address, 0, length).slice(0));
      kernel32.LocalFree(address);
      return copy;
    };
    native = {
      protect: (data) => run(crypt32.CryptProtectData as (...a: unknown[]) => unknown, data),
      unprotect: (data) => run(crypt32.CryptUnprotectData as (...a: unknown[]) => unknown, data),
    };
    // Self-test once: a native layer that cannot round-trip is not used.
    const probe = Buffer.from("orionmcp-dpapi-probe");
    if (!native.unprotect(native.protect(probe)).equals(probe)) native = null;
  } catch {
    native = null;
  }
  return native;
}

function powershell(input: Buffer, protect: boolean): Buffer {
  if (process.platform !== "win32") throw new Error("ORIONMCP OAuth credential storage currently requires Windows.");
  const script = `Add-Type -AssemblyName System.Security; $raw = [Convert]::FromBase64String([Console]::In.ReadToEnd()); $out = [Security.Cryptography.ProtectedData]::${protect ? "Protect" : "Unprotect"}($raw, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($out))`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    input: input.toString("base64"),
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
    maxBuffer: 1_048_576,
  });
  if (result.status !== 0 || result.error)
    throw new Error("Windows could not access the protected ORIONMCP credentials. Sign in again.");
  return Buffer.from(result.stdout.trim(), "base64");
}

export function dpapiProtect(data: Buffer): Buffer {
  const fast = loadNative();
  if (fast) {
    try {
      return fast.protect(data);
    } catch {
      /* fall through to PowerShell */
    }
  }
  return powershell(data, true);
}

export function dpapiUnprotect(data: Buffer): Buffer {
  const fast = loadNative();
  if (fast) {
    try {
      return fast.unprotect(data);
    } catch {
      /* a blob this layer cannot open: let PowerShell try before giving up */
    }
  }
  return powershell(data, false);
}
