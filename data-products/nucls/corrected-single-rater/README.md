# NuCLS corrected single-rater source data

This DVC source product owns the corrected single-rater NuCLS distribution in
the publisher's vocabulary. It pins the RGB, annotation, and official split
archives, their rights and digests, and publishes one native record per field
of view.

The native index preserves the TCGA slide and patient identities, source site,
annotation geometry and labels, empty images, and every publisher fold role.
It does not choose a Pathologize training partition or translate the ontology.
Those decisions belong to downstream data products.

The source bytes are ignored by Git and owned by DVC. Reproduce and validate
the product with:

```bash
mise //data-products/nucls/corrected-single-rater:repro
mise //data-products/nucls/corrected-single-rater:check
```
