from __future__ import annotations

import importlib
from collections import deque
from pathlib import Path
from typing import Protocol, cast, runtime_checkable

from .artifacts import resolve_under
from .contracts import (
    AdapterSpec,
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

    def predict(
        self,
        manifest: ExperimentManifest,
        item: FixtureItem,
        root: Path,
    ) -> Prediction: ...


class DeterministicColorBaseline:
    adapter_id = "deterministic-color-v1"

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
            artifact = [
                1 if pixel == FOLD_LIKE else 2 if pixel == MARK_LIKE else 0 for pixel in pixels
            ]
            tissue = [int(pixel != BACKGROUND) for pixel in pixels]
            return QualityPrediction(
                workstream=manifest.workstream,
                item_id=item.item_id,
                width=item.width,
                height=item.height,
                tissue_labels=tissue,
                artifact_labels=artifact,
                reject_slide=any(artifact),
            )
        if manifest.workstream == Workstream.TILING_POLICY:
            tile_size = int(manifest.parameters["tile_size"])
            minimum_tissue = float(manifest.parameters["minimum_tissue_fraction"])
            target_mpp = float(manifest.parameters["target_microns_per_pixel"])
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
                        tiles.append(
                            TilePrediction(
                                x=x,
                                y=y,
                                width=tile_size,
                                height=tile_size,
                            )
                        )
            return TilingPrediction(
                workstream=manifest.workstream,
                item_id=item.item_id,
                target_microns_per_pixel=target_mpp,
                tiles=tiles,
            )
        return NucleiPrediction(
            workstream=manifest.workstream,
            item_id=item.item_id,
            instances=self._nuclei(pixels, item.width, item.height),
        )

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
            queue = deque([start])
            pending.remove(start)
            component: list[int] = []
            while queue:
                index = queue.popleft()
                component.append(index)
                x, y = index % width, index // width
                neighbors = [
                    neighbor
                    for neighbor in (
                        index - 1 if x else -1,
                        index + 1 if x + 1 < width else -1,
                        index - width if y else -1,
                        index + width if y + 1 < height else -1,
                    )
                    if neighbor >= 0
                ]
                for neighbor in neighbors:
                    if neighbor in pending and pixels[neighbor] == color:
                        pending.remove(neighbor)
                        queue.append(neighbor)
            instances.append(
                NucleusPrediction(
                    instance_id=len(instances) + 1,
                    class_name=color_classes[color],
                    pixels=sorted(component),
                )
            )
        return instances


def load_adapter(spec: AdapterSpec) -> ModelAdapter:
    if spec.kind == "builtin":
        adapter: object = DeterministicColorBaseline()
    else:
        module_name, separator, attribute = spec.entrypoint.partition(":")
        if not separator:
            raise ValueError("python adapter entrypoint must use module:attribute")
        factory = getattr(importlib.import_module(module_name), attribute)
        adapter = factory()
    if not isinstance(adapter, ModelAdapter):
        raise TypeError(f"adapter {spec.adapter_id} does not implement ModelAdapter")
    typed_adapter = cast(ModelAdapter, adapter)
    if typed_adapter.adapter_id != spec.adapter_id:
        raise ValueError("loaded adapter ID differs from the pinned manifest")
    return typed_adapter
