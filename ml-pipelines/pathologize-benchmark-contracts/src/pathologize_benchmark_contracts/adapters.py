from __future__ import annotations

from collections import deque
from pathlib import Path
from typing import ClassVar, Protocol, runtime_checkable

from data_artifacts.files import resolve_under
from ml_evaluation.adapters import load_adapter as load_shared_adapter
from ml_evaluation.contracts import AdapterSpec

from .contracts import (
    ExperimentManifest,
    FixtureItem,
    NucleiPrediction,
    NucleusClass,
    NucleusPrediction,
    Prediction,
    QualityPrediction,
    TilePrediction,
    TilingPrediction,
    Workstream,
)
from .synthetic import BACKGROUND, FOLD_LIKE, MARK_LIKE, NUCLEUS_COLORS, read_pnm


@runtime_checkable
class ModelAdapter(Protocol):
    @property
    def adapter_id(self) -> str: ...

    @property
    def adapter_version(self) -> str: ...

    def predict(
        self,
        manifest: ExperimentManifest,
        item: FixtureItem,
        root: Path,
    ) -> Prediction: ...


@runtime_checkable
class AcceleratorTimeReporter(Protocol):
    def accelerator_seconds(self) -> float | None: ...


class DeterministicColorBaseline:
    adapter_id = "deterministic-color-v1"
    adapter_version = "1.0.0"
    artifact_labels: ClassVar[dict[tuple[int, int, int], int]] = {
        FOLD_LIKE: 1,
        MARK_LIKE: 2,
    }

    @staticmethod
    def accelerator_seconds() -> float:
        return 0.0

    @staticmethod
    def _pixels(item: FixtureItem, root: Path) -> list[tuple[int, int, int]]:
        width, height, values = read_pnm(resolve_under(root, item.image_path))
        if (width, height) != (item.width, item.height):
            raise ValueError(f"image dimensions differ from manifest for {item.item_id}")
        return [
            (values[index], values[index + 1], values[index + 2])
            for index in range(0, len(values), 3)
        ]

    def predict(
        self,
        manifest: ExperimentManifest,
        item: FixtureItem,
        root: Path,
    ) -> Prediction:
        pixels = self._pixels(item, root)
        if manifest.workstream == Workstream.SLIDE_QUALITY:
            return self._predict_quality(item, pixels)
        if manifest.workstream == Workstream.TILING_POLICY:
            return self._predict_tiling(manifest, item, pixels)
        return NucleiPrediction(
            workstream=manifest.workstream,
            item_id=item.item_id,
            instances=self._nuclei(pixels, item.width, item.height),
        )

    def _predict_quality(
        self, item: FixtureItem, pixels: list[tuple[int, int, int]]
    ) -> QualityPrediction:
        artifact = [self.artifact_labels.get(pixel, 0) for pixel in pixels]
        return QualityPrediction(
            workstream=Workstream.SLIDE_QUALITY,
            item_id=item.item_id,
            width=item.width,
            height=item.height,
            tissue_labels=[int(pixel != BACKGROUND) for pixel in pixels],
            artifact_labels=artifact,
            reject_slide=any(artifact),
            reject_probability=float(any(artifact)),
        )

    @staticmethod
    def _predict_tiling(
        manifest: ExperimentManifest,
        item: FixtureItem,
        pixels: list[tuple[int, int, int]],
    ) -> TilingPrediction:
        tile_size = int(manifest.parameters["tile_size"])
        minimum_tissue = float(manifest.parameters["minimum_tissue_fraction"])
        tissue = [pixel != BACKGROUND for pixel in pixels]
        tiles: list[TilePrediction] = []
        for y in range(0, item.height - tile_size + 1, tile_size):
            for x in range(0, item.width - tile_size + 1, tile_size):
                indices = [
                    row * item.width + column
                    for row in range(y, y + tile_size)
                    for column in range(x, x + tile_size)
                ]
                fraction = sum(tissue[index] for index in indices) / len(indices)
                if fraction >= minimum_tissue:
                    tiles.append(TilePrediction(x=x, y=y, width=tile_size, height=tile_size))
        return TilingPrediction(
            workstream=Workstream.TILING_POLICY,
            item_id=item.item_id,
            target_microns_per_pixel=float(manifest.parameters["target_microns_per_pixel"]),
            source_microns_per_pixel_x=item.microns_per_pixel_x,
            source_microns_per_pixel_y=item.microns_per_pixel_y,
            tiles=tiles,
        )

    @staticmethod
    def _neighbors(index: int, width: int, height: int) -> tuple[int, ...]:
        x, y = index % width, index // width
        candidates = (
            index - 1 if x else -1,
            index + 1 if x + 1 < width else -1,
            index - width if y else -1,
            index + width if y + 1 < height else -1,
        )
        return tuple(neighbor for neighbor in candidates if neighbor >= 0)

    @classmethod
    def _component(
        cls,
        pending: set[int],
        pixels: list[tuple[int, int, int]],
        width: int,
        height: int,
        start: int,
    ) -> list[int]:
        color = pixels[start]
        queue = deque([start])
        pending.remove(start)
        component: list[int] = []
        while queue:
            index = queue.popleft()
            component.append(index)
            for neighbor in cls._neighbors(index, width, height):
                if neighbor in pending and pixels[neighbor] == color:
                    pending.remove(neighbor)
                    queue.append(neighbor)
        return component

    @staticmethod
    def _nuclei(
        pixels: list[tuple[int, int, int]], width: int, height: int
    ) -> list[NucleusPrediction]:
        color_classes: dict[tuple[int, int, int], NucleusClass] = {
            color: class_name for class_name, color in NUCLEUS_COLORS.items()
        }
        pending = {index for index, pixel in enumerate(pixels) if pixel in color_classes}
        instances: list[NucleusPrediction] = []
        while pending:
            start = min(pending)
            color = pixels[start]
            component = DeterministicColorBaseline._component(pending, pixels, width, height, start)
            instances.append(
                NucleusPrediction(
                    instance_id=len(instances) + 1,
                    class_name=color_classes[color],
                    type_a_probability=float(color_classes[color] == "synthetic_type_a"),
                    pixels=sorted(component),
                )
            )
        return instances


def load_adapter(spec: AdapterSpec, root: Path) -> ModelAdapter:
    return load_shared_adapter(
        spec,
        builtins={
            "pathologize_benchmark_contracts.adapters:DeterministicColorBaseline": (
                DeterministicColorBaseline
            )
        },
        expected_type=ModelAdapter,
        root=root,
    )


def reported_accelerator_seconds(adapter: ModelAdapter) -> float | None:
    if not isinstance(adapter, AcceleratorTimeReporter):
        return None
    duration = adapter.accelerator_seconds()
    if duration is not None and duration < 0:
        raise ValueError("adapter-reported accelerator seconds must be non-negative")
    return duration
