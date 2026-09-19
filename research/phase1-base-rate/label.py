"""Append first-pass labels to labels.jsonl (one JSON object per pull request; a later line for the same
repo and number replaces an earlier one when the labels are read).

Usage: python label.py <labels_jsonl> <batch_json>
<batch_json> is a JSON array of {repo, pr, label, commitment, evidence, rationale}; label is one of
"violation", "no", "unsure".
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

VALID = {"violation", "no", "unsure"}


def main() -> None:
    out, batch = Path(sys.argv[1]), json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
    stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with out.open("a", encoding="utf-8") as handle:
        for item in batch:
            if item["label"] not in VALID:
                raise SystemExit(f"bad label {item['label']!r} for {item['repo']} #{item['pr']}")
            if item["label"] != "no" and not item.get("commitment"):
                raise SystemExit(f"{item['repo']} #{item['pr']}: a {item['label']} label must name the commitment")
            record = {
                "repo": item["repo"],
                "pr": int(item["pr"]),
                "label": item["label"],
                "commitment": item.get("commitment"),
                "evidence": item.get("evidence", ""),
                "rationale": item["rationale"],
                "labeled_at": stamp,
                "labeler": "first-pass (Claude)",
            }
            handle.write(json.dumps(record) + "\n")
    print(f"appended {len(batch)} labels to {out}")


if __name__ == "__main__":
    main()
