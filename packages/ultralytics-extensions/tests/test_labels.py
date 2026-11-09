from __future__ import annotations

import pytest

from ultralytics_extensions.labels import (
    bbox_to_yolo,
    polygon_to_yolo,
    yolo_to_bbox,
    yolo_to_polygon,
)


def test_coordinate_round_trips_preserve_pixels() -> None:
    image_size = (100, 80)
    bbox = (10.0, 20.0, 30.0, 40.0)
    assert yolo_to_bbox(bbox_to_yolo(bbox, image_size), image_size) == pytest.approx(bbox)
    polygon = ((10.0, 20.0), (30.0, 20.0), (30.0, 40.0), (10.0, 40.0))
    observed = yolo_to_polygon(polygon_to_yolo(polygon, image_size), image_size)
    for actual, expected in zip(observed, polygon, strict=True):
        assert actual == pytest.approx(expected)


def test_invalid_geometry_is_rejected() -> None:
    with pytest.raises(ValueError, match="positive area"):
        bbox_to_yolo((10.0, 10.0, 10.0, 10.0), (100, 100))
    with pytest.raises(ValueError, match="three unique points"):
        polygon_to_yolo(((1.0, 1.0), (2.0, 2.0), (1.0, 1.0)), (100, 100))
