"""Deterministic sampling of merged pull requests for the phase 1 base-rate study.

Usage: python sample.py <repos_dir> <out_jsonl>

<repos_dir> holds blobless clones named owner_repo (see PROTOCOL.md). The eligibility rules below
implement the "Sampling" section of the protocol; the eligible count per repository is printed so
the report can state it.
"""

import json
import random
import re
import subprocess
import sys
from pathlib import Path

SEED = "shelra-phase1-2026-09-18"
SINCE = "2025-09-01"
UNTIL = "2026-09-01"
PER_REPO = 50

REPOS = {
    "backstage_backstage": {"source": re.compile(r"\.(tsx?|jsx?|mjs|cjs)$")},
    "mozilla_fxa": {"source": re.compile(r"\.(tsx?|jsx?|mjs|cjs)$")},
    "Sylius_Sylius": {"source": re.compile(r"\.(php|twig)$|^src/.*\.(ya?ml|xml)$")},
}

NON_SOURCE_PATH = re.compile(
    r"(^|/)(docs?|\.changeset|\.github|locales?|l10n|translations?)/|(^|/)(yarn\.lock|package-lock\.json|pnpm-lock\.yaml|composer\.lock)$|\.md$"
)
BOT_AUTHOR = re.compile(
    r"\[bot\]|dependabot|renovate|github-actions|backstage service account|backstage-service|mozilla-l10n|sylius-bot",
    re.I,
)
RELEASE_SUBJECT = re.compile(
    r"^(version packages|chore\(deps|chore\(release|build\(deps|bump |update dependency|release[: ]|\[renovate\]|change application's version|generate changelog)",
    re.I,
)
MERGE_SUBJECT = re.compile(r"^Merge pull request #(\d+) from ")
SQUASH_SUBJECT = re.compile(r"\(#(\d+)\)\s*$")


def git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), *args], capture_output=True, text=True, encoding="utf-8", errors="replace", check=True
    ).stdout


def candidates(repo: Path):
    log = git(repo, "log", "--first-parent", f"--since={SINCE}", f"--until={UNTIL}", "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%cI%x1f%s", "HEAD")
    for line in log.splitlines():
        sha, parents, author, email, date, subject = line.split("\x1f")
        parents = parents.split()
        merge = MERGE_SUBJECT.match(subject)
        squash = SQUASH_SUBJECT.search(subject)
        if merge and len(parents) >= 2:
            number = int(merge.group(1))
            # A merge commit's author is whoever pressed the button; the PR author is on the branch.
            branch_author = git(repo, "log", "-1", "--format=%an%x1f%ae%x1f%s", parents[1]).strip().split("\x1f")
            author, email = branch_author[0], branch_author[1]
            title = branch_author[2] if len(branch_author) > 2 else subject
        elif squash:
            # Squash merges (one parent) and merge commits titled after the pull request (two
            # parents, as Sylius does) both carry the number at the end of the subject.
            number = int(squash.group(1))
            title = subject
            if len(parents) >= 2:
                branch_author = git(repo, "log", "-1", "--format=%an%x1f%ae", parents[1]).strip().split("\x1f")
                author, email = branch_author[0], branch_author[1]
        else:
            continue
        yield {
            "sha": sha,
            "first_parent": parents[0],
            "pr": number,
            "author": author,
            "author_email": email,
            "date": date,
            "subject": subject,
            "title": title,
        }


def eligible(repo: Path, rules, item) -> tuple[bool, str, list[str]]:
    if BOT_AUTHOR.search(item["author"]) or BOT_AUTHOR.search(item["author_email"]):
        return False, "bot author", []
    if RELEASE_SUBJECT.search(item["title"]) or RELEASE_SUBJECT.search(item["subject"]):
        return False, "release or dependency bump", []
    files = git(repo, "diff", "--name-only", item["first_parent"], item["sha"]).splitlines()
    source = [f for f in files if rules["source"].search(f) and not NON_SOURCE_PATH.search(f)]
    if not source:
        return False, "no source file", files
    return True, "", files


def main() -> None:
    repos_dir = Path(sys.argv[1])
    out = Path(sys.argv[2])
    rows = []
    for name, rules in REPOS.items():
        repo = repos_dir / name
        pool, reasons = [], {}
        for item in candidates(repo):
            ok, reason, files = eligible(repo, rules, item)
            if ok:
                item["files"] = len(files)
                pool.append(item)
            else:
                reasons[reason] = reasons.get(reason, 0) + 1
        pool.sort(key=lambda row: row["pr"])
        rng = random.Random(f"{SEED}:{name}")
        picked = sorted(rng.sample(pool, min(PER_REPO, len(pool))), key=lambda row: row["pr"])
        print(f"{name}: {len(pool)} eligible, excluded {reasons}, sampled {len(picked)}")
        for row in picked:
            rows.append({"repo": name, **row})
    out.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
    print(f"wrote {len(rows)} rows to {out}")


if __name__ == "__main__":
    main()
