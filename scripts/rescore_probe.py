"""Recalculate threshold decisions from saved scores, without any model/API call."""
import argparse
import json
from collections import Counter
from pathlib import Path


def summarize(rows, threshold, margin):
    valid = [r for r in rows if "error" not in r and not r.get("leaked_reference")]
    accepted = [r for r in valid if r["score"] >= threshold and r["margin"] is not None and r["margin"] >= margin]
    known = [r for r in valid if r["expected"] != "_unknown"]
    unknown = [r for r in valid if r["expected"] == "_unknown"]
    correct = sum(r["expected"] == r["predicted"] for r in accepted)
    return {"threshold": threshold, "margin": margin, "valid": len(valid),
            "top1_correct_known": sum(r["expected"] == r["predicted"] for r in known),
            "known_count": len(known), "accepted": len(accepted), "accepted_correct": correct,
            "accepted_wrong": len(accepted) - correct, "rejected": len(valid) - len(accepted),
            "precision": correct / len(accepted) if accepted else None,
            "correct_acceptance_rate": correct / len(known) if known else None,
            "unknown_count": len(unknown),
            "unknown_false_acceptances": sum(r["expected"] == "_unknown" for r in accepted)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument("--threshold", type=float, default=.8)
    parser.add_argument("--margin", type=float, default=.05)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not -1 <= args.threshold <= 1 or not 0 <= args.margin <= 2:
        parser.error("threshold must be in [-1,1]; margin in [0,2]")
    report = json.loads(args.report.read_text(encoding="utf-8"))
    rows = report["results"]
    hidden = []
    for row in rows:
        if "error" in row or row.get("leaked_reference") or row["expected"] == "_unknown":
            continue
        others = [c for c in row.get("candidates", []) if c["artifact"] != row["expected"]]
        if len(others) >= 2:
            hidden.append({"file": row["file"], "expected": "_unknown", "predicted": others[0]["artifact"],
                           "score": others[0]["score"], "margin": others[0]["score"] - others[1]["score"]})
    result = {"source": str(args.report), "model": report.get("model"),
              "note": "Exploratory rescoring of the same probe set, not independent validation. No API calls.",
              "selected": summarize(rows, args.threshold, args.margin),
              "per_artifact": {name: summarize([r for r in rows if r["expected"] == name], args.threshold, args.margin)
                               for name in sorted({r["expected"] for r in rows})},
              "wrong_predictions": [r for r in rows if "error" not in r and r["expected"] != "_unknown" and r["expected"] != r["predicted"]],
              "original_decisions": dict(Counter(r.get("decision", "error") for r in rows)),
              "grid": [{"known": summarize(rows, threshold, margin),
                        "hidden_class_simulation": summarize(hidden, threshold, margin)}
                       for threshold in (.55, .60, .65, .70, .75, .80, .85, .90)
                       for margin in (.02, .05, .10)],
              "hidden_class_note": "For each known query, omit its true class from ranked candidates. This simulates an omitted catalog class; it does NOT replace photos of genuinely new objects.",
              "hidden_class_simulation": summarize(hidden, args.threshold, args.margin),
              "hidden_class_rows": hidden}
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"selected": result["selected"], "per_artifact": result["per_artifact"],
                      "hidden_class_simulation": result["hidden_class_simulation"]}, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
