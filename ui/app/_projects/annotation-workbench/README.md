# Annotation Workbench project UI

This directory owns the Annotation Workbench browser product mounted at
`/annotation-workbench` in the shared Next.js application.

The UI reads generic review bundles from a local service. Dataset adapters own
image acquisition and model inference. The browser records revisable review
events and never treats a model proposal or one reviewer decision as source
truth.

The tailnet launcher supplies `NEXT_PUBLIC_ANNOTATION_WORKBENCH_SERVICE_URL`,
and the browser opens that review batch without asking the reviewer for an API
address. A manual connection field remains available when running the UI
without a launcher.

The browser always records its events as human reviews. Assistant clients use
the API directly and identify their own events there. The mobile flow keeps the
source and every boundary proposal in one bounded comparison grid, separates
proposal choice from mask grading, and uses previous and next controls instead
of a horizontally scrolling queue. Dataset coordinates, revisions, and license
details remain available in a collapsed technical-details section. After the
last item, the browser summarizes the saved decisions and lists every boundary
that needs a separate pixel-editing pass.
