from python.punctuation_runtime import document_segments, strip_marks_with_boundaries


def test_strip_marks_preserves_numeric_separators_and_source_boundaries() -> None:
    source = "Cost 1,000.50, then stop."

    cleaned, boundaries = strip_marks_with_boundaries(source)

    assert cleaned == "Cost 1,000.50 then stop"
    word_end = cleaned.index(" then")
    assert source[boundaries[word_end]] == ","


def test_markdown_segments_exclude_structure_and_inline_markup() -> None:
    source = (
        "---\ntitle: Test\n---\n\n"
        "# Heading\n\n"
        "Plain prose belongs here.\n"
        "Still the same paragraph.\n\n"
        "A line with `code` is excluded.\n\n"
        "```text\nnot prose\n```\n"
    )

    segments = document_segments(source)

    assert len(segments) == 1
    assert source[segments[0].start : segments[0].end] == (
        "Plain prose belongs here.\nStill the same paragraph."
    )


def test_markdown_segments_handle_lists_templates_and_indented_blocks() -> None:
    source = (
        "Intro prose.\n\n"
        "- List prose starts here.\n"
        "  It continues here.\n\n"
        "const example = `\n"
        "template content is excluded\n"
        "`;\n\n"
        "    indented code is excluded\n\n"
        "Closing prose.\n"
    )

    segments = document_segments(source)
    segment_text = [source[segment.start : segment.end] for segment in segments]

    assert segment_text == [
        "Intro prose.",
        "List prose starts here.\n  It continues here.",
        "Closing prose.",
    ]
