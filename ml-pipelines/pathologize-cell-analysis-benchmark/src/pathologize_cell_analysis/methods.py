from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import numpy as np
from numpy.typing import NDArray
from PIL import Image
from scipy import ndimage as ndi
from skimage import color, feature, filters, measure, morphology, segmentation
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from .data import Annotation, SplitItem, load_annotations

FloatArray = NDArray[np.float64]
IntArray = NDArray[np.int64]


@dataclass(frozen=True)
class PredictedNucleus:
    instance_id: int
    center_x: float
    center_y: float
    xmin: int
    ymin: int
    xmax: int
    ymax: int
    flat_pixels: IntArray

    @property
    def bbox(self) -> tuple[int, int, int, int]:
        return self.xmin, self.ymin, self.xmax, self.ymax


def load_rgb(path: Path) -> NDArray[np.uint8]:
    with Image.open(path) as image:
        return np.asarray(image.convert("RGB"), dtype=np.uint8)


def _feature_vector(image: NDArray[np.uint8], bbox: tuple[int, int, int, int]) -> FloatArray:
    height, width = image.shape[:2]
    xmin, ymin, xmax, ymax = bbox
    xmin = max(0, min(xmin, width - 1))
    ymin = max(0, min(ymin, height - 1))
    xmax = max(xmin + 1, min(xmax, width))
    ymax = max(ymin + 1, min(ymax, height))
    crop = image[ymin:ymax, xmin:xmax].astype(np.float64) / 255.0
    crop_height, crop_width = crop.shape[:2]
    y_grid, x_grid = np.ogrid[-1 : 1 : complex(crop_height), -1 : 1 : complex(crop_width)]
    ellipse = x_grid**2 + y_grid**2 <= 1
    pixels = crop[ellipse]
    if not pixels.size:
        pixels = crop.reshape(-1, 3)
    optical_density = -np.log(np.clip(pixels, 1 / 255, 1.0))
    return np.asarray(
        [
            crop_width / width,
            crop_height / height,
            crop_width / max(crop_height, 1),
            crop_width * crop_height / (width * height),
            *pixels.mean(axis=0),
            *pixels.std(axis=0),
            optical_density.mean(),
            optical_density.std(),
        ],
        dtype=np.float64,
    )


def segment_nuclei(
    image: NDArray[np.uint8], minimum_pixels: int, minimum_distance: int
) -> list[PredictedNucleus]:
    normalized = image.astype(np.float64) / 255.0
    hematoxylin = color.rgb2hed(normalized)[:, :, 0]
    threshold = filters.threshold_otsu(hematoxylin)
    foreground = hematoxylin > threshold
    foreground = morphology.remove_small_objects(foreground, max_size=minimum_pixels - 1)
    foreground = morphology.remove_small_holes(foreground, max_size=minimum_pixels - 1)
    distance = ndi.distance_transform_edt(foreground)
    peaks = feature.peak_local_max(
        distance,
        labels=foreground,
        min_distance=minimum_distance,
        exclude_border=False,
    )
    markers = np.zeros(foreground.shape, dtype=np.int32)
    if peaks.size:
        markers[tuple(peaks.T)] = np.arange(1, len(peaks) + 1)
    labels = segmentation.watershed(-distance, markers, mask=foreground)
    predictions: list[PredictedNucleus] = []
    width = image.shape[1]
    for region in measure.regionprops(labels):
        if region.area < minimum_pixels:
            continue
        ymin, xmin, ymax, xmax = region.bbox
        row, column = region.centroid
        coordinates = region.coords
        flat_pixels = coordinates[:, 0] * width + coordinates[:, 1]
        predictions.append(
            PredictedNucleus(
                instance_id=len(predictions) + 1,
                center_x=float(column),
                center_y=float(row),
                xmin=int(xmin),
                ymin=int(ymin),
                xmax=int(xmax),
                ymax=int(ymax),
                flat_pixels=np.asarray(flat_pixels, dtype=np.int64),
            )
        )
    return predictions


class ClassPrior:
    adapter_id: Literal["class-prior-v1"] = "class-prior-v1"

    def __init__(self, classes: tuple[str, ...]) -> None:
        self.classes = classes
        self._probabilities = np.full(len(classes), 1 / len(classes), dtype=np.float64)

    def fit(self, data_root: Path, items: list[SplitItem]) -> None:
        counts = dict.fromkeys(self.classes, 1)
        for item in items:
            annotations = load_annotations(data_root / item.annotation_path)
            for annotation in annotations:
                if annotation.class_name in counts:
                    counts[annotation.class_name] += 1
        values = np.asarray([counts[label] for label in self.classes], dtype=np.float64)
        self._probabilities = values / values.sum()

    def probabilities(
        self, image: NDArray[np.uint8], predictions: list[PredictedNucleus]
    ) -> FloatArray:
        del image
        return np.tile(self._probabilities, (len(predictions), 1))


class MorphologyLogistic:
    adapter_id: Literal["morphology-logistic-v1"] = "morphology-logistic-v1"

    def __init__(self, classes: tuple[str, ...], random_seed: int) -> None:
        self.classes = classes
        self._model = Pipeline(
            [
                ("scale", StandardScaler()),
                (
                    "classifier",
                    LogisticRegression(
                        class_weight="balanced",
                        max_iter=400,
                        random_state=random_seed,
                    ),
                ),
            ],
            memory=None,
        )

    def fit(self, data_root: Path, items: list[SplitItem]) -> None:
        features: list[FloatArray] = []
        labels: list[str] = []
        supported = set(self.classes)
        for item in items:
            image = load_rgb(data_root / item.image_path)
            for annotation in load_annotations(data_root / item.annotation_path):
                if annotation.class_name not in supported:
                    continue
                features.append(
                    _feature_vector(
                        image,
                        (annotation.xmin, annotation.ymin, annotation.xmax, annotation.ymax),
                    )
                )
                labels.append(annotation.class_name)
        if set(labels) != supported:
            raise ValueError("training cohort does not contain every classification label")
        self._model.fit(np.vstack(features), labels)

    def probabilities(
        self, image: NDArray[np.uint8], predictions: list[PredictedNucleus]
    ) -> FloatArray:
        if not predictions:
            return np.empty((0, len(self.classes)), dtype=np.float64)
        features = np.vstack(
            [_feature_vector(image, prediction.bbox) for prediction in predictions]
        )
        probabilities = self._model.predict_proba(features)
        fitted_classes = tuple(str(value) for value in self._model.classes_)
        indices = [fitted_classes.index(label) for label in self.classes]
        return np.asarray(probabilities[:, indices], dtype=np.float64)


type Classifier = ClassPrior | MorphologyLogistic


def annotation_bbox(annotation: Annotation) -> tuple[int, int, int, int]:
    return annotation.xmin, annotation.ymin, annotation.xmax, annotation.ymax
