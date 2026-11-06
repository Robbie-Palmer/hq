import hashlib
from pathlib import Path

from pydicom.dataset import Dataset, FileDataset, FileMetaDataset
from pydicom.sequence import Sequence
from pydicom.uid import ExplicitVRLittleEndian

from pathologize_data_registry.models import AssetRecord, SlideRecord
from pathologize_data_registry.repository import validate_dicom

PROJECT_DIR = Path(__file__).resolve().parents[1]


def code(scheme: str, value: str, meaning: str) -> Dataset:
    item = Dataset()
    item.CodingSchemeDesignator = scheme
    item.CodeValue = value
    item.CodeMeaning = meaning
    return item


def source_label_content(scheme: str, value: str, meaning: str) -> Dataset:
    item = Dataset()
    item.ConceptNameCodeSequence = Sequence([code("SCT", "424361007", "Using substance")])
    item.ConceptCodeSequence = Sequence([code(scheme, value, meaning)])
    return item


def write_synthetic_dicom(path: Path, slide: SlideRecord, sop_instance_uid: str) -> None:
    metadata = FileMetaDataset()
    metadata.TransferSyntaxUID = ExplicitVRLittleEndian
    dataset = FileDataset(path, {}, file_meta=metadata, preamble=b"\0" * 128)
    dataset.PatientID = slide.identity.patient_id
    dataset.StudyInstanceUID = slide.identity.study_instance_uid
    dataset.SeriesInstanceUID = slide.identity.series_instance_uid
    dataset.SOPInstanceUID = sop_instance_uid
    dataset.SOPClassUID = "1.2.840.10008.5.1.4.1.1.77.1.6"
    dataset.Modality = "SM"
    dataset.ImageType = ["DERIVED", "PRIMARY", "VOLUME", "NONE"]
    dataset.ContainerIdentifier = slide.identity.slide_container_id
    dataset.ClinicalTrialProtocolID = "CPTAC-COAD"
    dataset.Manufacturer = slide.scanner.manufacturer
    dataset.ManufacturerModelName = slide.scanner.model
    dataset.DeviceSerialNumber = slide.scanner.device_serial_number
    dataset.TotalPixelMatrixColumns = slide.physical_resolution.total_pixel_matrix_columns
    dataset.TotalPixelMatrixRows = slide.physical_resolution.total_pixel_matrix_rows

    pixel_measures = Dataset()
    pixel_measures.PixelSpacing = [
        slide.physical_resolution.micrometres_per_pixel_y / 1000,
        slide.physical_resolution.micrometres_per_pixel_x / 1000,
    ]
    functional_group = Dataset()
    functional_group.PixelMeasuresSequence = Sequence([pixel_measures])
    dataset.SharedFunctionalGroupsSequence = Sequence([functional_group])

    optical_path = Dataset()
    optical_path.ObjectiveLensPower = slide.scanner.objective_power
    dataset.OpticalPathSequence = Sequence([optical_path])

    specimen = Dataset()
    specimen.SpecimenIdentifier = slide.identity.specimen_id
    specimen.SpecimenUID = slide.identity.specimen_uid
    specimen.PrimaryAnatomicStructureSequence = Sequence([code("SCT", "71854001", "Colon")])
    preparation = Dataset()
    preparation.SpecimenPreparationStepContentItemSequence = Sequence(
        [
            source_label_content("SCT", "12710003", "hematoxylin stain"),
            source_label_content("SCT", "36879007", "water soluble eosin stain"),
        ]
    )
    specimen.SpecimenPreparationSequence = Sequence([preparation])
    dataset.SpecimenDescriptionSequence = Sequence([specimen])
    dataset.save_as(path, enforce_file_format=True)


def test_synthetic_dicom_matches_source_contract(tmp_path: Path) -> None:
    slide = SlideRecord.model_validate_json(
        (PROJECT_DIR / "records/slides/cptac-coad-idc-v7-09co003-0b1ee2c0.json").read_text(
            encoding="utf-8"
        )
    )
    path = tmp_path / slide.physical_resolution.source_instance_path
    sop_instance_uid = "1.2.3.4.5"
    write_synthetic_dicom(path, slide, sop_instance_uid)
    content = path.read_bytes()
    asset = AssetRecord(
        relative_path=path.name,
        source_url="https://public.example.test/synthetic.dcm",
        bytes=len(content),
        sha256=hashlib.sha256(content).hexdigest(),
        source_etag="0" * 32,
        sop_instance_uid=sop_instance_uid,
        image_role="volume_primary",
    )

    assert validate_dicom(path, asset, slide) == []

    wrong_asset = asset.model_copy(update={"image_role": "thumbnail"})
    assert any("ImageType" in issue for issue in validate_dicom(path, wrong_asset, slide))
