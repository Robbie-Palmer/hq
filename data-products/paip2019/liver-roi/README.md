# PAIP 2019 liver ROI source data

This DVC project is the sole owner of the PAIP 2019 liver cancer segmentation
source data in this repository. It preserves the publisher's case and slide
identities, challenge roles, H&E whole-slide images, XML regions, binary masks,
viable tumour burden measurements, rights, and access rules.

The source contract follows the current [PAIP access page](https://wisepaip.org/),
the [official challenge dataset page](https://paip2019.grand-challenge.org/Dataset/),
and the [challenge paper](https://doi.org/10.1016/j.media.2020.101854). The
dataset requires PAIP Committee approval of a signed Data Use and
Confidentiality Agreement. It is licensed CC BY-NC 4.0, and the DUA also bars
unapproved disclosure. Do not commit or redistribute the source files, case
receipt, native index, or credentials.

## Check the public contract

The normal check reads only committed metadata and synthetic fixtures. It does
not contact PAIP, need credentials, or require dataset files.

```bash
mise //data-products/paip2019/liver-roi:repro
mise //data-products/paip2019/liver-roi:check
```

The DVC stage publishes the validated source contract and cohort counts. The
contract records 50 training slides, 10 validation slides, and 40 test slides.
Only the training role has publisher-released XML regions, whole-tumour masks,
viable-tumour masks, and viable tumour burden measurements. The challenge
committee retains validation and test ground truth.

## Index approved source files

After PAIP approves access, keep the original files under `data/native`. Create
`data/native/source-receipt.jsonl` with one JSON object per case. Each object
must provide the publisher case ID, slide ID, challenge role, optional
publisher institution ID, project-relative artifact paths, and the published
area measurements for training cases. The accepted institution IDs are
`snuh`, `snubh`, and `smg-snu-bmc`; use `null` when PAIP does not disclose the
case-level institution.

Track the approved source tree in this product's local DVC cache. The generated
`data/native.dvc` file contains protected inventory information, so the
project's `/data` ignore rule keeps it out of Git with the source bytes.

```bash
mise //data-products/paip2019/liver-roi:dvc -- add data/native
```

Run the private inventory explicitly:

```bash
mise //data-products/paip2019/liver-roi:index
```

The indexer requires the complete 100-case release. It hashes every original
artifact, reads TIFF geometry without decoding pixels, records the native SVS
scale metadata, and counts the three publisher XML region semantics:

- annotation ID 1 with `NegativeROA=0`: whole tumour area
- annotation ID 2 with `NegativeROA=0`: viable tumour area
- annotation ID 2 with `NegativeROA=1`: negative pen region

PAIP says the TIF files, not the XML polygons, are the ground truth. Negative
pen regions are excluded from the released binary masks and tumour burden.
The private index keeps slide, XML, and mask coordinate frames separate and
stores each raster's dimensions. It does not assume pixel-for-pixel alignment.

The command writes `outputs/private/native-index.jsonl` and
`outputs/private/source-metrics.json`. Git ignores both paths. Authorized
downstream products may pin this DVC project and consume its stable
`paip2019:<case-id>` records and `paip2019:<case-id>:<artifact-kind>` artifact
references. They must not copy source images. Pathologize cohort selection,
ontology mapping, exclusions, and new roles belong in a separate downstream
product.
