# Skin frozen and FFPE preview source data

This DVC product records the publisher-native contract for Zenodo record
[`18780726`](https://zenodo.org/records/18780726), DOI
[`10.5281/zenodo.18780726`](https://doi.org/10.5281/zenodo.18780726). The release
contains five de-identified skin-cancer cases. Each case has one file labelled
as a frozen MRXS slide and one labelled as an FFPE MRXS slide, plus a metadata
XML and an annotation XML for each preparation.

The product keeps the five source cases, preparation labels, skin resection-margin
context, 30 file identities, exact byte counts, publisher MD5 checksums, and stable
references. It does not add a Pathologize cohort, infer alignment, generate FFPE
images, or define comparison and SOP rules.

## A metadata-only source

Zenodo describes the ten `.mrxs` files as whole-slide images. The deposited
objects do not make usable MRXS slides:

- the complete record is 418,147 bytes;
- each `.mrxs` object is 25,838 to 86,312 bytes and starts with a JFIF JPEG
  signature;
- the record has no same-named companion pixel directory for any `.mrxs` file;
- each annotation XML has an empty `annotations` element; and
- an OpenSlide read of every downloaded `.mrxs` object reports an unsupported
  format.

The payload check on 2026-11-11 downloaded all 30 objects to temporary storage,
matched every byte count and MD5, verified each XML payload, opened each
`.mrxs`-named object as a JPEG, and attempted to open it with OpenSlide. The
source product therefore exposes metadata references only. It does not claim
that image pixels are available.

Run the bounded live checks when updating the source:

```bash
mise //data-products/skin-cancer/frozen-ffpe-preview:live-check
mise //data-products/skin-cancer/frozen-ffpe-preview:payload-check
```

`live-check` reads the Zenodo API record. `payload-check` downloads the 418,147
bytes into a temporary directory, validates them, performs the reader test, and
deletes the directory. Neither command writes source bytes into the repository.

To retrieve one pinned file for manual inspection, pass its exact name. The
command stores the verified object under ignored `data/raw/` only after its size
and MD5 match the manifest.

```bash
mise //data-products/skin-cancer/frozen-ffpe-preview:acquire -- YW_DP1_045.mrxs
```

## Preview and paper boundaries

The preview has five cases, one for each publisher subtype: extramammary Paget
disease, Bowen disease, invasive squamous cell carcinoma, basal cell carcinoma,
and melanoma. The filename suffix `P` denotes FFPE. The unsuffixed name denotes
frozen preparation. A shared case stem establishes a publisher-declared case
pair, not spatial registration or an identical cutting plane.

The related paper, DOI
[`10.1038/s41746-026-02939-1`](https://doi.org/10.1038/s41746-026-02939-1),
reports a separate clinical study with 2,594 slides from 283 patients. That study
has 1,192 frozen and FFPE slide pairs and 210 additional main-tumour FFPE slides.
Those counts do not describe the Zenodo preview. The paper also explains that
frozen and FFPE sections came from adjacent, non-identical tissue levels. One
published EMPD discrepancy persisted because the FFPE section was deeper than
the frozen section.

The paper reports 60 diagnostic discrepancies in the full cohort and a 55-case
expert reassessment set. It defines grades as concordant, minimal, minor, and
major. Major discrepancies can change management through avoidable resection or
missed tumour extension. Its workflow observations used five slides per case:
about 8 minutes for frozen preparation and more than 24 hours for standard FFPE
processing. The preview provides no timing evidence; both timings come from the
paper.

## Rights and access

Zenodo applies CC BY 4.0 to the preview dataset. The paper uses CC BY-NC-ND 4.0.
The full study data are not public because of institutional governance and
patient privacy. The authors state that they may provide them on reasonable
request. These three terms remain separate in `manifest.json`.

## Reproduction

The normal DVC graph publishes the source contract and ten metadata-only native
records. It never acquires dataset bytes:

```bash
mise //data-products/skin-cancer/frozen-ffpe-preview:repro
mise //data-products/skin-cancer/frozen-ffpe-preview:check
```

Downstream products may pin `dvc.lock`, `manifest.json`, and the native index.
They must retain the source case, preparation, file, and artifact references and
must not treat the records as readable WSIs until a corrected publisher release
supplies and verifies the missing pixel payloads.
