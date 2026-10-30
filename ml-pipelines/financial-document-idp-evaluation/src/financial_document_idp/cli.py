from __future__ import annotations

from collections.abc import Sequence

import fire
from pydantic import BaseModel, ConfigDict, ValidationError

from .pipeline import (
    build_corpus,
    error_analysis,
    evaluate,
    extract,
    match,
    normalize,
    safety_and_render,
    verify,
    write_schemas,
)


class SchemaOptions(BaseModel):
    model_config = ConfigDict(strict=True)

    check: bool = False


class FinancialDocumentEvaluation:
    def build_corpus(self) -> None:
        build_corpus()

    def safety_render(self) -> None:
        safety_and_render()

    def extract(self) -> None:
        extract()

    def normalize(self) -> None:
        normalize()

    def match(self) -> None:
        match()

    def evaluate(self) -> None:
        evaluate()

    def error_analysis(self) -> None:
        error_analysis()

    def verify(self) -> None:
        verify()

    def schemas(self, check: bool = False) -> None:
        options = SchemaOptions(check=check)
        write_schemas(check=options.check)


def main(command: Sequence[str] | None = None) -> int:
    try:
        application = FinancialDocumentEvaluation()
        fire.Fire(
            {
                "build-corpus": application.build_corpus,
                "safety-render": application.safety_render,
                "extract": application.extract,
                "normalize": application.normalize,
                "match": application.match,
                "evaluate": application.evaluate,
                "error-analysis": application.error_analysis,
                "verify": application.verify,
                "schemas": application.schemas,
            },
            command=list(command) if command is not None else None,
            name="financial-document-idp",
        )
    except ValidationError as error:
        print(error)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
