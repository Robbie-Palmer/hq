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
without a launcher. The review queue scrolls horizontally on narrow screens so
the images and decision controls remain the main mobile flow.
