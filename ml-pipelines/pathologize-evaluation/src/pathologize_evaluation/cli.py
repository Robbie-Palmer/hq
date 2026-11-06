from __future__ import annotations

from collections.abc import Sequence

import fire
from pydantic import BaseModel, ConfigDict, ValidationError

from .pipeline import (
    aggregate_scorecards,
    evaluate_experiment,
    generate,
    import_registry,
    run_adapters,
    validate_contracts,
    verify,
    write_schemas,
)


class SchemaOptions(BaseModel):
    model_config = ConfigDict(strict=True)

    check: bool = False


class PathologizeEvaluation:
    def generate_fixtures(self) -> None:
        generate()

    def validate_contracts(self) -> None:
        validate_contracts()

    def import_registry(self, experiment_id: str) -> None:
        import_registry(experiment_id)

    def run_adapters(self) -> None:
        run_adapters()

    def evaluate(self, experiment_id: str) -> None:
        aliases = {
            "quality": "whole-slide-quality-contract-v1",
            "tiling": "tiling-magnification-contract-v1",
            "nuclei": "nucleus-analysis-contract-v1",
        }
        evaluate_experiment(aliases.get(experiment_id, experiment_id))

    def aggregate(self) -> None:
        aggregate_scorecards()

    def schemas(self, check: bool = False) -> None:
        options = SchemaOptions(check=check)
        write_schemas(check=options.check)

    def verify(self) -> None:
        verify()


def main(command: Sequence[str] | None = None) -> int:
    try:
        application = PathologizeEvaluation()
        fire.Fire(
            {
                "generate-fixtures": application.generate_fixtures,
                "validate-contracts": application.validate_contracts,
                "import-registry": application.import_registry,
                "run-adapters": application.run_adapters,
                "eval": application.evaluate,
                "aggregate": application.aggregate,
                "schemas": application.schemas,
                "verify": application.verify,
            },
            command=list(command) if command is not None else None,
            name="pathologize-evaluation",
        )
    except (OSError, TypeError, ValueError, ValidationError) as error:
        print(error)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
