"""Amendment 3 of PROTOCOL.md: is each rule still followed by the code base when the window opens?

For every commitment whose screen pattern matches the violation itself (listed in VIOLATION_PATTERNS),
measure the share of in-scope files that already contain a match at the repository's last
first-parent commit before 2025-09-01. A share of 25% or more marks the rule as "not followed by the
code base" for the secondary analysis.

Usage: python compliance.py <repos_dir> <worktrees_dir> <out_json>
The snapshot of each repository is checked out as a git worktree under <worktrees_dir>.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from screen import COMMITMENTS  # noqa: E402

CUTOFF = "2025-09-01"
THRESHOLD = 0.25
# Commitments whose pattern is the violation, not merely a pointer for the reader.
VIOLATION_PATTERNS = {
    "backstage_backstage": ["B1", "B2", "B3", "B4", "B5", "B7", "B8", "B9"],
    "mozilla_fxa": ["F1", "F2", "F3", "F4", "F5", "F6", "F13"],
    "Sylius_Sylius": ["S1", "S2", "S3", "S10", "S11"],
}
INDEX_FILE = re.compile(r"(^|/)index\.(tsx?|jsx?|mjs|cjs)$")


def git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, check=True).stdout


def main() -> None:
    repos_dir, worktrees_dir, out_path = (Path(arg).resolve() for arg in sys.argv[1:4])
    worktrees_dir.mkdir(parents=True, exist_ok=True)
    report = {}
    for name, wanted in VIOLATION_PATTERNS.items():
        repo = repos_dir / name
        sha = git(repo, "rev-list", "-1", "--first-parent", f"--before={CUTOFF}", "HEAD").strip()
        tree = worktrees_dir / f"{name}-{sha[:10]}"
        if not tree.exists():
            added = subprocess.run(["git", "-C", str(repo), "worktree", "add", "--detach", str(tree), sha], capture_output=True, text=True)
            if added.returncode != 0:
                raise SystemExit(f"worktree add failed for {name}: {added.stderr.strip()}")
        files = git(tree, "ls-files").splitlines()
        report[name] = {"snapshot": sha, "commitments": {}}
        for cid, adr, scope, exclude, pattern in COMMITMENTS[name]:
            if cid not in wanted:
                continue
            if not (tree / adr).exists():
                report[name]["commitments"][cid] = {"note": "ADR not present at snapshot"}
                continue
            scope_re, exclude_re, pattern_re = re.compile(scope), re.compile(exclude) if exclude else None, re.compile(pattern)
            in_scope = [f for f in files if scope_re.search(f) and not (exclude_re and exclude_re.search(f))]
            if cid == "B2":
                # Re-exports are violations only outside index files.
                in_scope = [f for f in in_scope if not INDEX_FILE.search(f)]
            matching = 0
            for rel in in_scope:
                try:
                    text = (tree / rel).read_text(encoding="utf-8", errors="replace")
                except OSError:
                    continue
                if any(pattern_re.search(line) for line in text.splitlines()):
                    matching += 1
            share = matching / len(in_scope) if in_scope else 0.0
            report[name]["commitments"][cid] = {
                "in_scope_files": len(in_scope),
                "matching_files": matching,
                "share": round(share, 4),
                "followed": share < THRESHOLD,
            }
            print(f"{name} {cid}: {matching}/{len(in_scope)} files match ({share:.1%}) -> {'followed' if share < THRESHOLD else 'NOT followed'}")
    out_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
