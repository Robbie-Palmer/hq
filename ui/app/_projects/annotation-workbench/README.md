# Annotation Workbench project UI

This directory owns the Annotation Workbench browser product mounted at
`/annotation-workbench` in the shared Next.js application.

The UI reads generic review bundles from a local service. Dataset adapters own
image acquisition and model inference. The browser records revisable review
events and never treats a model proposal or one reviewer decision as source
truth.

On a private or tailnet hostname, the connection form infers the same hostname
on port `8765`; a saved URL still takes precedence. The review queue scrolls
horizontally on narrow screens so the images and decision controls remain the
main mobile flow.
