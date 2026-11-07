from __future__ import annotations

import hashlib
import shutil
import textwrap
from collections import Counter
from pathlib import Path
from typing import Any

from .contracts import (
    AcquisitionEvidence,
    DatasetManifest,
    Experiment,
    ExperimentEvidence,
    GateEvidence,
)
from .data import (
    build_cohort,
    load_dataset_manifest,
    read_json,
    write_json,
)
from .evaluation import evaluate_adapter
from .methods import ClassPrior, MorphologyLogistic


def _load_experiment(path: Path) -> Experiment:
    return Experiment.model_validate(read_json(path))


def _project_root(experiment_path: Path) -> Path:
    return experiment_path.resolve().parent.parent


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _gate(
    name: str,
    passed: bool,
    observed: float | None,
    threshold: float,
    detail: str,
) -> GateEvidence:
    return GateEvidence(
        gate=name,
        passed=passed,
        observed=observed,
        threshold=threshold,
        detail=detail,
    )


def _comparison_gates(experiment: Experiment, baseline: Any, candidate: Any) -> list[GateEvidence]:
    baseline_metrics = baseline.metrics
    candidate_metrics = candidate.metrics
    macro_delta = float(candidate_metrics["classification_macro_f1"]) - float(
        baseline_metrics["classification_macro_f1"]
    )
    gates = [
        _gate(
            "classification_macro_f1_gain",
            macro_delta >= experiment.classification_minimum_gain,
            macro_delta,
            experiment.classification_minimum_gain,
            "Candidate minus baseline on matched, class-supported test nuclei.",
        ),
        _gate(
            "classification_brier_no_regression",
            float(candidate_metrics["classification_brier"])
            <= float(baseline_metrics["classification_brier"]) + 1e-12,
            float(candidate_metrics["classification_brier"])
            - float(baseline_metrics["classification_brier"]),
            0.0,
            "Multiclass Brier change must be no greater than zero.",
        ),
        _gate(
            "classification_ece_no_regression",
            float(candidate_metrics["classification_ece_10_bin"])
            <= float(baseline_metrics["classification_ece_10_bin"]) + 1e-12,
            float(candidate_metrics["classification_ece_10_bin"])
            - float(baseline_metrics["classification_ece_10_bin"]),
            0.0,
            "Ten-bin expected calibration error change must be no greater than zero.",
        ),
    ]
    for metric in (
        "detection_f1",
        "segmentation_mean_instance_iou",
        "segmentation_mean_instance_dice",
    ):
        change = float(candidate_metrics[metric]) - float(baseline_metrics[metric])
        gates.append(
            _gate(
                f"{metric}_no_regression",
                change >= -1e-12,
                change,
                0.0,
                "Both adapters use the same fixed detection and segmentation method.",
            )
        )
    rare_class = min(
        baseline.per_class,
        key=lambda label: int(baseline.per_class[label]["support"]),
    )
    rare_change = float(candidate.per_class[rare_class]["f1"]) - float(
        baseline.per_class[rare_class]["f1"]
    )
    gates.append(
        _gate(
            f"rare_class_{rare_class}_f1_no_regression",
            rare_change >= -1e-12,
            rare_change,
            0.0,
            "The least-supported evaluated source class cannot regress.",
        )
    )
    for site, baseline_slice in baseline.site_slices.items():
        candidate_slice = candidate.site_slices[site]
        site_change = float(candidate_slice["classification_macro_f1"]) - float(
            baseline_slice["classification_macro_f1"]
        )
        gates.append(
            _gate(
                f"held_out_site_{site}_macro_f1_no_regression",
                site_change >= -1e-12,
                site_change,
                0.0,
                "Each test-site slice must avoid a classification macro-F1 regression.",
            )
        )
    gates.extend(
        [
            _gate(
                "baseline_failures",
                not baseline.failures,
                float(len(baseline.failures)),
                0.0,
                "The baseline must finish every selected field of view.",
            ),
            _gate(
                "candidate_failures",
                not candidate.failures,
                float(len(candidate.failures)),
                0.0,
                "The candidate must finish every selected field of view.",
            ),
            _gate(
                "aggregate_gpu_budget",
                baseline.resources.gpu_seconds + candidate.resources.gpu_seconds
                <= experiment.aggregate_accelerator_seconds,
                float(baseline.resources.gpu_seconds + candidate.resources.gpu_seconds),
                float(experiment.aggregate_accelerator_seconds),
                "No GPU was used because neither method justifies accelerator inference.",
            ),
            _gate(
                "per_run_wall_budget",
                max(baseline.resources.wall_seconds, candidate.resources.wall_seconds)
                <= experiment.per_run_wall_seconds,
                max(baseline.resources.wall_seconds, candidate.resources.wall_seconds),
                float(experiment.per_run_wall_seconds),
                "Each adapter has an independent 30-minute wall-time ceiling.",
            ),
        ]
    )
    return gates


def _ontology_counts(data_root: Path, items: list[Any]) -> dict[str, int]:
    from .data import load_annotations

    counts: Counter[str] = Counter()
    for item in items:
        for annotation in load_annotations(data_root / item.annotation_path):
            counts[annotation.class_name] += 1
    return dict(sorted(counts.items()))


def _validate_acquisition(path: Path, manifest: DatasetManifest) -> AcquisitionEvidence:
    evidence = AcquisitionEvidence.model_validate(read_json(path))
    if evidence.dataset_id != manifest.dataset_id:
        raise ValueError("acquisition dataset ID differs from the source manifest")
    expected = {archive.name: archive for archive in manifest.archives}
    observed = {archive.name: archive for archive in evidence.archives}
    if set(observed) != set(expected):
        raise ValueError("acquisition archives differ from the source manifest")
    for name, archive in expected.items():
        acquired = observed[name]
        if (
            acquired.bytes != archive.bytes
            or acquired.md5 != archive.md5
            or acquired.sha256 != archive.sha256
            or acquired.url != str(archive.url)
        ):
            raise ValueError(f"acquisition evidence differs for {name}")
    return evidence


def run(experiment_path: Path) -> dict[str, Any]:
    experiment = _load_experiment(experiment_path)
    root = _project_root(experiment_path)
    manifest_path = root / experiment.dataset_manifest
    manifest = load_dataset_manifest(manifest_path)
    data_root = root / experiment.data_directory
    output_root = root / experiment.output_directory
    acquisition_path = data_root / "acquisition.json"
    if not acquisition_path.is_file():
        raise FileNotFoundError("NuCLS acquisition evidence is missing")
    _validate_acquisition(acquisition_path, manifest)
    if output_root.exists():
        raise FileExistsError(f"experiment output already exists: {output_root}")
    output_root.mkdir(parents=True)
    cohort = build_cohort(data_root, experiment.test_fold, experiment.validation_fold)
    cohort_path = output_root / "cohort.json"
    write_json(cohort_path, cohort)
    train_items = [item for item in cohort.items if item.split == "train"]
    test_items = [item for item in cohort.items if item.split == "test"]
    classes = tuple(manifest.classification_labels)
    baseline = evaluate_adapter(
        experiment,
        data_root,
        output_root,
        ClassPrior(classes),
        train_items,
        test_items,
    )
    candidate = evaluate_adapter(
        experiment,
        data_root,
        output_root,
        MorphologyLogistic(classes, experiment.random_seed),
        train_items,
        test_items,
    )
    gates = _comparison_gates(experiment, baseline, candidate)
    passed = all(gate.passed for gate in gates)
    recommendation = "promote_candidate" if passed else "reject_candidate"
    stop_reason = (
        "The candidate passed every decision and guardrail gate. The bounded search ends after "
        "one locally runnable candidate."
        if passed
        else "The candidate failed one or more decision or guardrail gates. The bounded search "
        "stops after this single locally runnable candidate."
    )
    evidence = ExperimentEvidence(
        schema_version="1.0.0",
        experiment_id=experiment.experiment_id,
        dataset={
            "dataset_id": manifest.dataset_id,
            "title": manifest.title,
            "doi": manifest.doi,
            "paper_doi": manifest.paper_doi,
            "license": manifest.license.model_dump(mode="json"),
            "publisher_record": str(manifest.publisher_record),
            "acquisition_evidence": acquisition_path.relative_to(root).as_posix(),
            "acquisition_sha256": _sha256(acquisition_path),
        },
        ontology={
            "classification_field": manifest.classification_field,
            "evaluated_labels": manifest.classification_labels,
            "unmappable_categories": manifest.unmappable_categories,
            "test_source_counts": _ontology_counts(data_root, test_items),
            "mapping_performed": False,
        },
        split={
            "policy": (
                f"Official fold {experiment.test_fold} test slides are test; official fold "
                f"{experiment.validation_fold} test slides are validation; the remaining fold "
                f"{experiment.test_fold} training slides are train."
            ),
            "cohort_artifact": cohort_path.relative_to(root).as_posix(),
            "cohort_sha256": _sha256(cohort_path),
            "item_counts": cohort.item_counts,
            "patient_counts": cohort.patient_counts,
            "slide_counts": cohort.slide_counts,
            "patient_intersections": cohort.patient_intersections,
            "slide_intersections": cohort.slide_intersections,
            "site_intersections": cohort.site_intersections,
            "held_out_test_sites": cohort.held_out_test_sites,
            "site_item_counts": cohort.site_counts,
        },
        methods={
            "shared_detection_and_segmentation": (
                "Hematoxylin optical-density thresholding, small-object filtering, distance "
                "transform, local maxima, and marker-controlled watershed."
            ),
            "baseline": "Training-cohort source-class prevalence as a constant probability vector.",
            "candidate": (
                "Balanced multinomial logistic regression over bounding-box size, aspect, RGB, "
                "and optical-density summary features."
            ),
            "detection_match": (
                "One-to-one centroid assignment within "
                f"{experiment.detection_radius_pixels} pixels."
            ),
            "segmentation_scope": (
                "Instance IoU and Dice only for source annotations marked polyline and matched "
                "by the detection rule. Rectangle-only annotations are not treated as masks."
            ),
            "classification_scope": (
                "Probabilistic three-class prediction only for matched detections with one of "
                "the source's supported biological super-classes."
            ),
            "accelerator_decision": (
                "CPU only. Thresholding, watershed, and logistic regression do not justify GPU "
                "inference overhead."
            ),
        },
        baseline=baseline,
        candidate=candidate,
        gates=gates,
        recommendation=recommendation,
        stop_reason=stop_reason,
        clinical_validity=False,
    )
    write_json(output_root / "evidence.json", evidence)
    return evidence.model_dump(mode="json")


def _format_number(value: float | int) -> str:
    if isinstance(value, int):
        return f"{value:,}"
    return f"{value:.4f}"


def _markdown(evidence: ExperimentEvidence) -> str:
    baseline = evidence.baseline
    candidate = evidence.candidate
    metric_names = (
        "detection_f1",
        "segmentation_mean_instance_iou",
        "segmentation_mean_instance_dice",
        "classification_macro_f1",
        "classification_brier",
        "classification_ece_10_bin",
    )
    metric_rows = "\n".join(
        f"| `{name}` | {_format_number(baseline.metrics[name])} | "
        f"{_format_number(candidate.metrics[name])} |"
        for name in metric_names
    )
    class_rows = "\n".join(
        f"| `{label}` | {_format_number(baseline.per_class[label]['f1'])} | "
        f"{_format_number(candidate.per_class[label]['f1'])} | "
        f"{_format_number(candidate.per_class[label]['support'])} |"
        for label in baseline.per_class
    )
    site_rows = "\n".join(
        f"| `{site}` | {_format_number(values['classification_macro_f1'])} | "
        f"{_format_number(candidate.site_slices[site]['classification_macro_f1'])} | "
        f"{_format_number(candidate.site_slices[site]['classification_evaluated_instances'])} |"
        for site, values in baseline.site_slices.items()
    )
    failed = [gate for gate in evidence.gates if not gate.passed]
    gate_lines = (
        "\n".join(f"- `{gate.gate}`: {gate.detail}" for gate in failed) if failed else "- None."
    )
    exclusions = ", ".join(f"`{name}` {count:,}" for name, count in candidate.exclusions.items())
    lines = [
        "# NuCLS public nucleus baseline",
        "",
        "This is a bounded, non-clinical baseline on the corrected single-rater NuCLS "
        f"dataset. The source is GigaDB DOI `{evidence.dataset['doi']}` under CC0 1.0. "
        "The official slide folds have no patient or slide overlap among train, validation, "
        "and test.",
        "",
        "## Decision",
        "",
        f"`{evidence.recommendation}`. {evidence.stop_reason}",
        "",
        "## Aggregate results",
        "",
        "| Metric | Class-prior baseline | Morphology logistic candidate |",
        "| --- | ---: | ---: |",
        metric_rows,
        "",
        "## Per-class classification",
        "",
        "| Source super-class | Baseline F1 | Candidate F1 | Test support |",
        "| --- | ---: | ---: | ---: |",
        class_rows,
        "",
        "## Held-out site slices",
        "",
        "The `site` field is the TCGA tissue-source-site code in the NuCLS split files. "
        "The published files used here have no scanner metadata.",
        "",
        "| Site | Baseline macro F1 | Candidate macro F1 | Evaluated nuclei |",
        "| --- | ---: | ---: | ---: |",
        site_rows,
        "",
        "## Failed gates",
        "",
        gate_lines,
        "",
        "## Scope and exclusions",
        "",
        "- Detection uses every published nucleus annotation in the test fields.",
        "- Instance segmentation uses only source annotations marked `polyline`. "
        "Rectangle annotations are not converted into masks.",
        "- Classification uses matched detections labeled `nonTIL_stromal`, `sTIL`, or "
        "`tumor_any` and emits a probability for every supported class.",
        "- Unmappable matched categories were excluded without relabeling: "
        f"{exclusions or 'none'}.",
        "- The corrected single-rater tier has pathologist-supervised quality control. It "
        "is not the multi-rater inferred P-truth tier.",
        "- This experiment makes no clinical-validity claim.",
        "",
        "## Resources",
        "",
        "| Adapter | Wall time | CPU time | GPU time | Peak RSS | Peak VRAM |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
        f"| Class-prior baseline | {baseline.resources.wall_seconds:.2f} s | "
        f"{baseline.resources.cpu_seconds:.2f} s | 0 s | "
        f"{baseline.resources.peak_rss_bytes:,} bytes | 0 bytes |",
        f"| Morphology logistic candidate | {candidate.resources.wall_seconds:.2f} s | "
        f"{candidate.resources.cpu_seconds:.2f} s | 0 s | "
        f"{candidate.resources.peak_rss_bytes:,} bytes | 0 bytes |",
        "",
        f"Each adapter had a {baseline.resources.per_run_wall_ceiling_seconds}-second wall "
        "ceiling. The aggregate accelerator ceiling was "
        f"{baseline.resources.aggregate_gpu_ceiling_seconds} seconds. Neither method "
        "justified GPU inference, so the run used no GPU.",
        "",
    ]
    wrapped: list[str] = []
    for line in lines:
        if len(line) <= 120 or line.startswith("|"):
            wrapped.append(line)
            continue
        wrapped.extend(
            textwrap.wrap(
                line,
                width=100,
                subsequent_indent="  " if line.startswith("- ") else "",
                break_long_words=False,
                break_on_hyphens=False,
            )
        )
    return "\n".join(wrapped)


def report(experiment_path: Path, json_output: Path, markdown_output: Path) -> dict[str, Any]:
    experiment = _load_experiment(experiment_path)
    root = _project_root(experiment_path)
    evidence_path = root / experiment.output_directory / "evidence.json"
    evidence = ExperimentEvidence.model_validate(read_json(evidence_path))
    json_output.parent.mkdir(parents=True, exist_ok=True)
    markdown_output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(evidence_path, json_output)
    markdown_output.write_text(_markdown(evidence), encoding="utf-8")
    return {
        "json": json_output.as_posix(),
        "markdown": markdown_output.as_posix(),
        "evidence_sha256": _sha256(evidence_path),
        "recommendation": evidence.recommendation,
    }
