"""Reading view for one or more sampled pull requests: header, screen hits, and the added lines of
every in-scope source file, with removed lines kept where they sit so moved code is visible.

Usage: python view.py <screen_jsonl> <diffs_dir> <repo> <pr> [<pr> ...]

Skipped from the view (listed by name so the reader knows they exist): lockfiles, generated API
reports, changesets, snapshots, and files over the per-file cap, which are summarized instead.
"""

import json
import re
import sys
from pathlib import Path

SKIP = re.compile(
    r"(^|/)(yarn\.lock|package-lock\.json|pnpm-lock\.yaml|composer\.lock)$|report(-[a-z-]+)?\.api\.md$|^\.changeset/|__snapshots__/|\.snap$|CHANGELOG\.md$|\.(png|svg|jpg|gif|ico|woff2?)$"
)
PER_FILE = 400
DIFF_FILE = re.compile(r"^diff --git a/(.+?) b/(.+)$")
# Documentation cannot break a rule about code; it is listed, not shown.
DOCS = re.compile(r"\.(md|mdx|txt|rst)$")
# Files no commitment can cover (CI workflows, images, lockfiles) are listed, not shown.
RELEVANT = {
    "backstage_backstage": re.compile(r"\.(tsx?|jsx?|mjs|cjs)$|(^|/)package\.json$|catalog-info\.ya?ml$"),
    "mozilla_fxa": re.compile(r"\.(tsx?|jsx?|mjs|cjs|ftl|mjml|ejs)$|(^|/)package\.json$"),
    "Sylius_Sylius": re.compile(r"\.(php|twig|xml|ya?ml|js|scss)$"),
}


def strip_license(body: list[str]) -> list[str]:
    """Drop the leading license comment of a new file (it repeats in every file and carries no rule)."""
    out, index = [], 0
    while index < len(body) and body[index].startswith("@@"):
        out.append(body[index])
        index += 1
    head = body[index:index + 20]
    if any(re.search(r"(?i)copyright|license", line) for line in head):
        while index < len(body) and re.match(r"^\+\s*($|/\*|\*|\*/|//|#|<\?php)", body[index]):
            index += 1
    return out + body[index:]


def main() -> None:
    screen_path, diffs_dir, repo = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
    wanted = {int(arg) for arg in sys.argv[4:]}
    rows = {(row["repo"], row["pr"]): row for row in map(json.loads, screen_path.read_text(encoding="utf-8").splitlines())}
    for pr in sorted(wanted):
        row = rows[(repo, pr)]
        print(f"===== {repo} #{pr} {row['date'][:10]} {row['title']}")
        print(f"files {row['files']} | +{row['added_lines']} | in effect {','.join(row['in_effect'])} | in scope {','.join(row['in_scope']) or '-'}"
              f"{' | REVERTED ' + '; '.join(row['reverted_by']) if row['reverted_by'] else ''}")
        for hit in row["hits"]:
            print(f"  HIT {hit['commitment']} {hit['file']}{' [new]' if hit['new_file'] else ''}{' [moved]' if hit.get('moved') else ''}: {hit['line']}")
        diff = (diffs_dir / f"{repo}-{pr}.diff").read_text(encoding="utf-8")
        skipped, current, lines = [], None, []
        for line in diff.splitlines():
            match = DIFF_FILE.match(line)
            if match:
                if current:
                    lines.append(current)
                current = {"path": match.group(2), "body": [], "new": False}
                continue
            if current is None:
                continue
            if line.startswith("new file mode"):
                current["new"] = True
            elif line.startswith("@@"):
                current["body"].append(line[: line.find("@@", 2) + 2] if "@@" in line[2:] else line)
            elif (line.startswith("+") and not line.startswith("+++")) or (line.startswith("-") and not line.startswith("---")):
                current["body"].append(line)
        if current:
            lines.append(current)
        # Every file with its size first, so structure rules (where new files live) are checkable
        # even when a large file's body is capped below.
        print("files: " + "; ".join(
            f"{e['path']}{' [new]' if e['new'] else ''} +{sum(1 for b in e['body'] if b.startswith('+'))}" for e in lines))
        for entry in lines:
            if SKIP.search(entry["path"]) or DOCS.search(entry["path"]) or not RELEVANT[repo].search(entry["path"]):
                skipped.append(entry["path"])
                continue
            body = strip_license(entry["body"]) if entry["new"] else entry["body"]
            print(f"--- {entry['path']}{' [new]' if entry['new'] else ''} ({sum(1 for b in body if b.startswith('+'))} added)")
            for text in body[:PER_FILE]:
                print(text[:220])
            if len(body) > PER_FILE:
                print(f"    ... {len(body) - PER_FILE} more changed lines not shown")
        if skipped:
            print(f"skipped: {', '.join(skipped[:15])}{' ...' if len(skipped) > 15 else ''}")
        print()


if __name__ == "__main__":
    main()
