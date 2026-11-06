from __future__ import annotations

import shutil
from pathlib import Path

from .artifacts import load_model, write_json
from .contracts import (
    FixtureItem,
    FixtureManifest,
    FixturePlan,
    LeakageKeys,
    NucleusClass,
    NucleusTruth,
)

BACKGROUND = (245, 245, 245)
TISSUE = (188, 126, 174)
FOLD_LIKE = (32, 170, 216)
MARK_LIKE = (24, 48, 180)
NUCLEUS_COLORS: dict[NucleusClass, tuple[int, int, int]] = {
    "synthetic_type_a": (72, 26, 96),
    "synthetic_type_b": (150, 42, 62),
}


def _write_pnm(path: Path, magic: str, width: int, height: int, values: list[int]) -> None:
    channels = 3 if magic == "P3" else 1
    expected = width * height * channels
    if len(values) != expected:
        raise ValueError(f"{path.name} has {len(values)} values, expected {expected}")
    maximum = max(1, max(values, default=1))
    rows = [
        " ".join(str(value) for value in values[index : index + width * channels])
        for index in range(0, len(values), width * channels)
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        f"{magic}\n{width} {height}\n{maximum}\n" + "\n".join(rows) + "\n", encoding="ascii"
    )


def read_pnm(path: Path) -> tuple[int, int, list[int]]:
    tokens = path.read_text(encoding="ascii").split()
    if len(tokens) < 4 or tokens[0] not in {"P2", "P3"}:
        raise ValueError(f"unsupported PNM fixture: {path}")
    channels = 3 if tokens[0] == "P3" else 1
    width, height, maximum = (int(value) for value in tokens[1:4])
    values = [int(value) for value in tokens[4:]]
    if maximum <= 0 or len(values) != width * height * channels:
        raise ValueError(f"invalid PNM fixture: {path}")
    return width, height, values


def _paint_circle(
    image: list[tuple[int, int, int]],
    instance_mask: list[int],
    *,
    width: int,
    height: int,
    center_x: int,
    center_y: int,
    radius: int,
    color: tuple[int, int, int],
    instance_id: int,
) -> None:
    for y in range(max(0, center_y - radius), min(height, center_y + radius + 1)):
        for x in range(max(0, center_x - radius), min(width, center_x + radius + 1)):
            if (x - center_x) ** 2 + (y - center_y) ** 2 <= radius**2:
                index = y * width + x
                image[index] = color
                instance_mask[index] = instance_id


def _render_case(
    root: Path,
    *,
    plan: FixturePlan,
    case_index: int,
) -> FixtureItem:
    case = plan.cases[case_index]
    width, height = plan.width, plan.height
    image = [BACKGROUND] * (width * height)
    tissue = [0] * (width * height)
    artifact = [0] * (width * height)
    instance_mask = [0] * (width * height)

    x_start = 6 + case_index % 3
    y_start = 7 + case_index % 2
    x_stop = width - 7
    y_stop = height - 6
    for y in range(y_start, y_stop):
        for x in range(x_start, x_stop):
            index = y * width + x
            image[index] = TISSUE
            tissue[index] = 1

    if case.variant != "clean":
        label = 1 if case.variant == "fold_like" else 2
        color = FOLD_LIKE if label == 1 else MARK_LIKE
        artifact_x = width - 18
        for y in range(y_start + 2, y_stop - 2):
            for x in range(artifact_x, artifact_x + 3):
                index = y * width + x
                image[index] = color
                artifact[index] = label

    nuclei: list[tuple[int, NucleusClass, int, int]] = [
        (1, "synthetic_type_a", x_start + 12, y_start + 13),
        (2, "synthetic_type_b", x_start + 25, y_start + 24),
        (3, "synthetic_type_a", x_start + 35, y_start + 12),
    ]
    for instance_id, class_name, center_x, center_y in nuclei:
        _paint_circle(
            image,
            instance_mask,
            width=width,
            height=height,
            center_x=center_x,
            center_y=center_y,
            radius=3,
            color=NUCLEUS_COLORS[class_name],
            instance_id=instance_id,
        )

    relative_dir = Path("data/synthetic") / case.case_id
    case_dir = root / relative_dir
    rgb_values = [channel for pixel in image for channel in pixel]
    _write_pnm(case_dir / "image.ppm", "P3", width, height, rgb_values)
    _write_pnm(case_dir / "tissue-mask.pgm", "P2", width, height, tissue)
    _write_pnm(case_dir / "artifact-mask.pgm", "P2", width, height, artifact)
    _write_pnm(case_dir / "nucleus-instances.pgm", "P2", width, height, instance_mask)

    suffix = f"{case_index + 1:03d}"
    return FixtureItem(
        item_id=case.case_id,
        split=case.split,
        synthetic=True,
        image_path=(relative_dir / "image.ppm").as_posix(),
        tissue_mask_path=(relative_dir / "tissue-mask.pgm").as_posix(),
        artifact_mask_path=(relative_dir / "artifact-mask.pgm").as_posix(),
        nucleus_instance_mask_path=(relative_dir / "nucleus-instances.pgm").as_posix(),
        nucleus_truth=[
            NucleusTruth(instance_id=instance_id, class_name=class_name)
            for instance_id, class_name, _, _ in nuclei
        ],
        width=width,
        height=height,
        microns_per_pixel_x=0.5,
        microns_per_pixel_y=0.5,
        leakage=LeakageKeys(
            subject_id=f"synthetic-subject-{suffix}",
            specimen_id=f"synthetic-specimen-{suffix}",
            block_id=f"synthetic-block-{suffix}",
            slide_id=f"synthetic-slide-{suffix}",
            acquisition_id=f"synthetic-acquisition-{suffix}",
            site_id=f"synthetic-site-{1 + case_index % 2}",
        ),
    )


def generate_fixtures(root: Path, plan_path: Path | None = None) -> FixtureManifest:
    plan_path = plan_path or root / "fixtures/spec.json"
    plan = load_model(plan_path, FixturePlan)
    output = root / "data/synthetic"
    if output.exists():
        shutil.rmtree(output)
    items = [_render_case(root, plan=plan, case_index=index) for index in range(len(plan.cases))]
    manifest = FixtureManifest(
        schema_version="1.0.0",
        dataset_id="pathologize-synthetic-contract-fixtures-v1",
        intended_use="contract_and_pipeline_tests_only",
        clinical_validity=False,
        seed=plan.seed,
        items=items,
    )
    write_json(output / "manifest.json", manifest)
    return manifest
