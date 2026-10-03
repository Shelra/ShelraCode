#!/usr/bin/env python3
"""Build the deterministic SWE-bench Pro task subsets used by the public benchmark.

Inputs come from a checkout of Scale's public repository (https://github.com/scaleapi/SWE-bench_Pro-os):

* the universe: the 642 validated Harbor tasks under ``v2/tasks/`` (directory names are the instance ids);
* the historical difficulty: ``traj/*/eval_results.json``, the per-instance resolved flags Scale published for
  nine reference runs (paper and 2025-10-13 leaderboard runs). A task's historical pass rate is the share of the
  runs that list it and resolved it.

Method (documented in bench/public/README.md, reproduced exactly by this script):

1. Keep tasks whose historical pass rate lies in [BAND_LOW, BAND_HIGH] and that at least MIN_RUNS runs evaluated
   ("moderate" tasks: solved by some reference systems, not by all).
2. Rank every task by sha256(f"{SEED}:{instance_id}") (no dependence on Python's random module or version).
3. Headline: allocate HEADLINE_SIZE slots across repositories in proportion to their share of the moderate pool
   (largest remainder, ties broken by repository name), then take the lowest-ranked tasks of each repository.
4. Pilot: allocate PILOT_SIZE slots the same way over the headline set and take the lowest-ranked headline tasks of
   each repository, so the pilot is a subset of the headline.

Usage:
  python bench/public/make_subsets.py --scale-repo /path/to/SWE-bench_Pro-os [--check]

``--check`` recomputes the subsets and fails if the committed files differ (used to verify reproducibility).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

SEED = "shelra-swebench-pro-2026-10-03"
BAND_LOW = 0.25
BAND_HIGH = 0.75
MIN_RUNS = 6
HEADLINE_SIZE = 50
PILOT_SIZE = 20

HERE = Path(__file__).resolve().parent
PILOT_FILE = HERE / "swebench-pro-pilot20.txt"
HEADLINE_FILE = HERE / "swebench-pro-headline50.txt"
META_FILE = HERE / "swebench-pro-subsets.json"


def list_tasks(scale_repo: Path) -> list[str]:
    tasks_dir = scale_repo / "v2" / "tasks"
    if tasks_dir.is_dir() and any(tasks_dir.iterdir()):
        names = [p.name for p in tasks_dir.iterdir() if p.is_dir()]
        if len(names) >= 600:
            return sorted(names)
    # A sparse or partial checkout: read the directory list from git.
    out = subprocess.run(
        ["git", "ls-tree", "-d", "--name-only", "HEAD", "v2/tasks/"],
        cwd=scale_repo,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return sorted(line.split("/", 2)[2] for line in out.splitlines() if line.count("/") >= 2)


def repo_of(instance_id: str) -> str:
    """instance_<owner>__<repo>-<40-hex commit>[-v<hash>] -> owner/repo (repository names may contain dashes)."""
    parts = instance_id.removeprefix("instance_").split("-")
    for i, part in enumerate(parts):
        if len(part) == 40 and all(c in "0123456789abcdef" for c in part):
            return "-".join(parts[:i]).replace("__", "/")
    raise ValueError(f"unexpected instance id: {instance_id}")


def historical_rates(scale_repo: Path, universe: set[str]) -> tuple[dict[str, tuple[int, int]], list[str]]:
    runs = sorted((scale_repo / "traj").glob("*/eval_results.json"))
    if not runs:
        raise SystemExit(f"no traj/*/eval_results.json under {scale_repo}")
    counts: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for run in runs:
        data = json.loads(run.read_text(encoding="utf-8"))
        for key, resolved in data.items():
            iid = key if key.startswith("instance_") else f"instance_{key}"
            if iid in universe:
                counts[iid][1] += 1
                counts[iid][0] += 1 if resolved is True else 0
    return {k: (v[0], v[1]) for k, v in counts.items()}, [r.parent.name for r in runs]


def rank(instance_id: str) -> str:
    return hashlib.sha256(f"{SEED}:{instance_id}".encode()).hexdigest()


def allocate(pool_by_repo: dict[str, list[str]], size: int) -> dict[str, int]:
    total = sum(len(v) for v in pool_by_repo.values())
    if total < size:
        raise SystemExit(f"pool has {total} tasks, fewer than {size}")
    quotas = {repo: size * len(v) / total for repo, v in pool_by_repo.items()}
    alloc = {repo: min(math.floor(q), len(pool_by_repo[repo])) for repo, q in quotas.items()}
    left = size - sum(alloc.values())
    order = sorted(quotas, key=lambda r: (-(quotas[r] - math.floor(quotas[r])), r))
    while left > 0:
        progressed = False
        for repo in order:
            if left == 0:
                break
            if alloc[repo] < len(pool_by_repo[repo]):
                alloc[repo] += 1
                left -= 1
                progressed = True
        if not progressed:
            raise SystemExit("cannot fill the allocation")
    return alloc


def pick(pool: list[str], size: int) -> list[str]:
    by_repo: dict[str, list[str]] = defaultdict(list)
    for iid in pool:
        by_repo[repo_of(iid)].append(iid)
    for repo in by_repo:
        by_repo[repo].sort(key=rank)
    alloc = allocate(by_repo, size)
    chosen = [iid for repo in sorted(by_repo) for iid in by_repo[repo][: alloc[repo]]]
    return sorted(chosen, key=rank)


def git_head(scale_repo: Path) -> str | None:
    try:
        return subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=scale_repo, check=True, capture_output=True, text=True
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def build(scale_repo: Path) -> dict:
    tasks = list_tasks(scale_repo)
    universe = set(tasks)
    rates, run_names = historical_rates(scale_repo, universe)
    moderate = [
        iid
        for iid in tasks
        if iid in rates and rates[iid][1] >= MIN_RUNS and BAND_LOW <= rates[iid][0] / rates[iid][1] <= BAND_HIGH
    ]
    headline = pick(moderate, HEADLINE_SIZE)
    pilot = pick(headline, PILOT_SIZE)
    assert set(pilot) <= set(headline)

    def describe(iid: str) -> dict:
        solved, seen = rates[iid]
        return {"instance_id": iid, "repo": repo_of(iid), "historical_resolved": solved, "historical_runs": seen}

    return {
        "source": "https://github.com/scaleapi/SWE-bench_Pro-os",
        "source_commit": git_head(scale_repo),
        "universe": "v2/tasks (Harbor format, validated)",
        "universe_size": len(tasks),
        "reference_runs": run_names,
        "method": {
            "seed": SEED,
            "rank": "sha256(seed + ':' + instance_id), ascending",
            "band": [BAND_LOW, BAND_HIGH],
            "min_runs": MIN_RUNS,
            "allocation": "proportional to each repository's share of the pool, largest remainder",
            "pilot": "same allocation over the headline set (pilot is a subset of the headline)",
        },
        "pool_size": len(moderate),
        "pool_by_repo": dict(sorted(Counter(repo_of(i) for i in moderate).items())),
        "headline": [describe(i) for i in headline],
        "pilot": [describe(i) for i in pilot],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--scale-repo", required=True, type=Path, help="checkout of scaleapi/SWE-bench_Pro-os")
    parser.add_argument("--check", action="store_true", help="fail if the committed subset files differ")
    args = parser.parse_args()

    meta = build(args.scale_repo)
    headline_text = "".join(f"{t['instance_id']}\n" for t in meta["headline"])
    pilot_text = "".join(f"{t['instance_id']}\n" for t in meta["pilot"])
    meta_text = json.dumps(meta, indent=2) + "\n"

    if args.check:
        ok = True
        for path, text in ((HEADLINE_FILE, headline_text), (PILOT_FILE, pilot_text)):
            current = path.read_text(encoding="utf-8").replace("\r\n", "\n") if path.exists() else ""
            if current != text:
                print(f"DIFFERS: {path.name}", file=sys.stderr)
                ok = False
            else:
                print(f"matches: {path.name}")
        return 0 if ok else 1

    HEADLINE_FILE.write_text(headline_text, encoding="utf-8", newline="\n")
    PILOT_FILE.write_text(pilot_text, encoding="utf-8", newline="\n")
    META_FILE.write_text(meta_text, encoding="utf-8", newline="\n")
    print(f"pool {meta['pool_size']} moderate tasks of {meta['universe_size']}: {meta['pool_by_repo']}")
    print(f"headline {len(meta['headline'])}: {dict(Counter(t['repo'] for t in meta['headline']))}")
    print(f"pilot {len(meta['pilot'])}: {dict(Counter(t['repo'] for t in meta['pilot']))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
