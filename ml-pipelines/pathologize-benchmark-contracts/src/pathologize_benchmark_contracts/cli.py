from __future__ import annotations

from collections.abc import Sequence

import fire
from pydantic import BaseModel, ConfigDict, ValidationError

from .pipeline import (
    aggregate_scorecards,
    compare_experiment,
    compare_only_experiment,
    evaluate_experiment,
    evaluate_only_experiment,
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


class PathologizeBenchmark:
    def generate_fixtures(self) -> None:
        generate()

    def validate_contracts(self) -> None:
        validate_contracts()

    def import_registry(self, experiment_id: str) -> None:
        import_registry(experiment_id)

    def run_adapters(self) -> None:
        run_adapters()

    def evaluate(self, experiment_id: str) -> None:
        evaluate_experiment(experiment_id)

    def evaluate_only(self) -> None:
        evaluate_only_experiment()

    def compare(self, experiment_id: str) -> None:
        compare_experiment(experiment_id)

    def compare_only(self) -> None:
        compare_only_experiment()

    def aggregate(self) -> None:
        aggregate_scorecards()

    def schemas(self, check: bool = False) -> None:
        options = SchemaOptions(check=check)
        write_schemas(check=options.check)

    def verify(self) -> None:
        verify()


def main(command: Sequence[str] | None = None) -> int:
    try:
        application = PathologizeBenchmark()
        fire.Fire(
            {
                "generate-fixtures": application.generate_fixtures,
                "validate-contracts": application.validate_contracts,
                "import-registry": application.import_registry,
                "run-adapters": application.run_adapters,
                "eval": application.evaluate,
                "eval-only": application.evaluate_only,
                "compare": application.compare,
                "compare-only": application.compare_only,
                "aggregate": application.aggregate,
                "schemas": application.schemas,
                "verify": application.verify,
            },
            command=list(command) if command is not None else None,
            name="pathologize-benchmark",
        )
    except (OSError, TypeError, ValueError, ValidationError) as error:
        print(error)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
