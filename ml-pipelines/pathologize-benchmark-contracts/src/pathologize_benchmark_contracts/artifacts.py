from pathlib import Path

__all__ = [
    "contract_root",
    "project_root",
]


def project_root() -> Path:
    return Path.cwd().resolve()


def contract_root() -> Path:
    return Path(__file__).resolve().parents[2]
