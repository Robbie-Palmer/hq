# Ultralytics extensions

This package contains small, framework-specific helpers shared by Ultralytics
pipelines. It does not wrap `YOLO.train`, define experiment policy, or own
dataset ontology and split decisions.

The package owns:

- YOLO box and polygon coordinate encoding;
- restricted checkpoint loading and exact-resume evidence; and
- conversion of Ultralytics result objects into neutral spatial instances.

Projects remain responsible for training calls, stop rules, resource limits,
dataset layouts, domain records, metrics, and reports.

The coordinate helpers do not depend on Shapely. They only normalize validated
boxes and polygon vertices for YOLO labels; clipping, topology repair, and
pathology-specific inclusion rules remain with the dataset adapter. Add a
geometry engine only when a pipeline needs those operations.

Run the package checks through mise:

```bash
mise run //packages/ultralytics-extensions:check
```
