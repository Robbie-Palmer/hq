from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from numpy.typing import NDArray
from sklearn.metrics import precision_recall_fscore_support

from .contracts import ClassificationMetrics

FloatArray = NDArray[np.float64]


@dataclass
class ClassificationRecords:
    truth: list[int] = field(default_factory=list)
    probabilities: list[FloatArray] = field(default_factory=list)


def validate_probabilities(
    probabilities: FloatArray, prediction_count: int, class_count: int
) -> None:
    if probabilities.shape != (prediction_count, class_count):
        raise ValueError("classifier probability matrix has the wrong shape")
    if not np.allclose(probabilities.sum(axis=1), 1.0):
        raise ValueError("classification probabilities do not sum to one")


def update_classification_records(
    records: ClassificationRecords,
    truth_labels: list[str],
    probabilities: FloatArray,
    matches: list[tuple[int, int]],
    classes: tuple[str, ...],
) -> list[str]:
    class_index = {label: index for index, label in enumerate(classes)}
    exclusions: list[str] = []
    for truth_index, predicted_index in matches:
        label = truth_labels[truth_index]
        if label not in class_index:
            exclusions.append(label)
            continue
        records.truth.append(class_index[label])
        records.probabilities.append(probabilities[predicted_index])
    return exclusions


def _calibration(truth: NDArray[np.int64], probabilities: FloatArray) -> tuple[float, float, float]:
    targets = np.eye(probabilities.shape[1], dtype=np.float64)[truth]
    brier = float(np.mean(np.sum((probabilities - targets) ** 2, axis=1)))
    confidence = probabilities.max(axis=1)
    predicted = probabilities.argmax(axis=1)
    correct = predicted == truth
    ece = 0.0
    for lower in np.linspace(0.0, 0.9, 10):
        upper = lower + 0.1
        selected = (confidence > lower) & (confidence <= upper)
        if selected.any():
            ece += float(selected.mean()) * abs(
                float(correct[selected].mean()) - float(confidence[selected].mean())
            )
    selected_probability = probabilities[np.arange(len(truth)), truth]
    negative_log_likelihood = float(-np.log(np.clip(selected_probability, 1e-12, 1)).mean())
    return brier, ece, negative_log_likelihood


def classification_metrics(
    records: ClassificationRecords, classes: tuple[str, ...]
) -> tuple[ClassificationMetrics, dict[str, dict[str, float | int]]]:
    if not records.truth:
        per_class = {
            label: {"precision": 0.0, "recall": 0.0, "f1": 0.0, "support": 0, "brier": 0.0}
            for label in classes
        }
        return ClassificationMetrics(
            evaluated_instances=0,
            macro_f1=0.0,
            brier=0.0,
            ece_10_bin=0.0,
            negative_log_likelihood=0.0,
        ), per_class
    truth = np.asarray(records.truth, dtype=np.int64)
    probabilities = np.vstack(records.probabilities)
    predicted = probabilities.argmax(axis=1)
    precision, recall, f1, support = precision_recall_fscore_support(
        truth,
        predicted,
        labels=np.arange(len(classes)),
        zero_division=0,
    )
    brier, ece, negative_log_likelihood = _calibration(truth, probabilities)
    per_class = {
        label: {
            "precision": float(precision[index]),
            "recall": float(recall[index]),
            "f1": float(f1[index]),
            "support": int(support[index]),
            "brier": float(np.mean((probabilities[:, index] - (truth == index)) ** 2)),
        }
        for index, label in enumerate(classes)
    }
    return ClassificationMetrics(
        evaluated_instances=len(truth),
        macro_f1=float(np.mean(f1)),
        brier=brier,
        ece_10_bin=ece,
        negative_log_likelihood=negative_log_likelihood,
    ), per_class
