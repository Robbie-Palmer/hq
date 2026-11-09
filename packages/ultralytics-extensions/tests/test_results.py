from __future__ import annotations

import numpy as np
import torch

from ultralytics_extensions.results import normalize_result


class Boxes:
    def __init__(self, class_index: float = 1.0) -> None:
        self.xyxy = torch.tensor([[10.0, 20.0, 30.0, 40.0]])
        self.conf = torch.tensor([0.9])
        self.cls = torch.tensor([class_index])


class Masks:
    def __init__(self) -> None:
        self.xy = [np.asarray([[10.0, 20.0], [30.0, 20.0], [30.0, 40.0]])]


class Result:
    def __init__(self, class_index: float = 1.0) -> None:
        self.orig_shape = (80, 100)
        self.boxes = Boxes(class_index)
        self.masks = Masks()


def test_normalize_result_emits_neutral_instances() -> None:
    width, height, predictions, rejections = normalize_result(
        Result(), "segment", ["background", "nucleus"]
    )
    assert (width, height) == (100, 80)
    assert not rejections
    assert predictions[0].class_name == "nucleus"
    assert predictions[0].polygon_xy_pixels is not None


def test_normalize_result_rejects_unknown_class() -> None:
    _, _, predictions, rejections = normalize_result(Result(3.0), "detect", ["nucleus"])
    assert not predictions
    assert rejections[0]["reason"] == "class_index_out_of_source_ontology"
