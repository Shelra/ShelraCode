#!/usr/bin/env python3
"""Run one arm of the public SWE-bench Pro comparison: one harness, one free model, one task subset.

Tasks run one at a time (the OpenRouter free quota is shared by everything), each in its own `harbor run`, and the
run can stop and resume at any point:

* every task's outcome is written to <results>/<agent>/<model-slug>/tasks/<instance_id>.json as soon as it is known;
* a task already resolved or unresolved is never run again; a task lost to the daily free quota, or to an
  infrastructure error, is run again by the next invocation (infrastructure errors at most --max-attempts times);
* before each task the OpenRouter key endpoint is read (no model request): when fewer than --min-quota free requests
  are left today the run stops and the remaining tasks stay pending;
* a task whose logs show OpenRouter's "free-models-per-day" 429 (or a Shelra `limit` event) and that did not
  resolve is recorded as quota_lost, not as a failure, and the run stops;
* the run also stops starting tasks when less than --reserve-minutes remain of --budget-minutes (GitHub's job limit).

Subcommands:
  run      run (or resume) an arm
  redact   scrub the OpenRouter key from result and job files (the workflow runs it before uploading artifacts)

Example (pilot, Shelra arm):
  python bench/public/run_subset.py run --agent shelra --model nvidia/nemotron-3-ultra-550b-a55b:free \\
      --subset pilot20 --scale-repo ../SWE-bench_Pro-os --shelra-binary ./shelra-linux-x64
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
HARBOR_DIR = HERE / "harbor"
SUBSETS = {
    "pilot20": HERE / "swebench-pro-pilot20.txt",
    "headline50": HERE / "swebench-pro-headline50.txt",
}
AGENTS = {
    "shelra": "shelra_agent:ShelraAgent",
    # Scale's reference mini-swe-agent for SWE-bench Pro v2 (Harbor's built-in agent plus patch capture, an
    # in-sandbox timeout and fixes for old task images): SWE-bench_Pro-os/v2/tooling/locked_mini_swe.py.
    "mini-swe-agent": "locked_mini_swe:LockedMiniSwe",
}
MINI_SWE_AGENT_VERSION = "2.4.6"
FINAL = {"resolved", "unresolved", "setup_failed", "error"}
RETRYABLE = {"infra_error", "setup_error"}
DAILY_QUOTA_RE = re.compile(rb"free-models-per-day", re.IGNORECASE)
OPENROUTER_KEY_RE = re.compile(rb"sk-or-v1-[0-9A-Za-z]{20,}")


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def log(message: str) -> None:
    print(f"[{now_iso()}] {message}", flush=True)


def normalize_model(model: str) -> str:
    model = model.strip().removeprefix("openrouter/")
    # Owner rules: free models only, and never OpenAI or Anthropic models through OpenRouter.
    if model.startswith(("openai/", "anthropic/")):
        raise SystemExit(f"refused: {model} (no openai/* or anthropic/* models through OpenRouter)")
    if not model.endswith(":free"):
        raise SystemExit(f"refused: {model} is not a ':free' OpenRouter model")
    return model


def model_slug(model: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", model)


def load_subset(name_or_path: str) -> list[str]:
    path = SUBSETS.get(name_or_path, Path(name_or_path))
    ids = [line.strip() for line in path.read_text(encoding="utf-8").splitlines()]
    return [i for i in ids if i and not i.startswith("#")]


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def free_quota(api_key: str | None) -> dict[str, Any] | None:
    """OpenRouter's key endpoint: free-model requests used and left today. Not a model request."""
    if not api_key:
        return None
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/key", headers={"Authorization": f"Bearer {api_key}"}
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read()).get("data") or {}
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
        log(f"could not read the OpenRouter key status: {type(exc).__name__}")
        return None
    daily = data.get("free_model_daily_requests") or {}
    return {
        "used": daily.get("used"),
        "limit": daily.get("limit"),
        "remaining": daily.get("remaining"),
        "is_free_tier": data.get("is_free_tier"),
    }


def mini_config(scale_repo: Path, out: Path, step_limit: int, time_limit_sec: int) -> Path:
    """Scale's tool-calling mini-swe-agent config for SWE-bench Pro v2, with this benchmark's limits."""
    import yaml  # Harbor depends on PyYAML

    source = scale_repo / "v2" / "tooling" / "configs" / "mini_toolcall.yaml"
    config = yaml.safe_load(source.read_text(encoding="utf-8"))
    agent = config.setdefault("agent", {})
    agent["step_limit"] = step_limit
    agent["cost_limit"] = 0  # free models; no cost cap
    agent["wall_time_limit_seconds"] = time_limit_sec
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(yaml.safe_dump(config, sort_keys=False), encoding="utf-8")
    return out


def harbor_command(args: argparse.Namespace, task_dir: Path, job_name: str, jobs_dir: Path, mini_cfg: Path | None):
    cmd = [
        args.harbor,
        "run",
        "-p",
        str(task_dir),
        "-e",
        "docker",
        "-n",
        "1",
        "-k",
        "1",
        "--job-name",
        job_name,
        "-o",
        str(jobs_dir),
        "-a",
        AGENTS[args.agent],
        "-m",
        f"openrouter/{args.model}",
        "--allow-agent-host",
        "openrouter.ai",
        "-y",
        "-q",
    ]
    if args.agent == "shelra":
        cmd += ["--ak", f"step_limit={args.step_limit}", "--ak", f"time_limit_sec={args.time_limit}"]
        if args.shelra_binary:
            cmd += ["--ak", f"binary_path={Path(args.shelra_binary).resolve()}"]
        if args.shelra_sha256:
            cmd += ["--ak", f"binary_sha256={args.shelra_sha256}"]
    else:
        cmd += ["--ak", f"version={MINI_SWE_AGENT_VERSION}", "--ak", f"config_file={mini_cfg}"]
    return cmd


def find_trial_result(job_dir: Path) -> tuple[Path | None, dict[str, Any] | None]:
    for path in sorted(job_dir.glob("*/result.json")):
        data = read_json(path)
        if isinstance(data, dict) and "trial_name" in data:
            return path.parent, data
    return None, None


def scan_for_daily_quota(agent_dir: Path) -> bool:
    if not agent_dir.is_dir():
        return False
    for path in agent_dir.rglob("*"):
        if path.is_file() and path.stat().st_size < 64 * 1024 * 1024:
            try:
                if DAILY_QUOTA_RE.search(path.read_bytes()):
                    return True
            except OSError:
                continue
    return False


def agent_details(agent: str, trial_dir: Path | None, model: str) -> dict[str, Any]:
    if trial_dir is None:
        return {}
    agent_dir = trial_dir / "agent"
    if agent == "shelra":
        summary = read_json(agent_dir / "shelra-summary.json")
        if summary is None and (agent_dir / "shelra.jsonl").exists():
            sys.path.insert(0, str(HARBOR_DIR))
            from shelra_agent import summarize_shelra_logs  # noqa: PLC0415

            summary = summarize_shelra_logs(agent_dir, model)
        summary = summary or {}
        return {
            "harness_steps": summary.get("steps"),
            "claim": summary.get("claim"),
            "claimed_done": summary.get("claimed_done"),
            "verdict": summary.get("verdict"),
            "stop_reason": summary.get("stop_reason"),
            "model_contaminated": summary.get("model_contaminated"),
            "other_models": summary.get("other_models"),
            "quota_hit": bool(summary.get("quota_hit")) or scan_for_daily_quota(agent_dir),
        }
    trajectory = read_json(agent_dir / "mini-swe-agent.trajectory.json") or {}
    info = trajectory.get("info") or {}
    exit_status = info.get("exit_status") or None
    return {
        "harness_steps": (info.get("model_stats") or {}).get("api_calls"),
        "claim": exit_status,
        "claimed_done": exit_status == "Submitted" if exit_status else None,
        "stop_reason": exit_status,
        "quota_hit": scan_for_daily_quota(agent_dir),
    }


def seconds_between(timing: dict[str, Any] | None) -> float | None:
    if not timing or not timing.get("started_at") or not timing.get("finished_at"):
        return None
    start = dt.datetime.fromisoformat(timing["started_at"])
    end = dt.datetime.fromisoformat(timing["finished_at"])
    return round((end - start).total_seconds(), 1)


def classify(result: dict[str, Any] | None, quota_hit: bool) -> tuple[str, float | None, str | None]:
    if result is None:
        return ("quota_lost" if quota_hit else "infra_error"), None, "no trial result.json"
    rewards = (result.get("verifier_result") or {}).get("rewards") or {}
    reward = rewards.get("reward")
    exc = result.get("exception_info") or {}
    exc_text = f"{exc.get('exception_type')}: {str(exc.get('exception_message') or '')[:300]}" if exc else None
    if reward is not None:
        if float(reward) >= 1:
            return "resolved", float(reward), exc_text
        return ("quota_lost" if quota_hit else "unresolved"), float(reward), exc_text
    if quota_hit:
        return "quota_lost", None, exc_text
    if result.get("agent_execution") and (result["agent_execution"] or {}).get("started_at"):
        return "infra_error", None, exc_text  # the agent ran; the verifier did not produce a reward
    if result.get("agent_setup") and (result["agent_setup"] or {}).get("started_at"):
        return "setup_error", None, exc_text  # the harness could not be installed on this task image
    return "infra_error", None, exc_text  # the environment did not start (image pull, Docker)


def docker_cleanup() -> None:
    """Remove the task's image and everything else Docker holds: the next task's image may need the space."""
    try:
        subprocess.run(["docker", "system", "prune", "-af", "--volumes"], check=False, capture_output=True, timeout=900)
    except (OSError, subprocess.TimeoutExpired):
        pass
    try:
        root = subprocess.run(
            ["docker", "info", "-f", "{{.DockerRootDir}}"], capture_output=True, text=True, timeout=60
        ).stdout.strip()
        usage = shutil.disk_usage(root or "/")
        log(f"disk free after cleanup: {usage.free / 1e9:.1f} GB ({root or '/'})")
    except (OSError, subprocess.TimeoutExpired):
        pass


def run_attempt(
    args: argparse.Namespace,
    record: dict[str, Any],
    record_path: Path,
    task_dir: Path,
    jobs_root: Path,
    mini_cfg: Path | None,
    env: dict[str, str],
    api_key: str | None,
    before: dict[str, Any] | None,
) -> str:
    """One `harbor run` of one task; appends the attempt to the task's record, writes it, returns the status."""
    iid = record["instance_id"]
    infra_attempts = sum(1 for a in record["attempts"] if a.get("status") in RETRYABLE)
    attempt_no = len(record["attempts"]) + 1
    job_name = f"{iid}-a{attempt_no}"
    cmd = harbor_command(args, task_dir, job_name, jobs_root, mini_cfg)
    jobs_root.mkdir(parents=True, exist_ok=True)
    t0 = time.monotonic()
    with (jobs_root / f"{job_name}.harbor.log").open("w", encoding="utf-8") as fh:
        try:
            proc = subprocess.run(cmd, env=env, stdout=fh, stderr=subprocess.STDOUT, timeout=args.task_timeout)
            harbor_exit: int | str = proc.returncode
        except subprocess.TimeoutExpired:
            harbor_exit = "timeout"
    wall = round(time.monotonic() - t0, 1)

    trial_dir, result = find_trial_result(jobs_root / job_name)
    details = agent_details(args.agent, trial_dir, args.model)
    after = free_quota(api_key)
    quota_hit = bool(details.get("quota_hit")) or bool(after and after.get("remaining") == 0)
    status, reward, exc_text = classify(result, quota_hit)
    if status == "setup_error" and infra_attempts + 1 >= args.max_attempts:
        status = "setup_failed"  # the harness cannot run on this image: counted as unresolved for this arm
    elif status == "infra_error" and infra_attempts + 1 >= args.max_attempts:
        status = "error"  # excluded from the comparison, reported

    agent_result = (result or {}).get("agent_result") or {}
    requests = None
    if before and after and before.get("used") is not None and after.get("used") is not None:
        requests = after["used"] - before["used"]
    attempt = {
        "attempt": attempt_no,
        "status": status,
        "reward": reward,
        "exception": exc_text,
        "harbor_exit": harbor_exit,
        "wall_sec": wall,
        "agent_sec": seconds_between((result or {}).get("agent_execution")),
        "verifier_sec": seconds_between((result or {}).get("verifier")),
        "env_setup_sec": seconds_between((result or {}).get("environment_setup")),
        "openrouter_requests": requests,
        "free_requests_left": after.get("remaining") if after else None,
        "input_tokens": agent_result.get("n_input_tokens"),
        "output_tokens": agent_result.get("n_output_tokens"),
        "trial_dir": str(trial_dir) if trial_dir else None,
        "finished_at": now_iso(),
        **details,
    }
    record["attempts"].append(attempt)
    record.update(
        {
            "instance_id": iid,
            "agent": args.agent,
            "model": args.model,
            "status": status,
            "reward": reward,
            "step_limit": args.step_limit,
            "time_limit_sec": args.time_limit,
            **{k: attempt[k] for k in ("openrouter_requests", "input_tokens", "output_tokens", "agent_sec")},
            **details,
        }
    )
    write_json(record_path, record)
    log(f"  -> {status} reward={reward} requests={requests} wall={wall}s")
    return status


def cmd_run(args: argparse.Namespace) -> int:
    args.model = normalize_model(args.model)
    subset = load_subset(args.subset)
    selected = subset[args.offset : args.offset + args.limit if args.limit > 0 else None]
    arm_dir = Path(args.results) / args.agent / model_slug(args.model)
    tasks_dir = arm_dir / "tasks"
    jobs_root = (Path(args.jobs) / args.agent / model_slug(args.model)).resolve()
    scale_tasks = (Path(args.scale_repo) / "v2" / "tasks").resolve()
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key and not args.dry_run:
        raise SystemExit("OPENROUTER_API_KEY is not set")
    if args.agent == "shelra" and not args.shelra_binary and not args.dry_run:
        log("no --shelra-binary: each sandbox downloads the release binary itself")

    mini_cfg = None
    if args.agent == "mini-swe-agent":
        mini_cfg = mini_config(
            Path(args.scale_repo), (arm_dir / "mini-swe-agent.config.yaml").resolve(), args.step_limit, args.time_limit
        )

    env = dict(os.environ)
    env["PYTHONPATH"] = os.pathsep.join(
        [str(HARBOR_DIR), str((Path(args.scale_repo) / "v2" / "tooling").resolve()), env.get("PYTHONPATH", "")]
    ).rstrip(os.pathsep)

    started = time.monotonic()
    stopped = "done"
    stop_detail = None
    for index, iid in enumerate(selected):
        record_path = tasks_dir / f"{iid}.json"
        task_dir = scale_tasks / iid
        if not task_dir.is_dir():
            raise SystemExit(f"task directory not found: {task_dir}")
        # An infrastructure or setup error is retried at once, up to --max-attempts in all.
        while True:
            record = read_json(record_path) or {"instance_id": iid, "attempts": []}
            if record.get("status") in FINAL:
                break
            infra_attempts = sum(1 for a in record["attempts"] if a.get("status") in RETRYABLE)
            if infra_attempts >= args.max_attempts:
                break
            elapsed_min = (time.monotonic() - started) / 60
            if args.budget_minutes and elapsed_min > args.budget_minutes - args.reserve_minutes:
                stopped, stop_detail = "time_budget", f"{elapsed_min:.0f} of {args.budget_minutes} minutes used"
                break
            before = free_quota(api_key)
            if before and before.get("remaining") is not None and before["remaining"] < args.min_quota:
                stopped, stop_detail = "quota", f"{before['remaining']} free requests left today (< {args.min_quota})"
                break
            log(f"[{index + 1}/{len(selected)}] {iid} attempt {len(record['attempts']) + 1}")
            if args.dry_run:
                print("  " + " ".join(harbor_command(args, task_dir, f"{iid}-a1", jobs_root, mini_cfg)))
                break
            status = run_attempt(args, record, record_path, task_dir, jobs_root, mini_cfg, env, api_key, before)
            if args.docker_prune:
                docker_cleanup()
            if status == "quota_lost":
                stopped, stop_detail = "quota", "the daily free-model limit was reached during the task"
                break
            if status not in RETRYABLE:
                break
        if stopped != "done":
            break

    states = {}
    for iid in subset:
        rec = read_json(tasks_dir / f"{iid}.json")
        states[iid] = rec.get("status") if rec else "pending"
    counts: dict[str, int] = {}
    for status in states.values():
        counts[status] = counts.get(status, 0) + 1
    write_json(
        arm_dir / "run-state.json",
        {
            "agent": args.agent,
            "model": args.model,
            "subset": args.subset,
            "subset_size": len(subset),
            "offset": args.offset,
            "limit": args.limit,
            "step_limit": args.step_limit,
            "time_limit_sec": args.time_limit,
            "stopped": stopped,
            "stop_detail": stop_detail,
            "counts": counts,
            "updated_at": now_iso(),
        },
    )
    log(f"stopped: {stopped} {stop_detail or ''} counts={counts}")
    return 0


def redact_paths(paths: list[Path], secrets: list[str]) -> int:
    needles = [s.encode() for s in secrets if s and len(s) >= 8]
    changed = 0
    for root in paths:
        files = [root] if root.is_file() else (p for p in root.rglob("*") if p.is_file())
        for path in files:
            try:
                if path.stat().st_size > 256 * 1024 * 1024:
                    continue
                data = path.read_bytes()
            except OSError:
                continue
            new = data
            for needle in needles:
                new = new.replace(needle, b"[REDACTED]")
            new = OPENROUTER_KEY_RE.sub(b"[REDACTED-OPENROUTER-KEY]", new)
            if new != data:
                path.write_bytes(new)
                changed += 1
    return changed


def cmd_redact(args: argparse.Namespace) -> int:
    secrets = [os.environ.get(name, "") for name in args.env]
    changed = redact_paths([Path(p) for p in args.paths if Path(p).exists()], secrets)
    log(f"redacted secrets in {changed} file(s)")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="run or resume one arm")
    run.add_argument("--agent", choices=sorted(AGENTS), required=True)
    run.add_argument("--model", required=True, help="OpenRouter model id, e.g. nvidia/nemotron-3-ultra-550b-a55b:free")
    run.add_argument("--subset", default="pilot20", help="pilot20, headline50, or a file of instance ids")
    run.add_argument("--scale-repo", required=True, help="checkout of scaleapi/SWE-bench_Pro-os (v2/tasks, v2/tooling)")
    run.add_argument("--results", default="bench-results", help="results root (per-task JSON files)")
    run.add_argument("--jobs", default="bench-jobs", help="Harbor jobs root (trial logs)")
    run.add_argument("--offset", type=int, default=0, help="first subset index to consider")
    run.add_argument("--limit", type=int, default=0, help="number of subset entries to consider (0 = all)")
    run.add_argument("--step-limit", type=int, default=50, help="model steps per task, both harnesses")
    run.add_argument("--time-limit", type=int, default=2910, help="agent wall-clock seconds per task, both harnesses")
    run.add_argument("--task-timeout", type=int, default=3 * 3600, help="hard timeout for one `harbor run`")
    run.add_argument("--max-attempts", type=int, default=2, help="attempts for infrastructure errors")
    run.add_argument("--min-quota", type=int, default=60, help="stop when fewer free requests are left today")
    run.add_argument("--budget-minutes", type=float, default=0, help="stop starting tasks near this budget (0 = none)")
    run.add_argument("--reserve-minutes", type=float, default=75, help="minutes one task may still need")
    run.add_argument("--shelra-binary", help="host path of shelra-linux-x64 (uploaded into each sandbox)")
    run.add_argument("--shelra-sha256", help="expected SHA-256 of the binary (default: the agent's pinned digest)")
    run.add_argument("--harbor", default="harbor", help="harbor executable")
    run.add_argument("--docker-prune", action="store_true", help="prune Docker images after each task")
    run.add_argument("--dry-run", action="store_true", help="print the harbor commands without running them")
    run.set_defaults(func=cmd_run)

    red = sub.add_parser("redact", help="scrub secrets from files before upload")
    red.add_argument("paths", nargs="+")
    red.add_argument("--env", action="append", default=["OPENROUTER_API_KEY"], help="env var holding a secret")
    red.set_defaults(func=cmd_redact)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
