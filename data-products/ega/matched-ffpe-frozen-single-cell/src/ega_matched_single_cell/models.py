from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Self

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Dataset(StrictModel):
    accession_id: Literal["EGAD00001015781"]
    title: str = Field(min_length=1)
    description: str = Field(min_length=1)
    dataset_types: None
    technologies: list[Literal["Illumina NovaSeq 6000", "Illumina NovaSeq X Plus"]]
    num_samples: Literal[4]
    access_type: Literal["controlled"]
    is_in_beacon: Literal[False]
    is_released: Literal[True]
    released_date: datetime
    is_deprecated: Literal[False]
    policy_accession_id: Literal["EGAP00001000045"]


class Study(StrictModel):
    accession_id: Literal["EGAS00001001159"]
    title: str = Field(min_length=1)
    description: str = Field(min_length=1)
    abstract: str = Field(min_length=1)
    study_type: Literal["Cancer Genomics"]
    pubmed_ids: list[str] | None
    external_links: list[str] | None
    is_released: Literal[True]
    released_date: datetime
    is_deprecated: Literal[False]


class Contact(StrictModel):
    email: str = Field(pattern=r"^[^@]+@[^@]+$")
    is_main: bool
    surname: str | None
    first_name: str | None
    institution_name: str | None


class Dac(StrictModel):
    accession_id: Literal["EGAC00000000011"]
    title: str = Field(min_length=1)
    description: str = Field(min_length=1)
    url: None
    is_released: Literal[True]
    released_date: datetime
    is_deprecated: Literal[False]
    contacts: list[Contact] = Field(min_length=1)


class Policy(StrictModel):
    accession_id: Literal["EGAP00001000045"]
    title: str = Field(min_length=1)
    policy_text: str = Field(min_length=1)
    policy_url: None
    dac_accession_id: Literal["EGAC00000000011"]
    duos: list[Literal["DUO:0000025", "DUO:0000027"]]


class Sample(StrictModel):
    accession_id: str = Field(pattern=r"^EGAN\d{11}$")
    title: str = Field(min_length=1)
    description: str = Field(min_length=1)
    biological_sex: Literal["female", "male", "unknown"]
    subject_id: str | None
    phenotype: str = Field(min_length=1)


class Experiment(StrictModel):
    accession_id: str = Field(pattern=r"^EGAX\d{11}$")
    design_description: str = Field(min_length=1)
    library_name: str = Field(min_length=1)
    library_construction_protocol: Literal[
        "10X Genomics Chromium Single Cell Epi Multiome ATAC + Gene Expression",
        "10X Genomics Chromium Universal 3\u2019 Gene Expression",
    ]
    paired_nominal_length: int | None
    paired_nominal_sdev: float | None
    platform: Literal["ILLUMINA"]
    model: Literal["Illumina NovaSeq 6000", "Illumina NovaSeq X Plus"]
    library_layout: Literal["PAIRED"]
    library_strategy: Literal["ATAC-seq", "RNA-Seq"]
    library_source: Literal["GENOMIC SINGLE CELL", "TRANSCRIPTOMIC SINGLE CELL"]
    library_selection: Literal["cDNA", "RANDOM"]
    study_accession_id: Literal["EGAS00001001159"]


class Run(StrictModel):
    accession_id: str = Field(pattern=r"^EGAR\d{11}$")
    run_file_type: Literal["fastq"]
    sample_accession_id: str = Field(pattern=r"^EGAN\d{11}$")


class FileRecord(StrictModel):
    accession_id: str = Field(pattern=r"^EGAF\d{11}$")
    unencrypted_checksum: str = Field(pattern=r"^[a-f0-9]{32}$")
    unencrypted_checksum_type: Literal["MD5"]
    filesize: int = Field(gt=0)
    extension: Literal["fastq.gz"]
    has_report: Literal[False]
    locations: list[Literal["crg", "ebi"]]


class StableReference(StrictModel):
    reference_id: str = Field(min_length=1)
    role: Literal["dataset", "study", "policy", "dac", "paper", "supplement"]
    url: AnyHttpUrl
    locator: str = Field(min_length=1)


class AccessTier(StrictModel):
    tier: Literal["public_metadata", "approved_accessor_metadata", "controlled_payload"]
    contents: list[str] = Field(min_length=1)
    requirement: str = Field(min_length=1)


class DuoTerm(StrictModel):
    identifier: Literal["DUO:0000025", "DUO:0000027"]
    label: Literal["time limit on use", "project specific restriction"]


class SourceObjectRole(StrictModel):
    object_type: Literal[
        "dataset", "study", "policy", "dac", "sample", "experiment", "run", "file", "paper"
    ]
    publisher_role: str = Field(min_length=1)


class PortalContract(StrictModel):
    displayed_sample_count: Literal[4]
    file_count: Literal[241]
    displayed_total_size: Literal["965.8 GB"]
    total_bytes: Literal[965526724986]
    technologies: list[Literal["Illumina NovaSeq 6000", "Illumina NovaSeq X Plus"]]


class PaperCohort(StrictModel):
    patient_count: Literal[7]
    matched_pair_count: Literal[12]
    specimen_count: Literal[24]
    longitudinal_pair_sets: Literal[3]
    cancer_context: Literal["advanced or metastatic cancers"]
    pair_origin: Literal["same biopsy and surgical site"]
    pair_sampling: Literal["different tissue segments containing different cells"]
    frozen_preparations: list[Literal["fresh-frozen", "OCT-embedded frozen"]]
    ffpe_preparation: Literal["formalin-fixed paraffin-embedded"]
    age_range_years: list[float]
    anatomical_site_count: Literal[7]


class AssayFact(StrictModel):
    fact_id: str = Field(min_length=1)
    statement: str = Field(min_length=1)
    evidence_locator: str = Field(min_length=1)


class PublisherOutput(StrictModel):
    output_id: str = Field(min_length=1)
    domain: Literal["cell_recovery", "expression", "heterogeneity", "cna_inference"]
    statement: str = Field(min_length=1)
    evidence_locator: str = Field(min_length=1)


class PaperContract(StrictModel):
    doi: Literal["10.3389/fgene.2026.1755978"]
    publication_date: date
    article_license: Literal["CC-BY-4.0"]
    cohort: PaperCohort
    assay_facts: list[AssayFact] = Field(min_length=1)
    publisher_outputs: list[PublisherOutput] = Field(min_length=1)
    limitations: list[str] = Field(min_length=1)


class SourceContract(StrictModel):
    schema_version: Literal["1.0.0"]
    product_id: Literal["ega-egad00001015781-matched-ffpe-frozen-single-cell-v1"]
    snapshot_date: date
    stable_references: list[StableReference]
    portal: PortalContract
    access_tiers: list[AccessTier]
    duo_terms: list[DuoTerm]
    source_object_roles: list[SourceObjectRole]
    repository_payload_rights: Literal["no public redistribution license declared"]
    paper: PaperContract
    count_reconciliation: str = Field(min_length=1)
    absent_evidence: list[
        Literal[
            "public whole-slide images",
            "stain metadata",
            "scanner metadata",
            "operational cost evidence",
            "diagnostic-confidence evidence",
        ]
    ]
    mapping_boundary: str = Field(min_length=1)

    @model_validator(mode="after")
    def require_complete_boundary(self) -> Self:
        if self.snapshot_date != date(2026, 11, 11):
            raise ValueError("public metadata snapshot date changed")
        if self.paper.publication_date != date(2026, 3, 24):
            raise ValueError("paper publication date changed")
        tiers = {tier.tier for tier in self.access_tiers}
        if tiers != {"public_metadata", "approved_accessor_metadata", "controlled_payload"}:
            raise ValueError("all three EGA access tiers must be declared")
        if {term.identifier for term in self.duo_terms} != {"DUO:0000025", "DUO:0000027"}:
            raise ValueError("both publisher DUO restrictions must be declared")
        roles = {role.object_type for role in self.source_object_roles}
        if roles != {
            "dataset",
            "study",
            "policy",
            "dac",
            "sample",
            "experiment",
            "run",
            "file",
            "paper",
        }:
            raise ValueError("every publisher object role must be declared")
        domains = {output.domain for output in self.paper.publisher_outputs}
        if domains != {"cell_recovery", "expression", "heterogeneity", "cna_inference"}:
            raise ValueError("publisher outputs must cover all supported evidence domains")
        if self.paper.cohort.age_range_years != [2.5, 10.0]:
            raise ValueError("paper sample age range must remain source-native")
        if len(self.absent_evidence) != len(set(self.absent_evidence)):
            raise ValueError("absent evidence entries must be unique")
        return self


class PairRecord(StrictModel):
    publisher_pair_label: str
    publisher_patient_label: str
    publisher_biopsy_label: str
    frozen_preparation_code: Literal["FF", "OCT"]
    frozen_sample_accession: str
    ffpe_sample_accession: str
    frozen_subject_id: str
    ffpe_subject_id: None
    relationship_evidence: Literal["EGA sample titles and paper matched-pair design"]


class Inventory(StrictModel):
    schema_version: Literal["1.0.0"]
    product_id: Literal["ega-egad00001015781-matched-ffpe-frozen-single-cell-v1"]
    dataset: Dataset
    studies: list[Study]
    dacs: list[Dac]
    policy: Policy
    sample_pairs: list[PairRecord]
    samples: list[Sample]
    experiments: list[Experiment]
    runs: list[Run]
    files: list[FileRecord]
    evidence: SourceContract
    missingness: dict[str, object]
