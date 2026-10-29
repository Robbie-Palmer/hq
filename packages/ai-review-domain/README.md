# AI review domain

This package contains deterministic code-review rules and durable record
schemas. It does not create network clients or read application credentials.

The `ai-review` Worker owns review-specific GitHub, OpenCode, Cloudflare, and R2
adapters. Shared `github-client` and `openrouter-client` packages configure the
vendor SDKs. The Worker passes retrieved data into this package for finding
validation, publication selection, outcome evaluation, pull-request
classification, and replay validation.

`coverage-manifest` owns the versioned path selector and terminal coverage
decisions. Its defaults include Markdown, MDX, and test paths. Callers must
configure exclusions in the selection policy, then persist the returned fixed
reason codes instead of deriving coverage from provider results.

`rule-resolution` owns the provider-independent per-path rule contract. Version
1 resolves rule keys through this fixed precedence chain:

| Rank | Layer | Match and tie-break rule |
| ---: | ----- | ------------------------ |
| 1 | Global | Matches every selected path. |
| 2 | Repository | Matches the exact repository. |
| 3 | Directory | Matches descendants; the deepest matching directory wins. |
| 4 | Language | Matches the language inferred from the file extension. |
| 5 | File | Matches the exact repository-relative path. |

Rules with different keys accumulate. A higher layer replaces lower-layer
rules with the same key. Identical winners at the same rank retain all sources;
different instructions at the same winning rank are unresolved conflicts. The
resolver returns an inspectable preview, and `resolveReviewRules` rejects such
conflicts before a caller can dispatch a model. Persist the preview with the
review record so replay uses the same resolver version, rule-set version,
effective instructions, and source revisions.

Generic web-platform helpers belong in `ts-base`. In particular, the Worker
uses `ts-base/http` for JSON requests and `ts-base/strings` for environment
list parsing.
