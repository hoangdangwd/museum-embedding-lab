"""Prepare a fixed exploratory split without modifying the original image folder."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SELECTED = {
    "bottle": ["bottle_002.jpg", "bottle_005.jpg"],
    "case pc": ["case_pc_001.jpg", "case_pc_003.jpg"],
    "coca can": ["coca_can_001.jpg", "coca_can_006.jpg"],
    "figure": ["figure_002.jpg", "figure_003.jpg"],
    "key": ["key_003.jpg", "key_005.jpg"],
    "laptop": ["laptop_001.jpg", "laptop_002.jpg"],
    "mask": ["mask_002.jpg", "mask_006.jpg"],
    "pepsi can": ["pepsi_can_003.jpg", "pepsi_can_006.jpg"],
}


def main():
    destination = ROOT / "data" / "image-baseline-v1"
    entries = []
    for artifact, references in SELECTED.items():
        folder = ROOT / "image" / artifact
        for name in references:
            if not (folder / name).is_file():
                raise RuntimeError(f"Missing reference: {folder / name}")
        for source in sorted(folder.glob("*.jpg")):
            split = "references" if source.name in references else "probe"
            target = destination / split / artifact / source.name
            raw = source.read_bytes()
            if target.exists() and target.read_bytes() != raw:
                raise RuntimeError(f"Destination has changed: {target}")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)
            entries.append({"source": source.relative_to(ROOT).as_posix(), "split": split,
                            "artifact": artifact, "sha256": hashlib.sha256(raw).hexdigest()})
    refs = {e["sha256"] for e in entries if e["split"] == "references"}
    probes = {e["sha256"] for e in entries if e["split"] == "probe"}
    assert not refs.intersection(probes), "Duplicate images across partitions"
    manifest = {"purpose": "Exploratory same-session probe, not an independent final test",
                "selection": "Two visually different reference views per artifact; selection made before model scoring",
                "references": len(refs), "probe": len(probes), "entries": entries}
    (destination / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"references": len(refs), "probe": len(probes), "destination": str(destination)}))


if __name__ == "__main__":
    main()
