# AI review domain

This package contains deterministic code-review rules and durable record
schemas. It does not create network clients or read application credentials.

The `ai-review` Worker owns review-specific GitHub, OpenCode, Cloudflare, and R2
adapters. Shared `github-client` and `openrouter-client` packages configure the
vendor SDKs. The Worker passes retrieved data into this package for finding
validation, publication selection, outcome evaluation, pull-request
classification, and replay validation.

Generic web-platform helpers belong in `ts-base`. In particular, the Worker
uses `ts-base/http` for JSON requests and `ts-base/strings` for environment
list parsing.
