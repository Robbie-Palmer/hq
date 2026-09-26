# Dashboards

Entry points for the external services this repo depends on.

## Hosting and CDN

- [Pages project `personal-site`](https://dash.cloudflare.com/?to=/:account/pages/view/personal-site),
  site deploys and previews.
- [Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages),
  `recipe-api`, `recipe-ingest`, and other Workers.
- [Cloudflare Images](https://dash.cloudflare.com/?to=/:account/images), blog
  and recipe media.
- [`robbiepalmer.me` DNS records](https://dash.cloudflare.com/?to=/:account/robbiepalmer.me/dns).
- [Cloudflare R2](https://dash.cloudflare.com/?to=/:account/r2/overview),
  database backup archives and the DVC remote (`dvc` bucket).

## Data and infrastructure

- [Neon console](https://console.neon.tech/), recipe Postgres (production and
  preview projects).
- [Terraform Cloud workspace](https://app.terraform.io/app/robbie-palmer/workspaces/personal-site),
  remote state and runs for `infra/public-platform/`.

## Secrets and configuration

- [Doppler](https://app.doppler.com/), source of truth for secrets and deploy
  configuration; projects `personal-site` and `ai-review` (layout in
  [secrets.md](secrets.md)).

## Quality and observability

- [PostHog](https://app.posthog.com/), analytics plus OTLP traces and logs
  exported by [`packages/observability`](../packages/observability/README.md).
- [SonarCloud project](https://sonarcloud.io/project/overview?id=Robbie-Palmer_personal-site).
- [OpenSSF Scorecard](https://scorecard.dev/viewer/?uri=github.com/Robbie-Palmer/hq).

## Automation

- [GitHub repository](https://github.com/Robbie-Palmer/hq).
- [Renovate dashboard](https://developer.mend.io/github/Robbie-Palmer/hq),
  dependency update PRs.
- [CLA Assistant](https://cla-assistant.io/).
