# PANDA challenge source data

This DVC project owns the source-native PANDA development distribution in this
repository. It pins the official PANDA Grand Challenge and Kaggle records, the
2020 competition release identity, CC BY-SA-NC 4.0 terms, Kaggle access rules,
publisher roles, and the 10,616-slide inventory. The checked-in evidence
snapshots record the public source facts and their SHA-256 digests.

The product keeps the two providers separate. Radboud masks label individual
glands with codes 0 through 5. Karolinska masks label regions with codes 0
through 2 and combine stroma with epithelium. The contract also preserves the
provider-level scanner scale reported by the challenge. It does not collapse
the mask codes into a shared ontology.

The Kaggle `image_id` is the published slide identity. The downloadable
metadata does not publish patient or case IDs, even though the paper reports
2,113 patients. The private native index therefore keeps `patient_id` and
`case_id` null. It never infers relationships from filenames, labels, ordering,
or tissue appearance.

## Check public metadata

The normal build validates only committed metadata and synthetic fixtures. It
needs no Kaggle account, credentials, source images, or network access.

```bash
mise //data-products/panda/challenge-2020:repro
mise //data-products/panda/challenge-2020:check
```

The DVC stage publishes `outputs/source-contract.json`,
`outputs/artifact-reference-contract.json`, and aggregate source metrics. Its
dependency hashes pin both official-record snapshots and the implementation.

## Index an authorized release

Kaggle requires sign-in and acceptance of the competition rules. An authorized
operator can retrieve the distribution with Kaggle's documented competition
download route:

```bash
kaggle competitions download -c prostate-cancer-grade-assessment
```

Do not automate that step in CI or put Kaggle credentials, the archive, or
extracted source files in Git. Extract the approved development files under
`data/native` without renaming them:

```text
data/native/train.csv
data/native/train_images/<image_id>.tiff
data/native/train_label_masks/<image_id>_mask.tiff
```

Then run the explicit private index:

```bash
mise //data-products/panda/challenge-2020:index
```

The indexer requires all 10,616 slides, the published 5,160 Radboud and 5,456
Karolinska records, and exactly 10,516 masks. It hashes `train.csv`, every
whole-slide image, and every available mask with SHA-256. The output preserves
the original Gleason score strings, ISUP grades, provider identities, H&E
stain, publisher `train` role, mask availability, native mask codes, and
provider-level scale facts. It also records the original Kaggle artifact path.

Private outputs stay ignored under `outputs/private`. Authorized downstream
products can consume `panda:<image_id>` record references and
`panda:<image_id>:whole_slide` or `panda:<image_id>:label_mask` artifact
references. MIL, segmentation, and classification products must reference this
source product. They must not copy the source bytes or add Pathologize cohort
selection, label remapping, exclusions, or new train and test roles here.

## Label limits

The publisher warns that the development grades contain disagreement between
pathologists. Unlike all private-test and most public-test slides, the training
slides were not graded by multiple pathologists. One hundred development slides
lack masks, and the available masks may contain false-positive or false-negative
regions. Consumers must retain those caveats and make any exclusions or label
noise policy in their own product.
