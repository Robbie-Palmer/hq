# GDC TCGA image-genomics data product

This source product records the GDC linkage between TCGA diagnostic slide
files, cases, biospecimens, and open derived molecular files. It pins GDC Data
Release 46.0, keeps GDC and TCGA identifiers, retains API annotations, records
file MD5 checksums and access tiers, and publishes artifact references without
downloading the referenced files.

GDC does not populate `stain_type` for the TCGA diagnostic slide records in
this release. The product records that field as missing. It does not infer an
H&E label from the diagnostic-slide category. GDC identifies the sample donor
as a case, while the TCGA barcode documentation calls the corresponding
submitter barcode a participant barcode. Both values remain in the source
contract. The case UUID is the patient-level leakage group.

The source has no publisher train, validation, or test roles. This product does
not create them. Tissue selection, stain interpretation, molecular status,
cohort membership, ontology mapping, and partitions belong to a downstream
product. Downstream products reference the published record and artifact IDs;
they do not copy slide images into their own source trees.

## Deterministic verification

The checked-in metadata fixture contains three records returned by the GDC API
for TCGA-GN-A267 in Data Release 46.0. It includes one diagnostic slide, two
open molecular files, one case annotation, an aliquot-level association, and a
portion-level association. Verification downloads no dataset files and needs
no GDC token.

```bash
mise //data-products/gdc/tcga-image-genomics:repro
mise //data-products/gdc/tcga-image-genomics:check
```

## Full metadata refresh

The refresh command checks the GDC status before and after retrieval. It stops
unless the API reports Data Release 46.0. It then pages through the pinned
queries and writes open metadata under the ignored `metadata/raw` directory.
The command never sends an access token and never calls the GDC data download
endpoint.

```bash
mise //data-products/gdc/tcga-image-genomics:refresh
```

The release contract pins the official active-file manifest by GDC file ID and
URL. The refresh uses the API queries because the active-file manifest does not
contain the nested case, sample, portion, slide, analyte, aliquot, annotation,
or workflow records needed by this product.

## Rights and source limits

Open GDC access means the files require no login. It is not a blanket copyright
licence. The checked-in rights contract links the GDC and NIH policies, records
the no-reidentification and acknowledgement duties, and notes the TCGA Research
Network acknowledgement requested by NCI. Controlled file bytes are outside
this product.
