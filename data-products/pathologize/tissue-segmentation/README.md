# Pathologize tissue segmentation

This DVC data product combines semantic-segmentation records from public
pathology datasets. Semantic segmentation assigns a class to each image pixel,
such as tumour epithelium, stroma, lymphocytes, or necrosis. Sources keep their
own labels and mask meanings. Versioned adapters map them to Pathologize tissue
and cell-type labels without treating unlike source categories as equivalent.

The source portfolio includes:

- Breast Cancer Semantic Segmentation (BCSS), which has multiclass masks for
  breast H&E image regions;
- SegPath, which has H&E images and binary cell-type masks derived from
  registered immunofluorescence restaining; and
- a colorectal epithelium dataset with H&E, immunohistochemistry, and in-situ
  hybridisation images.

The product publishes record tables, source-to-Pathologize label mappings,
group-safe partitions, assay provenance, lineage, and reconciliation reports.
Image and mask bytes remain in their source products. Records refer to those
artifacts by stable identifier or path.

The checked-in DVC stage uses synthetic contract records. They exercise the
schema and reports but are not training or evaluation data.
