from __future__ import annotations

import shutil
import textwrap
from collections import Counter
from pathlib import Path
from typing import Any

from data_artifacts.files import load_model, sha256_file, write_json

from .contracts import (
    AcquisitionEvidence,
    ClassificationRunEvidence,
    DatasetManifest,
    Experiment,
    ExperimentEvidence,
    GateEvidence,
    MorphologyEvidence,
    RunEvidence,
)
from .data import build_cohort, load_dataset_manifest
from .evaluation import evaluate_adapter
from .methods import ClassPrior, MorphologyLogistic

FOUR_COLUMN_TABLE_ALIGNMENT = "| --- | ---: | ---: | ---: |"


def _load_experiment(path: Path) -> Experiment:
    return load_model(path, Experiment)


def _project_root(experiment_path: Path) -> Path:
    return experiment_path.resolve().parent.parent


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


def _classification_run(run: RunEvidence) -> ClassificationRunEvidence:
    return ClassificationRunEvidence(
        adapter_id=run.adapter_id,
        classification=run.classification,
        per_class=run.per_class,
        site_slices={site: tasks.classification for site, tasks in run.site_slices.items()},
        exclusions=run.exclusions,
        failures=run.failures,
        resources=run.resources,
    )


def _comparison_gates(
    experiment: Experiment,
    baseline: ClassificationRunEvidence,
    candidate: ClassificationRunEvidence,
) -> list[GateEvidence]:
    macro_delta = candidate.classification.macro_f1 - baseline.classification.macro_f1
    gates = [
        _gate(
            "classification_macro_f1_gain",
            macro_delta >= experiment.classification_minimum_gain,
            macro_delta,
            experiment.classification_minimum_gain,
            "Candidate minus baseline on localized, class-supported test nuclei.",
        ),
        _gate(
            "classification_brier_no_regression",
            candidate.classification.brier <= baseline.classification.brier + 1e-12,
            candidate.classification.brier - baseline.classification.brier,
            0.0,
            "Multiclass Brier change must be no greater than zero.",
        ),
        _gate(
            "classification_ece_no_regression",
            candidate.classification.ece_10_bin <= baseline.classification.ece_10_bin + 1e-12,
            candidate.classification.ece_10_bin - baseline.classification.ece_10_bin,
            0.0,
            "Ten-bin expected calibration error change must be no greater than zero.",
        ),
    ]
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
        site_change = candidate_slice.macro_f1 - baseline_slice.macro_f1
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
    evidence = load_model(path, AcquisitionEvidence)
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
    baseline_pipeline = evaluate_adapter(
        experiment,
        data_root,
        output_root,
        ClassPrior(classes),
        train_items,
        test_items,
    )
    candidate_pipeline = evaluate_adapter(
        experiment,
        data_root,
        output_root,
        MorphologyLogistic(classes, experiment.random_seed),
        train_items,
        test_items,
    )
    if baseline_pipeline.localization != candidate_pipeline.localization:
        raise ValueError("classification adapters produced different localization evidence")
    if baseline_pipeline.instance_segmentation != candidate_pipeline.instance_segmentation:
        raise ValueError("classification adapters produced different segmentation evidence")
    baseline_morphology_slices = {
        site: MorphologyEvidence(
            localization=tasks.localization,
            instance_segmentation=tasks.instance_segmentation,
        )
        for site, tasks in baseline_pipeline.site_slices.items()
    }
    candidate_morphology_slices = {
        site: MorphologyEvidence(
            localization=tasks.localization,
            instance_segmentation=tasks.instance_segmentation,
        )
        for site, tasks in candidate_pipeline.site_slices.items()
    }
    if baseline_morphology_slices != candidate_morphology_slices:
        raise ValueError("classification adapters produced different site morphology evidence")
    baseline = _classification_run(baseline_pipeline)
    candidate = _classification_run(candidate_pipeline)
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
        schema_version="1.1.0",
        experiment_id=experiment.experiment_id,
        dataset={
            "dataset_id": manifest.dataset_id,
            "title": manifest.title,
            "doi": manifest.doi,
            "paper_doi": manifest.paper_doi,
            "license": manifest.license.model_dump(mode="json"),
            "publisher_record": str(manifest.publisher_record),
            "acquisition_evidence": acquisition_path.relative_to(root).as_posix(),
            "acquisition_sha256": sha256_file(acquisition_path),
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
            "cohort_sha256": sha256_file(cohort_path),
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
            "localization": (
                "Every point, rectangle, or polygon annotation contributes one centroid target. "
                "Predicted watershed centroids are matched one-to-one within the declared pixel "
                "tolerance. No boundary is required for this task."
            ),
            "instance_segmentation": (
                "Pixel overlap is a separate conditional task using only source polygon "
                "annotations that were first localized within tolerance. Point and rectangle "
                "annotations are excluded because they do not define a nucleus boundary."
            ),
            "baseline": "Training-cohort source-class prevalence as a constant probability vector.",
            "candidate": (
                "Balanced multinomial logistic regression over bounding-box size, aspect, RGB, "
                "and optical-density summary features."
            ),
            "localization_match": (
                "One-to-one centroid assignment within "
                f"{experiment.localization_tolerance_pixels} pixels."
            ),
            "classification_scope": (
                "Probabilistic three-class prediction only for localized nuclei with one of "
                "the source's supported biological super-classes."
            ),
            "accelerator_decision": (
                "CPU only. Thresholding, watershed, and logistic regression do not justify GPU "
                "inference overhead."
            ),
        },
        localization=baseline_pipeline.localization,
        instance_segmentation=baseline_pipeline.instance_segmentation,
        morphology_site_slices=baseline_morphology_slices,
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
    classification_metrics = (
        ("Macro F1", baseline.classification.macro_f1, candidate.classification.macro_f1),
        ("Multiclass Brier", baseline.classification.brier, candidate.classification.brier),
        ("ECE, 10 bins", baseline.classification.ece_10_bin, candidate.classification.ece_10_bin),
        (
            "Negative log likelihood",
            baseline.classification.negative_log_likelihood,
            candidate.classification.negative_log_likelihood,
        ),
    )
    metric_rows = "\n".join(
        f"| {name} | {_format_number(baseline_value)} | {_format_number(candidate_value)} |"
        for name, baseline_value, candidate_value in classification_metrics
    )
    class_rows = "\n".join(
        f"| `{label}` | {_format_number(baseline.per_class[label]['f1'])} | "
        f"{_format_number(candidate.per_class[label]['f1'])} | "
        f"{_format_number(candidate.per_class[label]['support'])} |"
        for label in baseline.per_class
    )
    site_rows = "\n".join(
        f"| `{site}` | {_format_number(values.macro_f1)} | "
        f"{_format_number(candidate.site_slices[site].macro_f1)} | "
        f"{_format_number(candidate.site_slices[site].evaluated_instances)} |"
        for site, values in baseline.site_slices.items()
    )
    morphology_site_rows = "\n".join(
        f"| `{site}` | {_format_number(values.localization.f1)} | "
        f"{_format_number(values.instance_segmentation.localization_coverage)} | "
        f"{_format_number(values.instance_segmentation.mean_instance_iou)} |"
        for site, values in evidence.morphology_site_slices.items()
    )
    failed = [gate for gate in evidence.gates if not gate.passed]
    gate_lines = [f"- `{gate.gate}`: {gate.detail}" for gate in failed] if failed else ["- None."]
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
        "## Nucleus localization",
        "",
        "Every source annotation contributes one centroid target. Localization does not require "
        "a polygon or assume that a rectangle is a nucleus boundary.",
        "",
        "| Metric | Shared morphology method |",
        "| --- | ---: |",
        f"| Match tolerance | {evidence.localization.match_tolerance_pixels:.1f} pixels |",
        f"| Precision | {_format_number(evidence.localization.precision)} |",
        f"| Recall | {_format_number(evidence.localization.recall)} |",
        f"| F1 | {_format_number(evidence.localization.f1)} |",
        f"| Source centroids | {_format_number(evidence.localization.truth_points)} |",
        f"| Predicted centroids | {_format_number(evidence.localization.predicted_points)} |",
        f"| Matched centroids | {_format_number(evidence.localization.matched_points)} |",
        "",
        "## Instance segmentation",
        "",
        "This is conditional on successful localization and uses only source polygons. Point and "
        "rectangle annotations are not segmentation ground truth.",
        "",
        "| Metric | Shared morphology method |",
        "| --- | ---: |",
        "| Eligible source polygons | "
        f"{_format_number(evidence.instance_segmentation.eligible_polygon_instances)} |",
        "| Localized source polygons | "
        f"{_format_number(evidence.instance_segmentation.localized_polygon_instances)} |",
        "| Localization coverage | "
        f"{_format_number(evidence.instance_segmentation.localization_coverage)} |",
        "| Mean instance IoU | "
        f"{_format_number(evidence.instance_segmentation.mean_instance_iou)} |",
        "| Mean instance Dice | "
        f"{_format_number(evidence.instance_segmentation.mean_instance_dice)} |",
        "| Success at IoU 0.5 | "
        f"{_format_number(evidence.instance_segmentation.success_at_iou_0_5)} |",
        "",
        "## Classification",
        "",
        "Classification is conditional on a localized nucleus with a supported source class and "
        "is evaluated from class probabilities.",
        "",
        "| Metric | Class-prior baseline | Morphology logistic candidate |",
        "| --- | ---: | ---: |",
        metric_rows,
        "",
        "## Per-class classification",
        "",
        "| Source super-class | Baseline F1 | Candidate F1 | Test support |",
        FOUR_COLUMN_TABLE_ALIGNMENT,
        class_rows,
        "",
        "## Held-out site slices",
        "",
        "The `site` field is the TCGA tissue-source-site code in the NuCLS split files. "
        "The published files used here have no scanner metadata.",
        "",
        "| Site | Localization F1 | Polygon localization coverage | Mean instance IoU |",
        FOUR_COLUMN_TABLE_ALIGNMENT,
        morphology_site_rows,
        "",
        "| Site | Baseline macro F1 | Candidate macro F1 | Evaluated nuclei |",
        FOUR_COLUMN_TABLE_ALIGNMENT,
        site_rows,
        "",
        "## Failed gates",
        "",
        *gate_lines,
        "",
        "## Scope and exclusions",
        "",
        "- Localization reduces every published point, rectangle, or polygon annotation to one "
        "centroid and scores one-to-one matches within tolerance.",
        "- Instance segmentation is conditional on localization and uses only source annotations "
        "marked `polyline`; rectangles and points are not converted into masks.",
        "- Shape and size are not inferred from point or rectangle annotations. The source schema "
        "used here has no focal-plane or shadow-nucleus label, so those effects are not scored as "
        "a separate task.",
        "- Unmatched predictions count against localization precision relative to the published "
        "single-rater annotations; they are not evidence that a nucleus is biologically absent.",
        "- Classification uses localized nuclei labeled `nonTIL_stromal`, `sTIL`, or "
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
    evidence = load_model(evidence_path, ExperimentEvidence)
    json_output.parent.mkdir(parents=True, exist_ok=True)
    markdown_output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(evidence_path, json_output)
    markdown_output.write_text(_markdown(evidence), encoding="utf-8")
    return {
        "json": json_output.as_posix(),
        "markdown": markdown_output.as_posix(),
        "evidence_sha256": sha256_file(evidence_path),
        "recommendation": evidence.recommendation,
    }
