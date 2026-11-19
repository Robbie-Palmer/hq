import json
from pathlib import Path


def main() -> None:
    root = Path(__file__).resolve().parent
    source = root.parent / "source"
    product = json.loads((source / "product.json").read_text(encoding="utf-8"))
    records = [
        json.loads(line)
        for line in (source / "records.jsonl").read_text(encoding="utf-8").splitlines()
        if line
    ]
    output = {
        "kind": "derived",
        "product": "example/derived-measurements",
        "upstream": {"product": product["product"], "version": product["version"]},
        "records": records,
    }
    (root / "composed.json").write_text(
        json.dumps(output, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
