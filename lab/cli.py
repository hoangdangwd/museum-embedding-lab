"""Folder-based import, query and held-out evaluation. Run: python -m lab.cli --help."""
import argparse
import csv
import json
import sys
from pathlib import Path

from dotenv import load_dotenv

from .embeddings import Embedder, ROOT
from .images import LabError, read_picture
from .service import Lab
from .store import Store

EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


def photos(folder):
    return sorted(p for p in folder.rglob("*") if p.is_file() and p.suffix.lower() in EXTENSIONS)


def evaluate(lab, folder, threshold, margin):
    files = photos(folder)
    if not files:
        raise LabError("Thư mục test không có ảnh JPEG/PNG/WebP.")
    known = {r["artifact"] for r in lab.store.list(lab.embedder.signature)}
    labels = {p.relative_to(folder).parts[0] if len(p.relative_to(folder).parts) > 1 else "" for p in files}
    if "" in labels or labels - known - {"_unknown"}:
        raise LabError("Mỗi ảnh test phải ở thư mục con có tên hiện vật đã nhập, hoặc _unknown cho vật ngoài danh mục.")
    results = []
    for path in files:
        expected = path.relative_to(folder).parts[0]
        row = {"file": str(path.relative_to(folder)), "expected": expected}
        try:
            outcome = lab.query(read_picture(path.read_bytes()), threshold, margin)
            row.update({"predicted": outcome["best_artifact"], "decision": outcome["decision"],
                        "score": outcome["best_score"], "margin": outcome["margin"],
                        "leaked_reference": outcome["same_as_reference"],
                        "embedding_ms": outcome["timing_ms"]["embedding"],
                        "search_ms": outcome["timing_ms"]["search"], "usage": outcome["usage"]})
            row["candidates"] = [{"artifact": c["artifact"], "score": c["score"]} for c in outcome["candidates"]]
            row["dimensions"] = outcome["dimensions"]
        except LabError as exc:
            row["error"] = str(exc)
        results.append(row)
    # Same-image queries and errors are disclosed, never counted as valid accuracy samples.
    valid = [r for r in results if "error" not in r and not r["leaked_reference"]]
    known_rows = [r for r in valid if r["expected"] != "_unknown"]
    unknown_rows = [r for r in valid if r["expected"] == "_unknown"]
    accepted = [r for r in valid if r["decision"] == "match"]
    correct_top = sum(r["predicted"] == r["expected"] for r in known_rows)
    correct_accepted = sum(r["predicted"] == r["expected"] for r in accepted)
    false_unknown = sum(r["decision"] == "match" for r in unknown_rows)

    def fraction(n, d):
        return {"count": n, "total": d, "rate": n / d if d else None}

    return {"model": lab.embedder.info(), "threshold": threshold, "min_margin": margin,
            "summary": {"total_files": len(files), "valid_samples": len(valid),
                        "errors": sum("error" in r for r in results),
                        "excluded_reference_duplicates": sum(r.get("leaked_reference", False) for r in results),
                        "top1_accuracy_known": fraction(correct_top, len(known_rows)),
                        "accepted_precision": fraction(correct_accepted, len(accepted)),
                        "correct_acceptance_known": fraction(correct_accepted, len(known_rows)),
                        "false_acceptance_unknown": fraction(false_unknown, len(unknown_rows))},
            "note": "Đánh giá tìm kiếm trong danh mục, không bao gồm nhiệm vụ sai mục tiêu. Không tự hiệu chỉnh ngưỡng trên bộ test. Ảnh gần trùng cần kiểm soát khi chia dữ liệu.",
            "results": results}


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=ROOT / "data" / "lab.sqlite3")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("prepare", help="Download/load model or validate OpenRouter configuration")
    importer = commands.add_parser("import", help="Import references/<artifact>/*.jpg")
    importer.add_argument("folder", type=Path)
    commands.add_parser("index", help="Embed all new reference images")
    query = commands.add_parser("query")
    query.add_argument("image", type=Path)
    query.add_argument("--target", default=None)
    benchmark = commands.add_parser("evaluate", help="Evaluate test/<artifact> and test/_unknown")
    benchmark.add_argument("folder", type=Path)
    benchmark.add_argument("--output", type=Path, default=ROOT / "reports" / "evaluation.json")
    for command in (query, benchmark):
        command.add_argument("--threshold", type=float, default=.8)
        command.add_argument("--margin", type=float, default=.05)
    args = parser.parse_args()
    load_dotenv(ROOT / ".env")
    lab = Lab(Store(args.database), Embedder())
    try:
        if args.command == "prepare":
            lab.embedder.prepare()
            result = lab.embedder.info()
        elif args.command == "import":
            files = photos(args.folder)
            if not files:
                raise LabError("Không tìm thấy ảnh trong thư mục.")
            if any(len(p.relative_to(args.folder).parts) < 2 for p in files):
                raise LabError("Đặt ảnh tham chiếu trong thư mục con theo tên hiện vật.")
            result = {"added": 0, "duplicates": 0, "errors": []}
            for path in files:
                try:
                    item = lab.store.add(path.relative_to(args.folder).parts[0], path.name, read_picture(path.read_bytes()))
                    result["duplicates" if item["duplicate"] else "added"] += 1
                except LabError as exc:
                    result["errors"].append({"file": str(path), "error": str(exc)})
        elif args.command == "index":
            result = lab.build()
        elif args.command == "query":
            result = lab.query(read_picture(args.image.read_bytes()), args.threshold, args.margin, args.target)
        else:
            result = evaluate(lab, args.folder, args.threshold, args.margin)
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
            with args.output.with_suffix(".csv").open("w", encoding="utf-8-sig", newline="") as stream:
                writer = csv.DictWriter(stream, fieldnames=["file", "expected", "predicted", "decision", "score", "margin", "leaked_reference", "embedding_ms", "search_ms", "error"], extrasaction="ignore")
                writer.writeheader()
                writer.writerows(result["results"])
            print(f"JSON: {args.output}\nCSV: {args.output.with_suffix('.csv')}")
            result = result["summary"]
        print(json.dumps(result, ensure_ascii=False, indent=2))
        if result.get("errors"):
            return 1
        return 0
    except (LabError, OSError) as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
