# hq

[![Lines of Code](https://sonarcloud.io/api/project_badges/measure?project=Robbie-Palmer_personal-site&metric=ncloc)](https://sonarcloud.io/summary/new_code?id=Robbie-Palmer_personal-site)
[![Duplicated Lines (%)](https://sonarcloud.io/api/project_badges/measure?project=Robbie-Palmer_personal-site&metric=duplicated_lines_density)](https://sonarcloud.io/summary/new_code?id=Robbie-Palmer_personal-site)
[![Reliability Rating](https://sonarcloud.io/api/project_badges/measure?project=Robbie-Palmer_personal-site&metric=reliability_rating)](https://sonarcloud.io/summary/new_code?id=Robbie-Palmer_personal-site)
[![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=Robbie-Palmer_personal-site&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=Robbie-Palmer_personal-site)
[![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=Robbie-Palmer_personal-site&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=Robbie-Palmer_personal-site)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Robbie-Palmer/hq/badge)](https://scorecard.dev/viewer/?uri=github.com/Robbie-Palmer/hq)

My monorepo for [robbiepalmer.me](https://robbiepalmer.me), software projects, experiments,
writing, infrastructure, and homelab configuration.

Things you can visit:

- [Recipe Site](https://robbiepalmer.me/recipes), with its [project notes](https://robbiepalmer.me/projects/recipe-site)
- [Asset Tracker](https://robbiepalmer.me/assettracker), with its [project notes](https://robbiepalmer.me/projects/personal-finance-app)
- [Agentic Code Review](https://robbiepalmer.me/projects/agentic-code-review) and its [GitHub App](https://github.com/apps/robbie-palmer-ai-review)
- [Work Graph](https://robbiepalmer.me/projects/work-graph) and its [Access-protected API](https://work-graph.robbiepalmer.me)
- [Autonomic Satellite Swarm](https://robbiepalmer.me/satellite-swarm), an interactive simulation with [project notes](https://robbiepalmer.me/projects/autonomic-satellite-swarm)

Each project owns its details in its own README:

- [`ui/`](ui/), the website itself (Next.js static export on Cloudflare Pages).
  Content authoring guides: [blog](ui/content/blog/README.md),
  [projects](ui/content/projects/README.md)
- [`functions/`](functions/README.md), Pages Functions running alongside the static site
- [`workers/recipe-api/`](workers/recipe-api/README.md), API and auth Worker behind the recipe features
- [`workers/recipe-ingest/`](workers/recipe-ingest/README.md), durable photo-to-recipe ingestion pipeline
- [`packages/`](packages/), shared libraries (database schema, domain model, parsing, observability)
- [`ml-pipelines/`](ml-pipelines/README.md), DVC-managed ML experiments feeding the recipe features
- [`cpp/`](cpp/README.md), C++ projects with shared formatting and static-analysis tooling
- [`ai-review/`](ai-review/README.md), stateful AI code-review service
- [`homelab/`](homelab/README.md), home lab declared as code
- [`infra/`](infra/README.md), independently stateful Terraform roots for bootstrap, the public platform, and remote development
  for Cloudflare, Neon, and PostHog
- [`backups/`](backups/README.md), encrypted Postgres backups to R2
- [`docs/`](docs/), internal runbooks: [external dashboards](docs/dashboards.md),
  [social preview QA](docs/social-previews.md), [database operations](docs/database.md),
  [preview environments](docs/preview-environments.md), [secrets](docs/secrets.md)

## Development

All build and development tasks run through [mise](https://mise.jdx.dev/). Task definitions live in
`.mise.toml` (repo-wide) and each project's own `mise.toml`; browse everything with `mise task --all`.

```bash
mise //:install   # install dependencies
mise //ui:dev     # site only, http://localhost:3000
mise run //:dev   # site + recipe-api Worker together (requires Doppler)
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Coding agents should also read [AGENTS.md](AGENTS.md).
