import json
from pathlib import Path
from typing import Literal

import fire

from pathologize_data_products.migrations import existing_product_migration_plans
from pathologize_data_products.models import (
    ArtifactReference,
    ComposedRecord,
    DerivedArtifact,
    DerivedProduct,
    SourceProduct,
    contract_schemas,
)


class Commands:
    def schemas(self, output: str = "schemas", check: bool = False) -> None:
        output_root = Path(output)
        for name, schema in contract_schemas().items():
            path = output_root / f"{name}.schema.json"
            expected = json.dumps(schema, indent=2, sort_keys=True) + "\n"
            if check:
                if not path.is_file() or path.read_text(encoding="utf-8") != expected:
                    raise RuntimeError(f"schema drift: {path}")
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(expected, encoding="utf-8")

    def validate(
        self,
        kind: Literal[
            "artifact-reference",
            "composed-record",
            "derived-artifact",
            "derived-product",
            "source-product",
        ],
        path: str,
    ) -> None:
        models = {
            "artifact-reference": ArtifactReference,
            "composed-record": ComposedRecord,
            "derived-artifact": DerivedArtifact,
            "derived-product": DerivedProduct,
            "source-product": SourceProduct,
        }
        models[kind].model_validate_json(Path(path).read_text(encoding="utf-8"))

    def migration_plan(self, repository: str = ".") -> None:
        plans = existing_product_migration_plans(Path(repository).resolve())
        print(json.dumps([plan.model_dump(mode="json") for plan in plans], indent=2))


def main() -> None:
    fire.Fire(Commands)


if __name__ == "__main__":
    main()
