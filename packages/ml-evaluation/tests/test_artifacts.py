from pathlib import Path

import pytest

from ml_evaluation.artifacts import (
    canonical_bytes,
    content_address,
    load_model,
    read_json,
    read_jsonl,
    resolve_under,
    sha256_file,
    sha256_tree,
    source_fingerprint,
    write_json,
    write_jsonl,
)
from ml_evaluation.contracts import AdapterSpec


def test_json_artifacts_are_canonical_and_typed(tmp_path: Path) -> None:
    spec = AdapterSpec(
        adapter_id="baseline-v1",
        kind="builtin",
        entrypoint="example:Baseline",
        version="1",
        artifact_sha256=None,
    )
    path = tmp_path / "nested/spec.json"
    write_json(path, spec)
    assert read_json(path)["adapter_id"] == "baseline-v1"
    assert load_model(path, AdapterSpec) == spec
    assert canonical_bytes({"b": 2, "a": 1}) == b'{"a":1,"b":2}\n'
    assert content_address("artifact", {"a": 1}).startswith("artifact:sha256:")
    assert len(sha256_file(path)) == 64


def test_json_lines_report_written_bytes(tmp_path: Path) -> None:
    path = tmp_path / "records.jsonl"
    size = write_jsonl(path, [{"id": 1}, {"id": 2}])
    assert size == path.stat().st_size
    assert read_jsonl(path) == [{"id": 1}, {"id": 2}]


def test_tree_digest_includes_relative_paths(tmp_path: Path) -> None:
    first = tmp_path / "a.txt"
    second = tmp_path / "nested/b.txt"
    first.write_text("same", encoding="utf-8")
    second.parent.mkdir()
    second.write_text("same", encoding="utf-8")
    digest = sha256_tree([second, first], root=tmp_path)
    assert digest == sha256_tree([first, second], root=tmp_path)
    second.write_text("changed", encoding="utf-8")
    assert digest != sha256_tree([first, second], root=tmp_path)


def test_source_fingerprint_uses_python_files_only(tmp_path: Path) -> None:
    (tmp_path / "module.py").write_text("VALUE = 1\n", encoding="utf-8")
    before = source_fingerprint(tmp_path)
    (tmp_path / "ignored.txt").write_text("ignored\n", encoding="utf-8")
    assert source_fingerprint(tmp_path) == before
    (tmp_path / "module.py").write_text("VALUE = 2\n", encoding="utf-8")
    assert source_fingerprint(tmp_path) != before


def test_source_fingerprint_requires_python_files(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="Python file"):
        source_fingerprint(tmp_path)


def test_resolve_under_rejects_absolute_and_parent_paths(tmp_path: Path) -> None:
    assert resolve_under(tmp_path, "inside.json") == tmp_path / "inside.json"
    with pytest.raises(ValueError, match="relative"):
        resolve_under(tmp_path, tmp_path / "absolute.json")
    with pytest.raises(ValueError, match="escapes"):
        resolve_under(tmp_path, "../outside.json")
