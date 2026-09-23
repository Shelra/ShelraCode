"""Appends the owner's audit answers to labels.jsonl (PROTOCOL.md, "Who labels, and the audit").

The review page stores one document per case, answers/<caseId> = {verdict, note, at}, where caseId
is "<repo>-<pr>" (audit_cases.py). Export the collection to a directory first (ArtifactData "list"
with out_dir); this script checks the answers are exactly the audit set audit_cases.py drew, then
appends one "owner audit" row per case. The first-pass rows stay in the file, so the report can
measure agreement.

The commitment an owner "violation" or "unsure" answer cites (amendment 7): a rule id the owner's
note names, if that rule is in effect for the pull request; otherwise the first-pass commitment;
otherwise "unspecified", which the report refuses to count until it is resolved with the owner.

Usage: python import_audit.py <answers_dir> [--replace]
<answers_dir> holds one JSON file per answer, at any depth. --replace drops earlier owner rows.
"""

import json
import random
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
LABELS = HERE / "labels.jsonl"
SEED = "shelra-phase1-audit-2026-09-19"  # audit_cases.py
NEGATIVES = 20  # audit_cases.py
FIRST_PASS = "first-pass (Claude)"
OWNER = "owner audit"
VERDICTS = {"violation", "no", "unsure"}
RULE_ID = re.compile(r"\b([BFS]\d{1,2})\b")


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def audit_set(first_pass: list[dict]) -> list[str]:
    """The case ids audit_cases.py drew, in the page's order, from the first-pass rows alone."""
    rng = random.Random(SEED)
    positives = [row for row in first_pass if row["label"] != "no"]
    negatives = sorted((row for row in first_pass if row["label"] == "no"), key=lambda row: (row["repo"], row["pr"]))
    chosen = positives + rng.sample(negatives, NEGATIVES)
    rng.shuffle(chosen)
    return [f"{row['repo']}-{row['pr']}" for row in chosen]


def read_answer(path: Path) -> tuple[str, dict]:
    doc = json.loads(path.read_text(encoding="utf-8"))
    case_id = str(doc.get("id") or path.stem)
    body = doc["data"] if isinstance(doc.get("data"), dict) else doc
    return case_id, body


def main() -> None:
    args = [arg for arg in sys.argv[1:] if not arg.startswith("--")]
    replace = "--replace" in sys.argv[1:]
    if len(args) != 1:
        raise SystemExit(__doc__)
    rows = load_jsonl(LABELS)
    first_pass = [row for row in rows if row.get("labeler") == FIRST_PASS]
    if any(row.get("labeler") == OWNER for row in rows) and not replace:
        raise SystemExit("labels.jsonl already has owner audit rows; pass --replace to import again")
    by_case = {f"{row['repo']}-{row['pr']}": row for row in first_pass}
    in_effect = {
        f"{row['repo']}-{row['pr']}": set(row["in_effect"]) for row in load_jsonl(HERE / "screen.jsonl")
    }

    expected = audit_set(first_pass)
    answers: dict[str, dict] = {}
    for path in sorted(Path(args[0]).rglob("*.json")):
        case_id, body = read_answer(path)
        if case_id in answers:
            raise SystemExit(f"two answers for {case_id}")
        answers[case_id] = body

    unknown = sorted(set(answers) - set(expected))
    missing = [case_id for case_id in expected if case_id not in answers]
    if unknown:
        raise SystemExit(f"answers for cases outside the audit set: {', '.join(unknown)}")
    if missing:
        raise SystemExit(f"{len(answers)} of {len(expected)} cases answered; missing: {', '.join(missing)}")

    owner_rows, unresolved = [], []
    for case_id in expected:
        body = answers[case_id]
        verdict = body.get("verdict")
        if verdict not in VERDICTS:
            raise SystemExit(f"{case_id}: verdict {verdict!r} is not one of {sorted(VERDICTS)}")
        note = str(body.get("note") or "").strip()
        first = by_case[case_id]
        commitment = None
        if verdict != "no":
            named = [rule for rule in RULE_ID.findall(note) if rule in in_effect[case_id]]
            commitment = named[0] if named else first.get("commitment") or "unspecified"
            if commitment == "unspecified":
                unresolved.append(case_id)
        owner_rows.append({
            "repo": first["repo"],
            "pr": first["pr"],
            "label": verdict,
            "commitment": commitment,
            "evidence": note,
            "rationale": note or "(no note)",
            "labeled_at": body.get("at") or "",
            "labeler": OWNER,
        })

    kept = [row for row in rows if row.get("labeler") != OWNER]
    LABELS.write_text("".join(json.dumps(row) + "\n" for row in kept + owner_rows), encoding="utf-8")

    agree = sum(1 for row in owner_rows if row["label"] == by_case[f"{row['repo']}-{row['pr']}"]["label"])
    counts = {verdict: sum(1 for row in owner_rows if row["label"] == verdict) for verdict in sorted(VERDICTS)}
    print(f"appended {len(owner_rows)} owner audit rows to {LABELS.name}: {counts}; "
          f"agreement with the first pass {agree}/{len(owner_rows)}")
    if unresolved:
        print(f"no rule id for: {', '.join(unresolved)} (ask the owner which commitment, then import again)")


if __name__ == "__main__":
    main()
