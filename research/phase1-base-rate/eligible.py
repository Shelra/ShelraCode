"""Recounts the eligible pull requests per repository and checks that the committed draw reproduces.

The sampler printed its eligible counts instead of storing them, and the report must state them
(PROTOCOL.md, "Sampling"). This reruns the sampler's own candidate and eligibility functions against
the same clones, redraws with the same seed, and compares the draw with sample.jsonl. Nothing is
redrawn into sample.jsonl.

Usage: python eligible.py <repos_dir> <out_json>
"""

import json
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from sample import PER_REPO, REPOS, SEED, candidates, eligible  # noqa: E402


def main() -> None:
    repos_dir, out = Path(sys.argv[1]), Path(sys.argv[2])
    committed: dict[str, list[int]] = {}
    for line in (HERE / "sample.jsonl").read_text(encoding="utf-8").splitlines():
        if line.strip():
            row = json.loads(line)
            committed.setdefault(row["repo"], []).append(row["pr"])

    result = {}
    for name, rules in REPOS.items():
        repo = repos_dir / name
        pool, reasons = [], {}
        for item in candidates(repo):
            ok, reason, _files = eligible(repo, rules, item)
            if ok:
                pool.append(item)
            else:
                reasons[reason] = reasons.get(reason, 0) + 1
        pool.sort(key=lambda row: row["pr"])
        rng = random.Random(f"{SEED}:{name}")
        picked = sorted(row["pr"] for row in rng.sample(pool, min(PER_REPO, len(pool))))
        reproduces = picked == sorted(committed.get(name, []))
        result[name] = {
            "candidates": len(pool) + sum(reasons.values()),
            "eligible": len(pool),
            "excluded": dict(sorted(reasons.items())),
            "sampled": len(picked),
            "draw_reproduces": reproduces,
        }
        print(f"{name}: {len(pool)} eligible, excluded {reasons}, draw reproduces: {reproduces}")

    out.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
