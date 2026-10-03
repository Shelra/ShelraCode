"""ShelraCode as a Harbor installed agent, for the public SWE-bench Pro comparison (bench/public/README.md).

Run it with Harbor's import-path agent syntax, e.g.:

    PYTHONPATH=bench/public/harbor harbor run -p <SWE-bench_Pro-os>/v2/tasks/<instance_id> -e docker -n 1 \\
        -a shelra_agent:ShelraAgent -m openrouter/nvidia/nemotron-3-ultra-550b-a55b:free \\
        --allow-agent-host openrouter.ai \\
        --ak binary_path=/path/to/shelra-linux-x64 --ak step_limit=50 --ak time_limit_sec=2910

What it does, in the task's own container:

* install (setup phase, network allowed): uploads the released Linux binary from the host (``binary_path``), or
  downloads ``binary_url`` inside the sandbox; either way the SHA-256 must match ``binary_sha256``. Then it checks
  that ``shelra --version`` runs on the task image.
* run (agent phase; under SWE-bench Pro v2's locked protocol only the model endpoint is reachable): writes the task
  instruction to a file and runs ``shelra_runner.sh``, which runs ``shelra -p <instruction> --format json`` in the
  repository directory with the benchmark's step and time limits (see that script). Research is off
  (``SHELRA_RESEARCH=off``): neither harness may use the web. Fallback models are off
  (``SHELRA_FALLBACK_MODELS`` names the model under test): both harnesses must run the same model.
* after the run: writes the repository diff to ``/logs/agent/model.patch`` (as Scale's locked agents do), and on the
  host parses ``shelra.jsonl`` into ``shelra-summary.json``: steps, tokens, the host's verdict line ("[Checked by
  Shelra …]", "[Not verified …]", …), whether the free daily quota ran out, and every model that served a step.

The OpenRouter key is read from the host environment (``OPENROUTER_API_KEY``) and passed to the process
environment only; nothing here prints it. A model can still read its own environment with a shell command, so the
benchmark driver (run_subset.py) scrubs the key from every result file before they are uploaded.
"""

from __future__ import annotations

import json
import re
import shlex
import tempfile
from pathlib import Path
from typing import Any

from pydantic import Field

from harbor.agents.installed.base import BaseInstalledAgent, with_prompt_template
from harbor.agents.options import InstalledAgentOptions
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

HERE = Path(__file__).resolve().parent
RUNNER = HERE / "shelra_runner.sh"

DEFAULT_VERSION = "1.1.9"
DEFAULT_BINARY_URL = "https://github.com/Shelra/ShelraCode/releases/download/shelra%401.1.9/shelra-linux-x64"
# From the release's checksums.txt (GitHub reports the same digest for the asset).
DEFAULT_BINARY_SHA256 = "d0ee05b73ebc2336576cd18a23408f24aa5b0cb8aaad0924517cfc4026b67b32"

INSTALL_DIR = "/installed-agent"
BIN_PATH = f"{INSTALL_DIR}/shelra"
RUNNER_PATH = f"{INSTALL_DIR}/shelra-runner.sh"
INSTRUCTION_PATH = f"{INSTALL_DIR}/instruction.md"

# Same capture as Scale's locked agents (v2/tooling/locked_*.py), minus Shelra's own workspace folder.
CAPTURE_PATCH = (
    "mkdir -p /logs/agent; "
    "repo=$(git -C /app rev-parse --show-toplevel 2>/dev/null || git -C /testbed rev-parse --show-toplevel "
    "2>/dev/null || echo /app); "
    "cd \"$repo\" && git add -A -- . ':(exclude).shelra' 2>/dev/null; "
    "git diff --cached > /logs/agent/model.patch 2>/dev/null; git reset -q 2>/dev/null; "
    "wc -c < /logs/agent/model.patch; true"
)

VERDICT_RE = re.compile(
    r"\[(Checked by Shelra|Not verified|Not marked complete|Limited|Paused|Cancelled|Stopped)\b[^\]]{0,600}\]?"
)
VERDICT_KIND = {
    "Checked by Shelra": "checked",
    "Not verified": "not_verified",
    "Not marked complete": "not_marked_complete",
    "Limited": "limited",
    "Paused": "paused",
    "Cancelled": "cancelled",
    "Stopped": "stopped",
}
DAILY_QUOTA_RE = re.compile(r"free-models-per-day", re.IGNORECASE)


class ShelraOptions(InstalledAgentOptions):
    binary_path: str | None = Field(
        default=None, description="Host path of the shelra-linux-x64 release binary to upload into the sandbox."
    )
    binary_url: str = Field(default=DEFAULT_BINARY_URL, description="Download URL used when binary_path is unset.")
    binary_sha256: str | None = Field(
        default=DEFAULT_BINARY_SHA256, description="Expected SHA-256 of the binary; empty to skip the check."
    )
    step_limit: int = Field(default=50, description="Maximum model steps (step_finish events) per task.")
    time_limit_sec: int = Field(default=2910, description="Wall-clock budget before SIGTERM, in seconds.")
    kill_grace_sec: int = Field(default=30, description="Seconds between SIGTERM and SIGKILL.")
    model_policy: str = Field(default="free", description="ShelraCode --model-policy (free never runs a paid model).")


class ShelraAgent(BaseInstalledAgent):
    options_model = ShelraOptions
    options: ShelraOptions

    @staticmethod
    def name() -> str:
        return "shelra"

    def get_version_command(self) -> str | None:
        return f"{BIN_PATH} --version"

    def parse_version(self, stdout: str) -> str:
        match = re.search(r"(\d+\.\d+\.\d+\S*)", stdout)
        return match.group(1) if match else stdout.strip()

    @property
    def _openrouter_model(self) -> str:
        if not self.model_name:
            raise ValueError("pass the model with -m openrouter/<model-id>")
        return self.model_name.removeprefix("openrouter/")

    async def install(self, environment: BaseEnvironment) -> None:
        await self.exec_as_root(environment, command=f"mkdir -p {INSTALL_DIR}")
        sha = (self.options.binary_sha256 or "").strip().lower()
        if self.options.binary_path:
            local = Path(self.options.binary_path).expanduser()
            if not local.is_file():
                raise FileNotFoundError(f"binary_path does not exist: {local}")
            await environment.upload_file(local, BIN_PATH)
        else:
            url = shlex.quote(self.options.binary_url)
            fetch = (
                f"cd {INSTALL_DIR} && rm -f shelra; "
                f"if command -v curl >/dev/null 2>&1; then curl -fsSL --retry 3 -m 600 -o shelra {url}; "
                f"elif command -v wget >/dev/null 2>&1; then wget -q -T 600 -t 3 -O shelra {url}; "
                "elif command -v python3 >/dev/null 2>&1; then python3 -c "
                f"'import sys, urllib.request; urllib.request.urlretrieve(sys.argv[1], \"shelra\")' {url}; "
                "else echo NO_DOWNLOADER >&2; exit 3; fi"
            )
            await self.exec_as_root(environment, command=fetch, timeout_sec=900)
        if sha:
            check = (
                f"if command -v sha256sum >/dev/null 2>&1; then echo '{sha}  {BIN_PATH}' | sha256sum -c -; "
                "else python3 -c 'import hashlib, sys; "
                "h = hashlib.sha256(open(sys.argv[1], \"rb\").read()).hexdigest(); "
                f"sys.exit(0 if h == sys.argv[2] else 1)' {BIN_PATH} {sha}; fi"
            )
            await self.exec_as_root(environment, command=check, timeout_sec=300)

        with tempfile.TemporaryDirectory(prefix="shelra-runner-") as tmp:
            runner = Path(tmp) / "shelra-runner.sh"
            runner.write_bytes(RUNNER.read_bytes().replace(b"\r\n", b"\n"))
            await environment.upload_file(runner, RUNNER_PATH)
        # The binary must start on this task image (glibc, CPU features); a failure here fails the setup phase.
        await self.exec_as_root(
            environment,
            command=f"chmod 755 {BIN_PATH} {RUNNER_PATH} && {BIN_PATH} --version",
            timeout_sec=120,
        )

    def _run_env(self) -> dict[str, str]:
        key = self._get_env("OPENROUTER_API_KEY")
        if not key:
            raise ValueError("OPENROUTER_API_KEY is not set in the environment that runs harbor")
        model = self._openrouter_model
        return {
            "OPENROUTER_API_KEY": key,
            "SHELRA_MODEL": model,
            "SHELRA_MODEL_POLICY": self.options.model_policy,
            # Same model for every step: no client-side fallback to other free models or routers.
            "SHELRA_FALLBACK_MODELS": model,
            # Neither harness may use the web during the agent phase (Scale's locked protocol).
            "SHELRA_RESEARCH": "off",
            "SHELRA_STEP_LIMIT": str(self.options.step_limit),
            "SHELRA_TIME_LIMIT_SEC": str(self.options.time_limit_sec),
            "SHELRA_KILL_GRACE_SEC": str(self.options.kill_grace_sec),
            "SHELRA_LOG_DIR": "/logs/agent",
            "SHELRA_TRACE_DIR": "/logs/agent/trace",
            "SHELRA_DIAGNOSTICS_LOG": "/logs/agent/swallowed-errors.jsonl",
            "NO_COLOR": "1",
            "CI": "1",
        }

    @with_prompt_template
    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext) -> None:
        try:
            with tempfile.TemporaryDirectory(prefix="shelra-task-") as tmp:
                path = Path(tmp) / "instruction.md"
                path.write_text(instruction, encoding="utf-8")
                await environment.upload_file(path, INSTRUCTION_PATH)
            budget = self.options.time_limit_sec + self.options.kill_grace_sec + 60
            await self.exec_as_agent(
                environment,
                command=f"bash {RUNNER_PATH} 2>&1 | tail -n 5",
                env=self._run_env(),
                timeout_sec=budget,
            )
        finally:
            try:
                result = await environment.exec(command=CAPTURE_PATCH, user="root", timeout_sec=300)
                self.logger.info(f"model.patch bytes: {(result.stdout or '').strip()}")
            except Exception as exc:  # never mask the trial outcome
                self.logger.warning(f"patch capture failed: {exc}")

    def populate_context_post_run(self, context: AgentContext) -> None:
        summary = summarize_shelra_logs(self.logs_dir, self._openrouter_model if self.model_name else None)
        (self.logs_dir / "shelra-summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
        context.n_input_tokens = summary["input_tokens"]
        context.n_output_tokens = summary["output_tokens"]
        context.cost_usd = 0.0
        context.metadata = {**(context.metadata or {}), "shelra": summary}


def _base_model(model_id: str | None) -> str:
    return (model_id or "").removeprefix("openrouter/").removesuffix(":free")


def summarize_shelra_logs(logs_dir: Path, requested_model: str | None) -> dict[str, Any]:
    """Read shelra.jsonl, shelra.stderr.txt and runner.json from a trial's agent folder."""
    events: list[dict[str, Any]] = []
    jsonl = logs_dir / "shelra.jsonl"
    raw = jsonl.read_text(encoding="utf-8", errors="replace") if jsonl.exists() else ""
    for line in raw.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    stderr_path = logs_dir / "shelra.stderr.txt"
    stderr = stderr_path.read_text(encoding="utf-8", errors="replace") if stderr_path.exists() else ""
    runner_path = logs_dir / "runner.json"
    try:
        runner = json.loads(runner_path.read_text(encoding="utf-8")) if runner_path.exists() else {}
    except json.JSONDecodeError:
        runner = {}

    steps = 0
    input_tokens = 0
    output_tokens = 0
    tool_calls = 0
    texts: list[str] = []
    errors: list[str] = []
    served: set[str] = set()
    limit_events: list[dict[str, Any]] = []
    for event in events:
        kind = event.get("type")
        if kind == "step_finish":
            steps += 1
            usage = event.get("usage") or {}
            input_tokens += int(usage.get("inputTokens") or 0)
            output_tokens += int(usage.get("outputTokens") or 0)
        elif kind == "tool_use":
            tool_calls += 1
        elif kind == "text":
            texts.append(str(event.get("text") or ""))
        elif kind == "error":
            errors.append(str(event.get("message") or "")[:500])
        elif kind == "limit":
            limit_events.append({k: event.get(k) for k in ("provider", "name", "resetsAt", "estimated")})
        elif kind == "model_selected":
            served.add(str(event.get("modelId") or ""))
        elif kind == "model":
            served.add(str(event.get("servedModelId") or event.get("modelId") or ""))
    served.discard("")

    verdict = None
    verdict_kind = None
    full_text = "\n".join(texts)
    matches = list(VERDICT_RE.finditer(full_text))
    if matches:
        verdict = matches[-1].group(0)[:600]
        verdict_kind = VERDICT_KIND[matches[-1].group(1)]

    stop_reason = runner.get("stop_reason")
    exit_code = runner.get("exit_code")
    if verdict_kind:
        claim = verdict_kind
    elif stop_reason == "exit" and exit_code == 0 and steps > 0:
        claim = "unmarked"  # the turn ended normally without a host verdict line
    elif stop_reason in ("step_limit", "time_limit"):
        claim = f"cut_{stop_reason}"
    else:
        claim = "no_answer"

    # A `limit` event means the provider's free allowance is used up (the turn ended "[Limited — …]").
    quota_hit = bool(limit_events or DAILY_QUOTA_RE.search(raw) or DAILY_QUOTA_RE.search(stderr))
    requested = _base_model(requested_model)
    other_models = sorted(m for m in served if requested and _base_model(m) != requested)
    return {
        "requested_model": requested_model,
        "steps": steps,
        "tool_calls": tool_calls,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "verdict": verdict,
        "verdict_kind": verdict_kind,
        "claim": claim,
        "claimed_done": claim in ("checked", "unmarked"),
        "stop_reason": stop_reason,
        "exit_code": exit_code,
        "elapsed_sec": runner.get("elapsed_sec"),
        "quota_hit": quota_hit,
        "limit_events": limit_events,
        "errors": errors[-5:],
        "served_models": sorted(served),
        "other_models": other_models,
        "model_contaminated": bool(other_models),
    }
