# ProteomeXchange PXD064700 source data

This DVC product pins ProteomeXchange revision 1 of `PXD064700`, announced on
2026-03-17 and hosted by PRIDE. It records the paired human brain fixation
study in the publisher's terms: donor number, cortex or hippocampus, fresh,
formalin-fixed, FFPE, or FFPE commercial-kit preparation, batch, biological
replicate, technical replicate, raw run, quant sidecar, and submitted result
files.

The checked-in snapshots contain metadata only. They include the PRIDE project
response, the ProteomeXchange announcement, an exact-byte FTP inventory, the
publisher SHA-1 list, the community SDRF, the experiment overview, and the
donor-name map. Raw mass-spectrometry files, quant sidecars, FASTA data,
spectral libraries, and DIA-NN result matrices remain in PRIDE. The artifact
index gives each remote file a stable revision-scoped reference.

## Pinned release

- ProteomeXchange accession and revision: `PXD064700-1`
- DOI: `10.1016/J.JPROT.2025.105589`
- PRIDE submission type: `PARTIAL`
- Repository rights: Creative Commons Public Domain, CC0
- Instrument and assay: Orbitrap Exploris 480, DIA LC-HRMS, label-free
  quantification
- Processing: DIA-NN 1.8 with 1 percent FDR, then Perseus 2.1.3.0 and R 4.4.1

The FTP release has 552 entries totaling 710,900,159,141 bytes, about 662.08
GiB. `checksum.txt` publishes SHA-1 values for 550 artifacts. Its own checksum
and the community SDRF do not have publisher SHA-1 values. Revision 1 announces
551 files because the community SDRF was added later.

The paired six-donor preparation design has 213 of 216 stated run identities.
Three FFPE technical runs are absent: donor `133-21`, hippocampus, biological
replicate 1, technical replicate 2; and donor `135-21`, hippocampus, biological
replicates 1 and 2, technical replicate 2. The product reports these as source
missingness. It does not invent files or values.

## Product boundary

This source supports assay-suitability, fixation-artifact, extraction-protocol,
and SOP evidence comparisons. Pathologize owns comparison scores, SOP
recommendations, harmonized outcomes, filtering, normalization, and derived
thresholds. The source does not add stain, imaging, scanner, patient-diagnosis,
cost, diagnostic-confidence, or whole-slide morphology fields.

The paper and repository report a post-mortem donor age range of 64 to 101
years, a low versus high Braak pilot, and aggregate Alzheimer context. They do
not publish donor-specific clinical assignments in the repository metadata.
The community SDRF labels runs with Alzheimer's disease, but PRIDE says the
submitter has not verified that annotation. Run records retain the SDRF columns
with that provenance and do not turn them into donor diagnoses.

## Commands

```bash
mise //data-products/proteomexchange/pxd064700:check
mise //data-products/proteomexchange/pxd064700:repro
mise //data-products/proteomexchange/pxd064700:verify:live
```

`check` and `repro` use checked-in metadata, need no credentials, and download
no proteomics files. `verify:live` is an explicit network check against
allowlisted public HTTPS endpoints. `refresh` updates public metadata and uses
anonymous FTP only for the exact-byte directory listing. Review every snapshot
and release-identity change before committing a refresh.

## Publisher records

- [ProteomeXchange revision 1](https://proteomecentral.proteomexchange.org/cgi/GetDataset?ID=PXD064700-1&test=no)
- [PRIDE project](https://www.ebi.ac.uk/pride/archive/projects/PXD064700)
- [PRIDE Archive API](https://www.ebi.ac.uk/pride/ws/archive/v3/projects/PXD064700)
- [Published article](https://doi.org/10.1016/j.jprot.2025.105589)
