from __future__ import annotations


def bbox_to_yolo(
    bbox: tuple[float, float, float, float], image_size: tuple[int, int]
) -> tuple[float, float, float, float]:
    xmin, ymin, xmax, ymax = bbox
    width, height = image_size
    if width <= 0 or height <= 0:
        raise ValueError("image dimensions must be positive")
    if xmin < 0 or ymin < 0 or xmax > width or ymax > height:
        raise ValueError("bounding box falls outside the image")
    if xmax <= xmin or ymax <= ymin:
        raise ValueError("bounding box must have positive area")
    return (
        (xmin + xmax) / (2 * width),
        (ymin + ymax) / (2 * height),
        (xmax - xmin) / width,
        (ymax - ymin) / height,
    )


def yolo_to_bbox(
    normalized: tuple[float, float, float, float], image_size: tuple[int, int]
) -> tuple[float, float, float, float]:
    center_x, center_y, box_width, box_height = normalized
    width, height = image_size
    return (
        (center_x - box_width / 2) * width,
        (center_y - box_height / 2) * height,
        (center_x + box_width / 2) * width,
        (center_y + box_height / 2) * height,
    )


def polygon_to_yolo(
    coordinates: tuple[tuple[float, float], ...], image_size: tuple[int, int]
) -> tuple[float, ...]:
    width, height = image_size
    if width <= 0 or height <= 0:
        raise ValueError("image dimensions must be positive")
    points = (
        coordinates[:-1]
        if len(coordinates) > 1 and coordinates[0] == coordinates[-1]
        else coordinates
    )
    if len(set(points)) < 3:
        raise ValueError("segmentation polygon must contain three unique points")
    values: list[float] = []
    for x, y in points:
        if x < 0 or y < 0 or x > width or y > height:
            raise ValueError("segmentation polygon falls outside the image")
        values.extend((x / width, y / height))
    return tuple(values)


def yolo_to_polygon(
    normalized: tuple[float, ...], image_size: tuple[int, int]
) -> tuple[tuple[float, float], ...]:
    if len(normalized) < 6 or len(normalized) % 2:
        raise ValueError("normalized polygon must contain at least three points")
    width, height = image_size
    return tuple(
        (normalized[index] * width, normalized[index + 1] * height)
        for index in range(0, len(normalized), 2)
    )
