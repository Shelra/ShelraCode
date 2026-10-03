#!/usr/bin/env python3
"""Merge per-task results of the public SWE-bench Pro comparison into one table per (agent, model), and compare the
two harnesses task by task on the same model.

Input: one or more results roots written by run_subset.py (layout <root>/<agent>/<model-slug>/tasks/<id>.json),
for example the extracted artifacts of several workflow runs. When a task appears more than once, a final outcome
wins over a non-final one, then the most recent attempt.

Output (--out): summary.json and summary.md.

Metrics per arm (only final outcomes count: resolved, unresolved, setup_failed; "error" is reported, not counted):
  resolved rate with a 95% bootstrap interval over tasks;
  requests per solved task (OpenRouter free-request counter delta per task) and harness steps per solved task;
  tokens (input + output) per solved task;
  claims: tasks the harness reported as done, and false completions = claimed done but the evaluation failed.
    Shelra: strict = the host's "[Checked by Shelra …]" verdict; broad = that or a turn that ended normally with
    no verdict line. mini-swe-agent: exit status "Submitted".
Paired comparison per model (tasks with a final outcome in both arms): difference in resolved rate with a 95% paired
bootstrap interval, the discordant pairs, and an exact McNemar p-value.

Usage:
  python bench/public/collect.py --results bench-results [--results more-results] --subset pilot20 --out report
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
SUBSETS = {
    "pilot20": HERE / "swebench-pro-pilot20.txt",
    "headline50": HERE / "swebench-pro-headline50.txt",
}
COUNTED = {"resolved", "unresolved", "setup_failed"}
FINAL = COUNTED | {"error"}
STATUSES = ["resolved", "unresolved", "setup_failed", "error", "quota_lost", "infra_error", "setup_error", "pending"]


def load_subset(name_or_path: str) -> list[str]:
    path = SUBSETS.get(name_or_path, Path(name_or_path))
    return [s.strip() for s in path.read_text(encoding="utf-8").splitlines() if s.strip() and not s.startswith("#")]


def last_finished(record: dict[str, Any]) -> str:
    attempts = record.get("attempts") or []
    return str(attempts[-1].get("finished_at") or "") if attempts else ""


def better(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
    a_final, b_final = a.get("status") in FINAL, b.get("status") in FINAL
    if a_final != b_final:
        return a if a_final else b
    return a if last_finished(a) >= last_finished(b) else b


def load_records(roots: list[Path]) -> dict[tuple[str, str], dict[str, dict[str, Any]]]:
    arms: dict[tuple[str, str], dict[str, dict[str, Any]]] = {}
    for root in roots:
        for path in sorted(root.glob("*/*/tasks/*.json")):
            try:
                record = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            agent, model, iid = record.get("agent"), record.get("model"), record.get("instance_id")
            if not (agent and model and iid):
                continue
            arm = arms.setdefault((agent, model), {})
            arm[iid] = better(arm[iid], record) if iid in arm else record
    return arms


def percentile(sorted_values: list[float], q: float) -> float:
    if not sorted_values:
        return float("nan")
    k = (len(sorted_values) - 1) * q
    lo, hi = math.floor(k), math.ceil(k)
    return sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * (k - lo)


def bootstrap_mean(values: list[float], n: int, seed: int) -> tuple[float, float]:
    if not values:
        return float("nan"), float("nan")
    rng = random.Random(seed)
    m = len(values)
    means = sorted(sum(values[rng.randrange(m)] for _ in range(m)) / m for _ in range(n))
    return percentile(means, 0.025), percentile(means, 0.975)


def mcnemar_exact(b: int, c: int) -> float:
    n = b + c
    if n == 0:
        return 1.0
    k = min(b, c)
    tail = sum(math.comb(n, i) for i in range(k + 1)) / 2**n
    return min(1.0, 2 * tail)


def ratio(num: float | None, den: int) -> float | None:
    return round(num / den, 1) if num is not None and den > 0 else None


def arm_summary(agent: str, records: dict[str, dict[str, Any]], subset: list[str], n_boot: int, seed: int):
    statuses = {iid: (records.get(iid) or {}).get("status", "pending") for iid in subset}
    counts = {s: sum(1 for v in statuses.values() if v == s) for s in STATUSES}
    counted = [iid for iid in subset if statuses[iid] in COUNTED]
    solved = [iid for iid in counted if statuses[iid] == "resolved"]
    outcomes = [1.0 if statuses[iid] == "resolved" else 0.0 for iid in counted]
    low, high = bootstrap_mean(outcomes, n_boot, seed)

    def total(field: str) -> tuple[float | None, int]:
        vals = [records[i].get(field) for i in counted if isinstance(records[i].get(field), (int, float))]
        return (float(sum(vals)) if vals else None), len(vals)

    requests, requests_known = total("openrouter_requests")
    steps, _ = total("harness_steps")
    tokens_in, _ = total("input_tokens")
    tokens_out, _ = total("output_tokens")
    tokens = (tokens_in or 0) + (tokens_out or 0) if (tokens_in is not None or tokens_out is not None) else None

    claimed = [i for i in counted if records[i].get("claimed_done") is True]
    false_done = [i for i in claimed if statuses[i] != "resolved"]
    summary: dict[str, Any] = {
        "counts": counts,
        "counted": len(counted),
        "resolved": len(solved),
        "resolved_rate": round(len(solved) / len(counted), 4) if counted else None,
        "resolved_rate_ci95": [round(low, 4), round(high, 4)] if counted else None,
        "requests_total": requests,
        "requests_known_tasks": requests_known,
        "requests_per_solved": ratio(requests, len(solved)),
        "steps_per_solved": ratio(steps, len(solved)),
        "tokens_per_solved": ratio(tokens, len(solved)),
        "claimed_done": len(claimed),
        "false_completions": len(false_done),
        "false_completion_rate": round(len(false_done) / len(claimed), 4) if claimed else None,
        "false_completion_tasks": false_done,
    }
    if agent == "shelra":
        strict = [i for i in counted if records[i].get("claim") == "checked"]
        strict_false = [i for i in strict if statuses[i] != "resolved"]
        summary.update(
            {
                "checked_verdicts": len(strict),
                "false_completions_strict": len(strict_false),
                "false_completion_strict_tasks": strict_false,
                "model_contaminated_tasks": [i for i in counted if records[i].get("model_contaminated")],
            }
        )
    return summary, statuses


def paired(base: dict[str, str], cand: dict[str, str], subset: list[str], n_boot: int, seed: int) -> dict[str, Any]:
    both = [i for i in subset if base.get(i) in COUNTED and cand.get(i) in COUNTED]
    diffs = [(cand[i] == "resolved") - (base[i] == "resolved") for i in both]
    b = sum(1 for d in diffs if d > 0)  # candidate solved, baseline did not
    c = sum(1 for d in diffs if d < 0)  # baseline solved, candidate did not
    low, high = bootstrap_mean([float(d) for d in diffs], n_boot, seed)
    return {
        "paired_tasks": len(both),
        "candidate_rate": round(sum(cand[i] == "resolved" for i in both) / len(both), 4) if both else None,
        "baseline_rate": round(sum(base[i] == "resolved" for i in both) / len(both), 4) if both else None,
        "difference": round(sum(diffs) / len(both), 4) if both else None,
        "difference_ci95": [round(low, 4), round(high, 4)] if both else None,
        "candidate_only": b,
        "baseline_only": c,
        "mcnemar_exact_p": round(mcnemar_exact(b, c), 4),
    }


def pct(x: float | None) -> str:
    return "n/a" if x is None or (isinstance(x, float) and math.isnan(x)) else f"{100 * x:.1f}%"


def fmt(x: Any) -> str:
    return "n/a" if x is None else str(x)


def render_markdown(report: dict[str, Any]) -> str:
    lines = ["# Public benchmark: SWE-bench Pro (v2), harness against harness", ""]
    lines.append(f"Subset: `{report['subset']}` ({report['subset_size']} tasks). Bootstrap: {report['bootstrap']}.")
    lines.append("")
    for model, block in report["models"].items():
        lines += [f"## {model}", ""]
        lines.append(
            "| Harness | Resolved | Rate (95% CI) | Pending | Quota-lost | Errors | Requests/solved | Steps/solved "
            "| Tokens/solved | Claimed done | False completions |"
        )
        lines.append("|---|---|---|---|---|---|---|---|---|---|---|")
        for agent, s in block["arms"].items():
            c = s["counts"]
            ci = s["resolved_rate_ci95"]
            rate = f"{pct(s['resolved_rate'])} ({pct(ci[0])} to {pct(ci[1])})" if ci else "n/a"
            false = f"{s['false_completions']}"
            if agent == "shelra":
                false += f" (strict {s['false_completions_strict']} of {s['checked_verdicts']} checked)"
            lines.append(
                f"| {agent} | {s['resolved']}/{s['counted']} | {rate} | {c['pending']} | {c['quota_lost']} "
                f"| {c['error'] + c['infra_error'] + c['setup_error']} | {fmt(s['requests_per_solved'])} "
                f"| {fmt(s['steps_per_solved'])} | {fmt(s['tokens_per_solved'])} | {s['claimed_done']} | {false} |"
            )
        if block.get("paired"):
            p = block["paired"]
            ci = p["difference_ci95"]
            lines += [
                "",
                f"Paired ({report['candidate']} minus {report['baseline']}) on {p['paired_tasks']} tasks: "
                f"{pct(p['difference'])} (95% paired bootstrap {pct(ci[0]) if ci else 'n/a'} to "
                f"{pct(ci[1]) if ci else 'n/a'}); only {report['candidate']} solved {p['candidate_only']}, only "
                f"{report['baseline']} solved {p['baseline_only']}; exact McNemar p = {p['mcnemar_exact_p']}.",
            ]
        contaminated = (block["arms"].get("shelra") or {}).get("model_contaminated_tasks")
        if contaminated:
            lines += ["", f"Warning: another model served steps in {len(contaminated)} Shelra task(s): {contaminated}"]
        lines.append("")
    lines += [
        "Rates count final outcomes only (resolved, unresolved, setup_failed). Pending and quota-lost tasks have not "
        "been evaluated yet; errors are infrastructure failures, excluded and listed in summary.json.",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--results", action="append", required=True, type=Path, help="results root (repeatable)")
    parser.add_argument("--subset", default="pilot20", help="pilot20, headline50, or a file of instance ids")
    parser.add_argument("--out", type=Path, required=True, help="output directory")
    parser.add_argument("--baseline", default="mini-swe-agent")
    parser.add_argument("--candidate", default="shelra")
    parser.add_argument("--bootstrap", type=int, default=10000)
    parser.add_argument("--seed", type=int, default=20261003)
    args = parser.parse_args()

    subset = load_subset(args.subset)
    arms = load_records(args.results)
    models = sorted({model for _, model in arms})
    report: dict[str, Any] = {
        "subset": args.subset,
        "subset_size": len(subset),
        "baseline": args.baseline,
        "candidate": args.candidate,
        "bootstrap": f"{args.bootstrap} resamples over tasks, seed {args.seed}",
        "models": {},
    }
    for model in models:
        block: dict[str, Any] = {"arms": {}, "statuses": {}}
        for agent in sorted({a for a, m in arms if m == model}):
            summary, statuses = arm_summary(agent, arms[(agent, model)], subset, args.bootstrap, args.seed)
            block["arms"][agent] = summary
            block["statuses"][agent] = statuses
        if args.baseline in block["statuses"] and args.candidate in block["statuses"]:
            block["paired"] = paired(
                block["statuses"][args.baseline], block["statuses"][args.candidate], subset, args.bootstrap, args.seed
            )
        report["models"][model] = block

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "summary.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    markdown = render_markdown(report)
    (args.out / "summary.md").write_text(markdown, encoding="utf-8")
    print(markdown)
    return 0


if __name__ == "__main__":
    sys.exit(main())
