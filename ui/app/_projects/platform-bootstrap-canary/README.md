# Platform bootstrap canary UI boundary

The minimal bootstrap profile owns this directory so Copier can prove a
project-specific web boundary inside the shared Next.js application. The
shared route at `/platform-bootstrap-canary` is a thin adapter into this
directory. The canary remains outside the public project catalog and knowledge
graph.
