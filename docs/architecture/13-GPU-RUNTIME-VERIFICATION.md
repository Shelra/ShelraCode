# GPU runtime verification

## Objective

Ensure the local-first runtime uses the discrete NVIDIA GPU when it is
available, without requiring Ollama, LM Studio, a manually started server, or
a remote provider.

## Root cause found on the target machine

The previously installed managed executable was the llama.cpp CPU package.
Running its own device probe returned `(none)`, so a model could only execute
on the CPU. Windows Task Manager therefore showed the integrated AMD adapter
doing the work while the NVIDIA GTX 1650 remained mostly idle.

## Target implementation

`src/runtimes/bootstrap.ts` now probes `nvidia-smi` during backend selection.
On Windows x64 it selects the pinned llama.cpp CUDA 12.4 release and its
pinned `cudart` dependency package. Both archives are downloaded with resume
support, verified by SHA-256, extracted atomically, and stored under:

```text
%USERPROFILE%\\.shelra\\runtime\\llama-cpp\\b10826-cuda
```

`src/runtimes/managed-llama.ts` starts that server with:

```text
--device CUDA0 --gpu-layers all --split-mode none --main-gpu 0
```

The CUDA path caps the default context at 16,384 tokens to leave memory for
KV cache, runtime overhead, and the desktop. `SHELRA_GPU_CONTEXT` can override
that cap for advanced users. `SHELRA_RUNTIME_BACKEND=cpu` remains an explicit
fallback; machines without NVIDIA acceleration automatically use the CPU
runtime.

## Evidence from this host

- `nvidia-smi --query-gpu=name,memory.total,memory.free` reported
  `NVIDIA GeForce GTX 1650, 4096, 3509` (MiB).
- The installed CUDA executable's `--list-devices` probe reported:
  `CUDA0: NVIDIA GeForce GTX 1650 (4095 MiB, 3296 MiB free)`.
- A direct loopback health check returned HTTP 200 and a local completion
  returned `READY`.
- The installed `shelra` executable completed a real headless prompt from a
  temporary working directory with exit code 0.
- During a real CLI generation, `nvidia-smi` reported the NVIDIA adapter at
  **100% utilization**, 1,976 MiB used of 4,096 MiB, and listed
  `...\\.shelra\\runtime\\llama-cpp\\b10826-cuda\\llama-server.exe` as a
  compute process. This is the discrete NVIDIA adapter (Task Manager labels it
  GPU 1 because the AMD adapter is GPU 0).
- After the CLI exited, a process check found no resident `shelra.exe` or
  `llama-server.exe` child.

## Verification status

**VERIFIED for backend selection and real GPU execution on this Windows x64
machine.** The short deterministic prompt and a longer natural-language
generation both exercised the CUDA server. Throughput on a 4 GiB GTX 1650 is
hardware-limited and is not represented as a performance guarantee.

The binary and CUDA artifacts are from the pinned
[llama.cpp b10826 release](https://github.com/ggml-org/llama.cpp/releases/tag/b10826).
