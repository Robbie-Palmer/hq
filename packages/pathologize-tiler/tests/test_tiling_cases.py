from pathlib import Path

from PIL import Image

type PyramidCase = tuple[Path, dict[int, int], tuple[int, int]]


def pyramid_single_tile(tmp_path: Path) -> PyramidCase:
    source = tmp_path / "native"
    source.mkdir()
    Image.new("RGBA", (2, 2), "red").save(source / "0_0.png")
    return source, {0: 1}, (2, 2)


def pyramid_sparse_grid(tmp_path: Path) -> PyramidCase:
    source = tmp_path / "native"
    source.mkdir()
    for coordinate, colour in (("0_0", "red"), ("2_0", "green"), ("0_2", "blue")):
        Image.new("RGBA", (2, 2), colour).save(source / f"{coordinate}.png")
    return source, {0: 1, 1: 3}, (2, 2)


def pyramid_rectangular_vendor_tiles(tmp_path: Path) -> PyramidCase:
    source = tmp_path / "native"
    source.mkdir()
    for coordinate, colour in (("0_0", "red"), ("4_0", "green"), ("0_2", "blue")):
        Image.new("RGBA", (4, 2), colour).save(source / f"{coordinate}.png")
    return source, {0: 1, 1: 3}, (4, 2)
