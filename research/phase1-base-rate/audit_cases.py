"""Builds the blind audit set for the owner's review page (protocol "Who labels, and the audit").

Selection: every first-pass `violation` and `unsure` label, plus 20 `no` labels drawn with the seed
below from all `no` labels sorted by (repo, pr). The combined set is shuffled with the same seed, so
the order of cases says nothing about their first-pass labels.

Every case is presented the same way whatever its label (amendment 2): the rules in scope for the
files it touched, quoted from commitments.md, and the added and removed lines of every in-scope
file that could carry code, in diff order, under the same per-file cap the first pass read with.
Nothing is chosen per label, so what is shown cannot hint at the answer.

Usage: python audit_cases.py <out_dir>
Writes one JSON file per document for the page's store: <out_dir>/cases/<id>.json (rules, metadata,
number of excerpt parts) and <out_dir>/excerpts/<id>-p<k>.json (the diff excerpts, split so every
document stays under the store's 256 KiB limit). Prints, for each positive, whether its cited
evidence falls inside the shown lines.
"""

import json
import random
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from screen import COMMITMENTS  # noqa: E402
from view import DIFF_FILE, DOCS, RELEVANT, SKIP, strip_license  # noqa: E402

SEED = "shelra-phase1-audit-2026-09-19"
NEGATIVES = 20
PER_FILE = 400
PART_BYTES = 150_000
DIFFS = HERE.parents[1] / ".shelra" / "research" / "phase1" / "diffs"
GITHUB = {"backstage_backstage": "backstage/backstage", "mozilla_fxa": "mozilla/fxa", "Sylius_Sylius": "Sylius/Sylius"}
ROW = re.compile(r"^\|\s*([BFS]\d+)\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*\|\s*([^|]+?)\s*\|\s*(obligation|preference)\s*\|")


def load_jsonl(name: str) -> list[dict]:
    return [json.loads(line) for line in (HERE / name).read_text(encoding="utf-8").splitlines() if line.strip()]


def rule_texts() -> dict[str, dict]:
    rules = {}
    for line in (HERE / "commitments.md").read_text(encoding="utf-8").splitlines():
        match = ROW.match(line)
        if match:
            rules[match.group(1)] = {"rule": match.group(3).replace("`", ""), "scope": match.group(4).replace("`", "")}
    return rules


def diff_files(diff: str) -> list[dict]:
    files, current = [], None
    for line in diff.splitlines():
        match = DIFF_FILE.match(line)
        if match:
            current = {"path": match.group(2), "body": [], "new": False}
            files.append(current)
            continue
        if current is None:
            continue
        if line.startswith("new file mode"):
            current["new"] = True
        elif line.startswith("@@"):
            current["body"].append(line[: line.find("@@", 2) + 2] if "@@" in line[2:] else line)
        elif (line.startswith("+") and not line.startswith("+++")) or (line.startswith("-") and not line.startswith("---")):
            current["body"].append(line)
    return files


def build_case(order: int, label: dict, sample: dict, screen: dict, rules: dict) -> dict:
    repo, pr = label["repo"], label["pr"]
    specs = {cid: (adr, re.compile(scope), re.compile(exclude) if exclude else None)
             for cid, adr, scope, exclude, _ in COMMITMENTS[repo]}
    in_scope = [cid for cid, *_ in COMMITMENTS[repo] if cid in screen["in_scope"]]
    files = diff_files((DIFFS / f"{repo}-{pr}.diff").read_text(encoding="utf-8"))

    excerpts, capped = [], 0
    for entry in files:
        path = entry["path"]
        if SKIP.search(path) or DOCS.search(path) or not RELEVANT[repo].search(path):
            continue
        if not any(specs[cid][1].search(path) and not (specs[cid][2] and specs[cid][2].search(path)) for cid in in_scope):
            continue
        body = strip_license(entry["body"]) if entry["new"] else entry["body"]
        if not any(line.startswith("+") for line in body):
            continue
        if len(body) > PER_FILE:
            capped += 1
            body = body[:PER_FILE] + [f"@@ {len(body) - PER_FILE} more changed lines in this file are not shown @@"]
        excerpts.append({"file": path + (" [new file]" if entry["new"] else ""), "text": "\n".join(body)})

    if in_scope:
        note = [f"{len(excerpts)} in-scope files with added lines, in diff order."]
        if capped:
            note.append(f"{capped} capped at {PER_FILE} changed lines.")
        note.append("Removed lines are kept so moved code is visible. The pull request link has the full diff.")
    else:
        note = ["No rule's scope covers any file this pull request changed."]

    parts, part, size = [], [], 0
    for excerpt in excerpts:
        weight = len(json.dumps(excerpt, ensure_ascii=False).encode("utf-8"))
        if part and size + weight > PART_BYTES:
            parts.append(part)
            part, size = [], 0
        part.append(excerpt)
        size += weight
    if part:
        parts.append(part)

    slug = GITHUB[repo]
    return {
        "id": f"{repo}-{pr}",
        "doc": {
            "order": order,
            "repo": slug,
            "pr": pr,
            "title": screen["title"],
            "url": f"https://github.com/{slug}/pull/{pr}",
            "merged": sample["date"][:10],
            "files": screen["files"],
            "added": screen["added_lines"],
            "commitments": [{
                "id": cid,
                "adr": specs[cid][0].rsplit("/", 1)[-1],
                "adrUrl": f"https://github.com/{slug}/blob/{sample['first_parent']}/{specs[cid][0]}",
                "rule": rules[cid]["rule"] + f" (Scope: {rules[cid]['scope']}.)",
            } for cid in in_scope],
            "excerptNote": " ".join(note),
            "parts": len(parts),
            "firstPass": {"label": label["label"], "commitment": label.get("commitment"), "rationale": label["rationale"]},
        },
        "parts": parts,
    }


def main() -> None:
    out = Path(sys.argv[1])
    for sub in ("cases", "excerpts"):
        (out / sub).mkdir(parents=True, exist_ok=True)
        for old in (out / sub).glob("*.json"):
            old.unlink()
    labels = load_jsonl("labels.jsonl")
    samples = {(row["repo"], row["pr"]): row for row in load_jsonl("sample.jsonl")}
    screens = {(row["repo"], row["pr"]): row for row in load_jsonl("screen.jsonl")}
    rules = rule_texts()

    rng = random.Random(SEED)
    positives = [row for row in labels if row["label"] != "no"]
    negatives = sorted((row for row in labels if row["label"] == "no"), key=lambda row: (row["repo"], row["pr"]))
    chosen = positives + rng.sample(negatives, NEGATIVES)
    rng.shuffle(chosen)

    cases = [build_case(index + 1, label, samples[(label["repo"], label["pr"])], screens[(label["repo"], label["pr"])], rules)
             for index, label in enumerate(chosen)]
    for case in cases:
        (out / "cases" / f"{case['id']}.json").write_text(json.dumps(case["doc"], ensure_ascii=False), encoding="utf-8")
        for index, part in enumerate(case["parts"]):
            body = {"caseId": case["id"], "part": index, "items": part}
            (out / "excerpts" / f"{case['id']}-p{index}.json").write_text(json.dumps(body, ensure_ascii=False), encoding="utf-8")

    print(f"{len(cases)} cases: {len(positives)} positive or unsure, {NEGATIVES} negatives (seed {SEED})")
    for case in cases:
        doc = case["doc"]
        items = [item for part in case["parts"] for item in part]
        biggest = max([len(json.dumps(part, ensure_ascii=False).encode("utf-8")) for part in case["parts"]] or [0])
        shown = "\n".join(item["text"] for item in items)
        check = ""
        if doc["firstPass"]["label"] != "no":
            evidence = next(row["evidence"] for row in labels if f"{row['repo']}-{row['pr']}" == case["id"])
            snippets = re.findall(r"`([^`]{12,})`", evidence)
            found = [snippet for snippet in snippets if snippet in shown]
            check = f" evidence shown {len(found)}/{len(snippets)}"
        print(f"{doc['order']:>2} {case['id']:<28} rules {len(doc['commitments']):>2} files {len(items):>3} "
              f"lines {sum(item['text'].count(chr(10)) + 1 for item in items):>5} parts {doc['parts']} "
              f"largest {biggest // 1024:>4} KiB{check}")


if __name__ == "__main__":
    main()
