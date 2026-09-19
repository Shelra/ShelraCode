"""Amendment 5 of PROTOCOL.md: a complete compliance measure for backstage ADR004 (B2).

The screen pattern used by compliance.py only saw single-line re-exports in non-index files. ADR004
is also broken by an index file that re-exports from anything other than an immediate child
('./a/b' or '../x'), and re-exports often span several lines. This script counts, at the same
snapshot, the in-scope files breaking either form, and reports both numbers.

Usage: python compliance_b2.py <worktree_of_backstage_snapshot> <compliance_json>
"""

import json
import re
import subprocess
import sys
from pathlib import Path

SCOPE = re.compile(r"^(packages|plugins)/[^/]+/src/.*\.(tsx?|jsx?|mjs|cjs)$")
INDEX = re.compile(r"(^|/)index\.(tsx?|jsx?|mjs|cjs)$")
REEXPORT = re.compile(r"export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+['\"]([^'\"]+)['\"]", re.S)


def immediate_child(spec: str) -> bool:
    if not spec.startswith("./"):
        return False  # '../x' or a package name
    return "/" not in spec[2:].rstrip("/")


def main() -> None:
    tree, out_path = Path(sys.argv[1]), Path(sys.argv[2])
    files = [f for f in subprocess.run(["git", "-C", str(tree), "ls-files"], capture_output=True, text=True, check=True).stdout.splitlines() if SCOPE.search(f)]
    non_index_bad = index_bad = 0
    for rel in files:
        try:
            text = (tree / rel).read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        targets = [m.group(1) for m in REEXPORT.finditer(text) if m.group(1).startswith(".")]
        if not targets:
            continue
        if INDEX.search(rel):
            if any(not immediate_child(t) for t in targets):
                index_bad += 1
        else:
            non_index_bad += 1
    total = len(files)
    share = (non_index_bad + index_bad) / total if total else 0.0
    report = json.loads(out_path.read_text(encoding="utf-8"))
    entry = report["backstage_backstage"]["commitments"]["B2"]
    entry["full_measure"] = {
        "in_scope_files": total,
        "non_index_files_with_reexports": non_index_bad,
        "index_files_reexporting_beyond_children": index_bad,
        "share": round(share, 4),
        "followed": share < 0.25,
        "note": "amendment 5: multi-line aware, counts both ways ADR004 is broken",
    }
    out_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"B2 full measure: non-index re-exports {non_index_bad}, index beyond children {index_bad}, of {total} files ({share:.1%}) -> {'followed' if share < 0.25 else 'NOT followed'}")


if __name__ == "__main__":
    main()
