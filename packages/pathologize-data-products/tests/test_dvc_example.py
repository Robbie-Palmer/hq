import hashlib
import json
import shutil
import subprocess
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = PACKAGE_ROOT.parents[1]
DVC_TOOL = REPOSITORY_ROOT / "ml-pipelines/dvc-tool"
EXAMPLE = PACKAGE_ROOT / "examples/dvc-stale-detection"


def _dvc(root: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            "mise",
            "exec",
            "uv@0.12.22",
            "--",
            "uv",
            "run",
            "--project",
            str(DVC_TOOL),
            "--frozen",
            "--",
            "dvc",
            "--cd",
            str(root),
            *arguments,
        ],
        cwd=REPOSITORY_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )


def test_source_lock_change_marks_derived_product_stale_without_changing_output(
    tmp_path: Path,
) -> None:
    root = tmp_path / "example"
    shutil.copytree(EXAMPLE, root)
    output = root / "derived/composed.json"
    before = hashlib.sha256(output.read_bytes()).hexdigest()

    assert json.loads(_dvc(root, "status", "derived/dvc.yaml", "--json").stdout) == {}
    source_lock = root / "source/dvc.lock"
    source_lock.write_text(
        source_lock.read_text(encoding="utf-8") + "# source-v2\n",
        encoding="utf-8",
    )
    status = json.loads(_dvc(root, "status", "derived/dvc.yaml", "--json").stdout)

    assert status["derived/dvc.yaml:compose"] == [{"changed deps": {"source/dvc.lock": "modified"}}]
    assert hashlib.sha256(output.read_bytes()).hexdigest() == before
