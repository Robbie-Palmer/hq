import type { LegacyADRAlias } from "@/lib/domain/adr/adr";

/**
 * Historical project-local ADR URLs. Notes preserve authored context from the
 * removed inherited stub files; aliases without notes were empty redirects or
 * canonical URLs retained when project-local ADR sequences were compacted.
 * This is a data registry, so Sonar excludes its repeated record shape from CPD.
 */
export const legacyADRAliases = [
  {
    alias: "agentic-code-review:000-github-public-repo",
    target: "personal-knowledge-graph:000-github-public-repo",
    notes:
      "The GitHub App is developed in the same public repository it reviews. Public\nsource, issues, Pull Requests, checks, and review output make the product's\nclaims inspectable while keeping its native integration surface close at hand.\n",
  },
  {
    alias: "agentic-code-review:001-monorepo",
    target: "personal-knowledge-graph:001-monorepo",
    notes:
      "The service remains a distinct product while sharing this monorepo's tooling,\ninfrastructure, review engine, and documentation. Atomic changes across those\nboundaries currently provide more value than repository-level separation.\n",
  },
  {
    alias: "agentic-code-review:002-mise",
    target: "personal-knowledge-graph:004-mise",
    notes:
      "Mise is the service's task and tool-version interface. Its project-local tasks\nkeep type checking, tests, deployment dry-runs, production deployment, and\nstaging end-to-end verification reproducible between local work and CI.\n",
  },
  {
    alias: "agentic-code-review:003-pnpm",
    target: "personal-knowledge-graph:007-pnpm",
    notes:
      "The TypeScript Worker participates in the repository's pnpm workspace. Strict\ndependency boundaries and one lockfile keep the deployable service aligned with\nthe shared review engine without publishing an internal package.\n",
  },
  {
    alias: "agentic-code-review:004-vitest",
    target: "personal-knowledge-graph:008-vitest",
    notes:
      "Vitest covers the service's deterministic unit tests and Cloudflare-supported\nworkerd integration tests. The shared stateless engine retains Node's test\nrunner, so this inheritance applies to the stateful Worker rather than imposing\none runner on every part of the review system.\n",
  },
  {
    alias: "agentic-code-review:005-terraform",
    target: "personal-knowledge-graph:010-terraform",
    notes:
      "Terraform owns the shared Cloudflare account resources used by the product,\nincluding its private R2 bucket. Wrangler retains ownership of Worker-specific\nbindings and deployment configuration, giving each tool a bounded concern.\n",
  },
  {
    alias: "agentic-code-review:006-github-actions",
    target: "personal-knowledge-graph:016-github-actions",
    notes:
      "GitHub Actions runs service checks and production deployment around the same\nmise tasks used locally. The workflow remains a delivery boundary; review\norchestration has moved out of per-push Actions and into the stateful App.\n",
  },
  {
    alias: "agentic-code-review:007-terraform-cloud",
    target: "personal-knowledge-graph:017-terraform-cloud",
    notes:
      "The Terraform state covering the product's shared Cloudflare resources remains\nin Terraform Cloud with local execution from GitHub Actions. The service adds\nno separate state backend solely for its R2 bucket.\n",
  },
  {
    alias: "agentic-code-review:008-github-secrets",
    target: "personal-knowledge-graph:018-github-secrets",
    notes:
      "The production GitHub environment is the deployment-facing secret boundary for\nthe Worker. Its values are a generated mirror of Doppler rather than an\nindependent source of truth.\n",
  },
  {
    alias: "agentic-code-review:009-cloudflare-terraform-provider",
    target: "personal-knowledge-graph:030-downgrade-cloudflare-tf",
    notes:
      "The product's shared R2 infrastructure currently inherits the repository's\nCloudflare provider v4 constraint. R2 lifecycle rules that provider cannot\nrepresent are applied once with Wrangler and verified during deployment.\n",
  },
  {
    alias: "agentic-code-review:010-doppler",
    target: "personal-knowledge-graph:035-doppler",
    notes:
      "Doppler is the source of truth for production and staging deployment secrets,\nincluding GitHub App credentials and spend-limited inference keys. Repository\nscripts publish the required subset into GitHub environments without writing\nplaintext environment files.\n",
  },
  {
    alias: "agentic-code-review:011-agpl-license",
    target: "personal-knowledge-graph:037-agpl-license",
    notes:
      "The service is published under the repository's AGPL-3.0 terms and contribution\nmodel. That keeps the review implementation inspectable while requiring hosted\nmodifications to remain available under the same licence.\n",
  },
  {
    alias: "agentic-code-review:012-cloudflare-r2",
    target: "personal-knowledge-graph:039-cloudflare-r2",
    notes:
      "Private R2 storage holds versioned review runs, findings, provider metrics, and\ncost evidence separately from the Durable Object's operational state. A\nbucket-level lifecycle policy bounds retention, while S3 compatibility\npreserves a practical migration path.\n",
  },
  {
    alias: "agentic-code-review:013-openrouter",
    target: "recipe-site:002-openrouter",
    notes:
      "The general gateway decision carries over from Recipe Site: one API, key, bill,\nand routing surface makes models and upstream providers replaceable. The code\nreview-specific ensemble, privacy controls, budgets, and evaluation requirements\nremain governed by ADRs 031 and 032.\n",
  },
  {
    alias: "agentic-code-review:014-cloudflare-workflows",
    target: "recipe-site:012-cloudflare-workflows-recipe-ingestion",
    title: "Cloudflare Workflows",
    notes:
      "The durable orchestration decision carries over to code review. The per-PR\nDurable Object owns delivery deduplication, debounce, reviewed-head state,\nbudgets, and the single active paid-review lease. A Workflow owns the admitted\nrun: prepare current GitHub context, run paid and free scouts in separate steps,\nmerge findings, publish the rolling comment, append the analytical record to\nR2, and complete the PR state.\n\nEach model step permits one configured application attempt. Separating paid and\nfree providers prevents recovery from a stalled free call from replaying a\ncompleted paid ensemble. An expired lease must terminate its old Workflow\nbefore the coordinator admits a replacement.\n",
  },
  {
    alias: "agentic-code-review:015-husky-precommit",
    target: "personal-knowledge-graph:014-husky-precommit",
    notes:
      "Husky and lint-staged keep the service's staged TypeScript, configuration, and\ndocumentation subject to the repository's fast local checks. The hooks continue\nto delegate to mise so CI and local development share the same commands.\n",
  },
  {
    alias: "agentic-code-review:016-renovate",
    target: "personal-knowledge-graph:024-renovate",
    notes:
      "Renovate manages the service's npm, GitHub Actions, and Terraform dependency\nupdates under the repository's existing grouping, approval, and automerge\npolicy. A standalone repository would need to preserve or deliberately replace\nthat dependency-maintenance policy.\n",
  },
  {
    alias: "agentic-code-review:017-codeql",
    target: "personal-knowledge-graph:032-codeql",
    notes:
      "CodeQL provides GitHub-native security analysis for the TypeScript service and\nits integration code. This inheritance covers development assurance; CodeQL\nfindings are not yet inputs to the App's unified review output.\n",
  },
  {
    alias: "agentic-code-review:018-trivy",
    target: "personal-knowledge-graph:047-trivy",
    notes:
      "Trivy scans the service's dependencies and the shared Terraform that provisions\nits Cloudflare resources. Its PR gate and scheduled scans remain repository\nsafeguards rather than sources for the App's own review findings.\n",
  },
  {
    alias: "agentic-code-review:019-sonarqube",
    target: "recipe-site:009-sonarqube",
    notes:
      "SonarQube supplies deterministic code-health analysis and a quality gate for the\nservice alongside its unit-test coverage. This inheritance records how the App\nis developed; incorporating SonarQube findings into reviews would be a separate\nproduct decision.\n",
  },
  {
    alias: "agentic-code-review:020-zizmor",
    target: "personal-knowledge-graph:048-zizmor",
    notes:
      "actionlint and zizmor validate the GitHub Actions workflows that test, scan, and\ndeploy the service. Their checks are especially relevant to workflows handling\nthe GitHub App, Cloudflare, Doppler, and OpenRouter credentials.\n",
  },
  {
    alias: "agentic-code-review:021-tflint",
    target: "personal-knowledge-graph:050-tflint",
    notes:
      "The service's R2 and related Cloudflare infrastructure live in the shared\nTerraform root, so the same blocking TFLint checks cover its declarations. An\nindependent repository would carry this infrastructure gate with the Terraform.\n",
  },
  {
    alias: "agentic-code-review:022-knip",
    target: "personal-knowledge-graph:051-knip",
    notes:
      "Knip checks the service workspace for unused files and dependencies while the\nroot configuration accounts for Worker entry points and Cloudflare runtime\nmodules that static import analysis cannot discover on its own.\n",
  },
  {
    alias: "agentic-code-review:023-openssf-scorecard",
    target: "personal-knowledge-graph:052-openssf-scorecard",
    notes:
      "OpenSSF Scorecard audits the GitHub repository settings and supply-chain posture\naround the service. It remains a repository-level signal in the monorepo and\nwould become independently measurable if the project moved to its own repo.\n",
  },
  {
    alias: "agentic-code-review:024-gitleaks",
    target: "personal-knowledge-graph:053-gitleaks",
    notes:
      "Gitleaks protects the GitHub App private key, webhook secret, OpenRouter key,\nand Cloudflare credentials from accidental commits through the local hook and\nfull-history CI scan. That pre-publication gate is part of the service's\ndevelopment baseline.\n",
  },
  {
    alias: "agentic-code-review:025-typos",
    target: "personal-knowledge-graph:054-typos",
    notes:
      "typos checks the service's public PRD, ADRs, prompts, configuration, and source\ntext as a cheap deterministic gate. The shared allowlist keeps product and model\nnames from turning the check into noise.\n",
  },
  {
    alias: "agentic-code-review:026-code-rabbit",
    target: "personal-knowledge-graph:009-code-rabbit",
    notes:
      "This inherited decision records the product's starting point: automated review\ncreates a dependable second pair of eyes and reinforces a Pull Request workflow\nfor a solo developer. It provides historical product discovery while the core\narchitecture remains independent of CodeRabbit.\n",
  },
  {
    alias: "agentic-code-review:027-gemini-code-assist",
    target: "personal-knowledge-graph:041-gemini-code-assist",
    notes:
      "This inherited decision established the value of independent review harnesses\nand provider resilience. Its later deprecation motivated a portable review\nlayer whose continuity survives the loss of a free consumer integration.\n",
  },
  {
    alias: "agentic-code-review:028-greptile",
    target: "personal-knowledge-graph:042-greptile",
    notes:
      "Greptile added whole-codebase context and another review perspective. Its\nobserved model correlation and increasingly finite review capacity inform the\nproduct requirement to measure novelty and keep quotas outside the core\narchitecture.\n",
  },
  {
    alias: "agentic-code-review:029-codex-code-review",
    target: "personal-knowledge-graph:044-codex-code-review",
    notes:
      "Codex demonstrated the value of a focused, high-severity review pass that\nfollows repository-native guidance. It also reinforced that a useful reviewer\nbundled into a broader agent subscription still has mutable capacity and\nproduct boundaries.\n",
  },
  {
    alias: "agentic-code-review:030-qodo",
    target: "personal-knowledge-graph:045-qodo",
    notes:
      "Qodo was the final managed reviewer evaluated before building. Its trial showed\nthat a multi-agent review can be useful, while the inactive free integration\nand weaker value per dollar established the comparison the custom reviewer had\nto beat.\n",
  },
  {
    alias: "homelab:002-claude-code",
    target: "personal-knowledge-graph:012-claude-code",
    notes:
      "The Mac mini is the always-on host for Claude Code, so sessions can run\ncontinuously and be driven remotely over the tailnet. All the context from\nthe source decision, deep reasoning, repository-wide changes, autonomous\niteration, carries over; the home lab just provides the persistent execution\nenvironment that makes those properties useful from a phone.\n",
  },
  {
    alias: "homelab:003-codex",
    target: "personal-knowledge-graph:043-codex",
    notes:
      "The home hub holds two distinct Codex subscriptions, each with its own\nallowance. The hub provides the connected host that Codex mobile remote work\nneeds, and, as the source ADR notes, a persistent local environment beats\nre-bootstrapping a fresh cloud one. The same least-privilege and sandboxing\ndiscipline from the source decision applies doubly here, because the hub also\nholds personal photos and the backup drive.\n",
  },
  {
    alias: "homelab:008-dvc",
    target: "recipe-site:000-dvc",
    notes:
      "Applied to the lab: whichever machine runs batch jobs keeps local copies of\ndatasets on its own disk as a DVC remote, so those jobs read from a local\ncache instead of re-pulling over the network each time. The same principles,\ndataset hashes pinned to git commits, stage caching via `dvc repro`, and\nmetrics surfaced in PRs, govern how datasets are managed across the ML\npipelines (`ml-pipelines/recipe-parsing/`).\n",
  },
  {
    alias: "homelab:024-doppler-secrets",
    target: "personal-knowledge-graph:035-doppler",
    title: "ADR 024: Doppler for homelab secrets",
    notes:
      "The homelab adopts the existing Doppler decision. The rules below cover the\nparts that differ from the recipe stack.\n\n# Project and config\n\nKeep homelab secrets in the separate Doppler project `homelab`. Production\nworkloads use its `prd` config. This prevents Ansible and K3s credentials from\ngranting access to the recipe stack.\n\nHuman-run mise commands authenticate through the local Doppler CLI. A command\nthat needs secrets uses `doppler run --project homelab --config prd` and\nallowlists the names it needs.\n\nRun this non-secret check from an operator machine:\n\n```bash\nmise run //homelab:doppler-check\n```\n\n# Ansible\n\nAnsible reads secrets from the controller environment. Every task that consumes\na secret must set `no_log: true`. Do not copy a complete Doppler config to a\nmanaged host.\n\n# Unattended workloads\n\nGive each unattended workload a read-only Doppler service token scoped to one\nconfig. Never use a personal or CLI token. Doppler documents this boundary in\nits [service-token guidance](https://docs.doppler.com/docs/service-tokens).\n\nWhen the K3s pilot needs its first secret, install the\n[Doppler Kubernetes Operator](https://docs.doppler.com/docs/doppler-k8s-operator-syncing-secrets).\nBootstrap its token through a local mise command that does not print it, then\nuse namespace-scoped `DopplerSecret` resources. Workloads receive synchronized\nKubernetes Secrets, not the Doppler token.\n\n# Homelab-specific alternatives\n\n## Ansible Vault\n\n[Ansible Vault](https://docs.ansible.com/projects/ansible/latest/vault_guide/vault.html)\ncan encrypt variables and files kept with the playbooks. It fits Ansible, but\nit only protects data at rest. A new operator machine still needs the vault\npassword through a separate recovery path, and K3s workloads need another\nsecret-distribution system. Reject it as the homelab source of truth. Ansible\ntasks still need `no_log: true` whichever store supplies their secrets.\n\n## SOPS with age\n\n[SOPS](https://getsops.io/docs/) with age would keep encrypted values beside\nthe Ansible and K3s configuration. It would also allow recovery without\nDoppler once an operator restores the age identity. It needs its own key\ndistribution and recovery procedure, plus decryption plumbing for both\nAnsible and K3s. Reconsider it if dependence on Doppler becomes unacceptable.\n\n## Plain Kubernetes Secrets\n\nKubernetes Secret manifests encode values with base64; that does not make them\nsafe to commit. Creating them manually would also leave rotation and fresh\ncluster recovery outside the declarative configuration. Use Kubernetes Secrets\nas the runtime format produced by the Doppler operator, not as the source of\ntruth.\n\n## K3s secrets encryption\n\n[K3s secrets encryption](https://docs.k3s.io/security/secrets-encryption)\nprotects Secret data in the cluster datastore and its backups. It does not\ndecide where values originate, rotate application credentials, or supply\nAnsible. Enable it as a separate defence before sensitive workloads move to\nK3s. Keep Doppler as the source of truth.\n\n## Sealed Secrets\n\n[Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets) would make\nencrypted Secret manifests safe to store in Git. Its controller keeps the\nprivate sealing keys in the cluster, so disaster recovery must also back up\nand restore those keys. It does not supply Ansible. Reject it because the\nDoppler project already provides one source for both deployment paths.\n\n# Ente exception\n\nThe Ente CLI database at `~/.ente/ente-cli.db` remains outside Doppler. The\ndatabase stores an authenticated application session rather than a key-value\nsecret. Keep it local with mode `0600`, and recreate it through Ente's\ninteractive login on a replacement Mac.\n\n# Recovery and migration\n\nA new operator machine installs the Doppler CLI, signs in, checks out this\nrepository, and runs the access check above. Store Doppler account recovery\ncodes outside the homelab and repository.\n\nExisting Kubernetes Secrets keep workloads running during a Doppler outage.\nRotation and fresh cluster bootstrap wait for Doppler to recover. Keep current\ngitignored workload files until you have tested each Doppler consumer and its\nrollback path.\n",
  },
  {
    alias: "personal-knowledge-graph:048-sonarqube",
    target: "recipe-site:009-sonarqube",
  },
  {
    alias: "recipe-site:000-github-public-repo",
    target: "personal-knowledge-graph:000-github-public-repo",
  },
  {
    alias: "recipe-site:001-monorepo",
    target: "personal-knowledge-graph:001-monorepo",
  },
  {
    alias: "recipe-site:002-react",
    target: "personal-knowledge-graph:002-react",
  },
  {
    alias: "recipe-site:003-next-js",
    target: "personal-knowledge-graph:003-next-js",
  },
  {
    alias: "recipe-site:004-mise",
    target: "personal-knowledge-graph:004-mise",
  },
  {
    alias: "recipe-site:005-tailwindcss",
    target: "personal-knowledge-graph:005-tailwindcss",
  },
  {
    alias: "recipe-site:006-turbopack",
    target: "personal-knowledge-graph:006-turbopack",
  },
  {
    alias: "recipe-site:007-pnpm",
    target: "personal-knowledge-graph:007-pnpm",
  },
  {
    alias: "recipe-site:008-vitest",
    target: "personal-knowledge-graph:008-vitest",
  },
  {
    alias: "recipe-site:009-code-rabbit",
    target: "personal-knowledge-graph:009-code-rabbit",
  },
  {
    alias: "recipe-site:010-terraform",
    target: "personal-knowledge-graph:010-terraform",
  },
  {
    alias: "recipe-site:011-cloudflare-pages",
    target: "personal-knowledge-graph:011-cloudflare-pages",
  },
  {
    alias: "recipe-site:012-claude-code",
    target: "personal-knowledge-graph:012-claude-code",
  },
  {
    alias: "recipe-site:013-husky-precommit",
    target: "personal-knowledge-graph:014-husky-precommit",
  },
  {
    alias: "recipe-site:014-ssg",
    target: "personal-knowledge-graph:015-ssg",
    notes:
      "SSG is the right default for the current roadmap.\n\n* **Phase 1-2 (content-first)**: recipe pages, browsing, and search are fully static from build-time content.\n* **Phase 3 (light interactivity)**: filters, sorting, and saved preferences stay client-side without changing the rendering model.\n* **Phase 4+ (user-specific features)**: authenticated flows (for example collections, ratings, or collaborative editing) are likely the point where parts of the app should move to SSR/ISR or API-backed islands.\n\nKeep SSG until we need request-time personalization or frequent per-item mutations.\n",
  },
  {
    alias: "recipe-site:015-github-actions",
    target: "personal-knowledge-graph:016-github-actions",
  },
  {
    alias: "recipe-site:016-terraform-cloud",
    target: "personal-knowledge-graph:017-terraform-cloud",
  },
  {
    alias: "recipe-site:017-github-secrets",
    target: "personal-knowledge-graph:018-github-secrets",
  },
  {
    alias: "recipe-site:018-shadcn",
    target: "personal-knowledge-graph:019-shadcn",
  },
  {
    alias: "recipe-site:019-fuse-js",
    target: "personal-knowledge-graph:022-fuse-js",
  },
  {
    alias: "recipe-site:020-renovate",
    target: "personal-knowledge-graph:024-renovate",
  },
  {
    alias: "recipe-site:021-cloudflare-dns",
    target: "personal-knowledge-graph:028-cloudflare-dns",
  },
  {
    alias: "recipe-site:022-cloudflare-images",
    target: "personal-knowledge-graph:029-cloudflare-images",
  },
  {
    alias: "recipe-site:023-downgrade-cloudflare-tf",
    target: "personal-knowledge-graph:030-downgrade-cloudflare-tf",
  },
  {
    alias: "recipe-site:024-codeql",
    target: "personal-knowledge-graph:032-codeql",
  },
  {
    alias: "recipe-site:025-content-graph-indexes",
    target: "personal-knowledge-graph:033-content-graph-indexes",
    notes:
      'This acts as an interim, in-memory database-like layer over content files.\nIt keeps us SSG-friendly now while giving us flexible query capabilities as the product grows.\n\nRelevant entities are:\n\n* recipes\n* ingredients\n* tags/cuisines\n\nThe main value is consistent query composition (for example: "recipes by ingredient + cuisine", "related recipes", "ingredient usage") without introducing a real database yet.\n\nThis graph is distinct from the Personal Knowledge Graph and should remain recipe-domain only.\n',
  },
  {
    alias: "recipe-site:026-shortcut",
    target: "personal-knowledge-graph:034-shortcut",
  },
  {
    alias: "recipe-site:027-agpl-license",
    target: "personal-knowledge-graph:037-agpl-license",
  },
  {
    alias: "recipe-site:028-posthog-analytics",
    target: "personal-knowledge-graph:040-posthog-analytics",
  },
  {
    alias: "recipe-site:038-gemini-code-assist",
    target: "personal-knowledge-graph:041-gemini-code-assist",
  },
  {
    alias: "recipe-site:039-greptile",
    target: "personal-knowledge-graph:042-greptile",
  },
  {
    alias: "recipe-site:040-codex",
    target: "personal-knowledge-graph:043-codex",
  },
  {
    alias: "recipe-site:041-codex-code-review",
    target: "personal-knowledge-graph:044-codex-code-review",
  },
  {
    alias: "recipe-site:042-qodo",
    target: "personal-knowledge-graph:045-qodo",
  },
  {
    alias: "recipe-site:043-custom-agentic-code-review",
    target: "personal-knowledge-graph:046-custom-agentic-code-review",
  },
  {
    alias: "recipe-site:044-trivy",
    target: "personal-knowledge-graph:047-trivy",
    notes:
      "# Additional Context for Recipe Site\n\nThe recipe site extends the Trivy security scanning baseline to cover Neon Postgres infrastructure in addition to Cloudflare. Additional Terraform roots in the monorepo are covered by the same workspace-wide IaC scan (see [Personal Knowledge Graph ADR 047](/projects/personal-knowledge-graph/adrs/047-trivy)).\n\n## Neon-Specific IaC Scanning\n\nTrivy scans the Neon Terraform configurations for:\n\n* **Database access controls**: Overly permissive connection strings, exposed endpoints, or weak authentication configurations\n* **Backup and recovery**: Missing backup configurations that could lead to data loss\n* **Resource limits**: Misconfigurations that could lead to unexpected costs or resource exhaustion\n* **Network exposure**: Database endpoints inadvertently exposed to the public internet\n\n## Why This Matters for Recipe Site\n\nThe recipe site stores user data (accounts, households, saved recipes) in Neon Postgres. Misconfigurations in the database infrastructure pose:\n\n* **Data breach risk**: User account data could be exposed\n* **Financial risk**: Unauthorized database access could lead to unexpected Neon usage costs\n* **Availability risk**: Misconfigured resources could fail under load or during incident recovery\n\nTrivy provides automated detection of these misconfigurations before they reach production.\n\n# Consequences\n\n## Positive\n\n* **Database security posture**: Neon Postgres configurations are scanned for common misconfigurations alongside Cloudflare infrastructure\n* **Unified tooling**: Single security scanner covers both Cloudflare and Neon IaC, no need for separate database-specific scanners\n\n## Negative\n\n* **Neon-specific rule coverage**: Trivy's Terraform rules are generic and may not catch Neon-specific best practices or edge cases. Manual review of Neon configurations remains necessary.\n",
  },
  {
    alias: "recipe-site:046-zizmor",
    target: "personal-knowledge-graph:048-zizmor",
    notes:
      "# Additional Context for Recipe Site\n\nThe recipe site is where the workflow-security risk concentrates. The\npreview-environment workflows provision a per-PR Neon Postgres branch and an\nisolated Cloudflare Worker for the backend (`workers/recipe-api`), so they handle\nNeon and Cloudflare secrets on pull requests. That makes the trigger model,\n`GITHUB_ENV` use, and least-privilege permissions zizmor checks matter most for\nthe recipe site's CI.\n",
  },
  {
    alias: "recipe-site:055-tflint",
    target: "personal-knowledge-graph:050-tflint",
    notes:
      "# Additional Context for Recipe Site\n\nThe recipe site's infrastructure, Neon Postgres, Hyperdrive, and the\nrecipe-api/recipe-ingest Workers, is defined in the same `infra/public-platform/` Terraform\nroot, so it is covered by the same TFLint configuration and CI job (see\n[Personal Knowledge Graph ADR 051](/projects/personal-knowledge-graph/adrs/051-tflint)).\n\nThe hygiene rules matter most where the Terraform churns fastest, and that is\nthe recipe-site backend: preview environments, database branches, and Worker\nbindings have driven most recent infra changes. Unused declarations and\ndeprecated syntax left behind by that churn are exactly what the\n`recommended` preset flags.\n\n# Consequences\n\n## Positive\n\n* The most actively edited Terraform (recipe-site backend resources) gains a\n  blocking correctness lint on every PR, before the plan job needs secrets.\n\n## Negative\n\n* No Neon provider ruleset exists, so Neon-specific argument mistakes still\n  surface only at `terraform plan`.\n",
  },
  {
    alias: "recipe-site:056-knip",
    target: "personal-knowledge-graph:051-knip",
    notes:
      "# Additional Context for Recipe Site\n\nThe recipe pipeline is where Knip needed the most teaching, and where it then\nfound the most: its entry points are invisible to static import analysis, DVC\nstages in `ml-pipelines/*`, Cloudflare Pages Functions, worker scripts, and the\nviz tool's Vite app, so `knip.json` declares them explicitly (see\n[Personal Knowledge Graph ADR 052](/projects/personal-knowledge-graph/adrs/052-knip)). That\nconfiguration is what let Knip confidently identify a superseded 12-component\ncluster in the viz tool as dead, deleted on adoption.\n\nThe Workers also supplied the config's canonical false positive: workerd's\n`cloudflare:workers`/`cloudflare:workflows` virtual modules are provided by the\nruntime, not by any npm package, and Knip initially reported them as an\nunlisted `cloudflare` dependency. They are now declared in `knip.json`, so the\nunlisted-dependency check stays trustworthy for the case it exists to catch, a\nWorker importing a package that only another workspace declares, which would\nbreak on a lockfile reshuffle.\n\n# Consequences\n\n## Positive\n\n* Genuinely undeclared dependencies in deployed Workers now fail CI instead of\n  waiting for a lockfile change to expose them.\n* The recipe pipeline's non-obvious entry points (DVC stages, Pages Functions,\n  worker scripts) are documented in one config.\n\n## Negative\n\n* New pipeline stages, workers, or runtime-provided modules must be added to\n  `knip.json` when their usage isn't a plain import; the failure mode is a\n  loud false positive.\n",
  },
  {
    alias: "recipe-site:057-openssf-scorecard",
    target: "personal-knowledge-graph:052-openssf-scorecard",
    notes:
      "# Additional Context for Recipe Site\n\nScorecard audits the repository layer, so the recipe site inherits the same\nweekly posture check (see\n[Personal Knowledge Graph ADR 053](/projects/personal-knowledge-graph/adrs/053-openssf-scorecard)).\nThe stakes are higher on this side of the monorepo: the branch-protection,\ntoken-permission, and dangerous-workflow checks guard the path by which code\nreaches the deployed Workers and the Neon database, and the preview-environment\nworkflows handle real credentials on pull requests\n([ADR 046 zizmor](/projects/recipe-site/adrs/046-zizmor) covers their content;\nScorecard covers the settings around them).\n\n# Consequences\n\n## Positive\n\n* Regressions in the repo settings that gate deploy credentials (branch\n  protection, default token permissions) now surface within a week instead of\n  silently persisting.\n\n## Negative\n\n* Scorecard evaluates the repository as a whole; it cannot score the\n  recipe-site backend's posture separately from the static site's.\n",
  },
  {
    alias: "recipe-site:058-gitleaks",
    target: "personal-knowledge-graph:053-gitleaks",
    notes:
      "# Additional Context for Recipe Site\n\nThe recipe site concentrates the credentials worth stealing: Neon Postgres\nconnection strings, better-auth secrets, OAuth client secrets (Google/GitHub\nlogin), OpenRouter API keys, and Cloudflare tokens for the Workers. Most of\nthese are exactly the shapes GitHub's provider-pattern scanning is weakest on. A Postgres URL\nwith an inline password or a better-auth signing secret has no\nvendor-recognisable format, but does trip gitleaks' generic and entropy rules\n(see [Personal Knowledge Graph ADR 054](/projects/personal-knowledge-graph/adrs/054-gitleaks)).\n\nThe financial-risk framing from\n[ADR 035 (application security baseline)](/projects/recipe-site/adrs/035-application-security-baseline)\napplies directly: a leaked OpenRouter key or database URL converts to\nunauthorized usage cost or a data breach of user accounts, so blocking the\ncommit beats rotating after disclosure.\n\n# Consequences\n\n## Positive\n\n* Database URLs and auth secrets, the credential shapes vendor-pattern\n  scanning misses, are checked before a commit exists, on the side of the\n  monorepo where they circulate most (local `.dev.vars`, seeded QA scenarios,\n  integration-test configs).\n\n## Negative\n\n* Seeded QA fixtures and example configs are the likeliest source of false\n  positives; expect the first `.gitleaks.toml` allowlist entries to come from\n  the recipe-site test surface.\n",
  },
  {
    alias: "recipe-site:059-typos",
    target: "personal-knowledge-graph:054-typos",
    notes:
      '# Additional Context for Recipe Site\n\nThe recipe site adds the content type where spelling errors are most\nuser-visible: recipe titles, ingredient names, and instructions, rendered both\non the site and in the schema.org Recipe JSON twins consumed by other tools\n(see [Personal Knowledge Graph ADR 055](/projects/personal-knowledge-graph/adrs/055-typos)).\nIngredient vocabulary is also exactly where dictionary-based checkers drown in\nnoise, cuisine terms, brand names, non-English loanwords, which is why the\nknown-misspellings design matters doubly here.\n\nThe recipe-parsing package also demonstrates the config\'s judgement calls: its\ndiagnostics use "unparseable", a legitimate word typos\' dictionary would\n"correct", now allowlisted in `_typos.toml` rather than rewritten in\nuser-facing strings.\n\n# Consequences\n\n## Positive\n\n* Typos in recipe content are caught before they ship to the site and its\n  machine-readable JSON twins.\n\n## Negative\n\n* Loanword-heavy recipe vocabulary may occasionally need `_typos.toml`\n  entries as content grows.\n',
  },
  {
    alias: "work-graph:007-shortcut",
    target: "personal-knowledge-graph:034-shortcut",
    notes:
      "Shortcut remains the authoritative tracker outside any explicitly bounded Work\nGraph pilot while Work Graph proves that it can replace the existing capture,\nranking, and review workflow. Inheriting the decision here gives Work Graph\nownership of that eventual cutover without pretending it has already happened.\n",
  },
  // Canonical URLs retained after compacting project-local ADR sequences.
  {
    alias: "agentic-code-review:031-custom-agentic-code-review",
    target: "agentic-code-review:000-custom-agentic-code-review",
  },
  {
    alias: "agentic-code-review:032-stateful-ai-code-review",
    target: "agentic-code-review:001-stateful-ai-code-review",
  },
  {
    alias: "agentic-code-review:033-duckdb-ai-review-scorecard",
    target: "agentic-code-review:002-duckdb-ai-review-scorecard",
  },
  {
    alias: "homelab:004-grok-build",
    target: "homelab:002-grok-build",
  },
  {
    alias: "homelab:005-opencode",
    target: "homelab:003-opencode",
  },
  {
    alias: "homelab:006-t3-code",
    target: "homelab:004-t3-code",
  },
  {
    alias: "homelab:007-ente-photo-backup",
    target: "homelab:005-ente-photo-backup",
  },
  {
    alias: "homelab:009-netdata",
    target: "homelab:006-netdata",
  },
  {
    alias: "homelab:010-nixos-gpu-worker",
    target: "homelab:007-nixos-gpu-worker",
  },
  {
    alias: "homelab:011-jellyfin",
    target: "homelab:008-jellyfin",
  },
  {
    alias: "homelab:012-cups",
    target: "homelab:009-cups",
  },
  {
    alias: "homelab:013-amazon-echo",
    target: "homelab:010-amazon-echo",
  },
  {
    alias: "homelab:014-basic-memory-silverbullet-agentic-knowledge-base",
    target: "homelab:011-basic-memory-silverbullet-agentic-knowledge-base",
  },
  {
    alias: "homelab:015-phone-device-lab",
    target: "homelab:012-phone-device-lab",
  },
  {
    alias: "homelab:016-media-automation-arr-stack",
    target: "homelab:013-media-automation-arr-stack",
  },
  {
    alias: "homelab:017-prowlarr-indexer-management",
    target: "homelab:014-prowlarr-indexer-management",
  },
  {
    alias: "homelab:018-single-containerized-torrent-client",
    target: "homelab:015-single-containerized-torrent-client",
  },
  {
    alias: "homelab:019-recyclarr-trash-guides",
    target: "homelab:016-recyclarr-trash-guides",
  },
  {
    alias: "homelab:020-vpn-gated-stack",
    target: "homelab:017-vpn-gated-stack",
  },
  {
    alias: "homelab:021-trakt-watchlist",
    target: "homelab:018-trakt-watchlist",
  },
  {
    alias: "homelab:022-ansible-k3s-migration-bridge",
    target: "homelab:019-ansible-k3s-migration-bridge",
  },
  {
    alias: "homelab:023-k3s-declarative-workloads",
    target: "homelab:020-k3s-declarative-workloads",
  },
  {
    alias: "homelab:025-cloud-remote-development-plane",
    target: "homelab:021-cloud-remote-development-plane",
  },
  {
    alias: "personal-knowledge-graph:049-zizmor",
    target: "personal-knowledge-graph:048-zizmor",
  },
  {
    alias: "personal-knowledge-graph:050-simple-icons-and-svgl",
    target: "personal-knowledge-graph:049-simple-icons-and-svgl",
  },
  {
    alias: "personal-knowledge-graph:051-tflint",
    target: "personal-knowledge-graph:050-tflint",
  },
  {
    alias: "personal-knowledge-graph:052-knip",
    target: "personal-knowledge-graph:051-knip",
  },
  {
    alias: "personal-knowledge-graph:053-openssf-scorecard",
    target: "personal-knowledge-graph:052-openssf-scorecard",
  },
  {
    alias: "personal-knowledge-graph:054-gitleaks",
    target: "personal-knowledge-graph:053-gitleaks",
  },
  {
    alias: "personal-knowledge-graph:055-typos",
    target: "personal-knowledge-graph:054-typos",
  },
  {
    alias: "personal-knowledge-graph:056-stateful-ai-code-review",
    target: "personal-knowledge-graph:055-stateful-ai-code-review",
  },
  {
    alias: "personal-knowledge-graph:057-food-ontology-alignment",
    target: "personal-knowledge-graph:056-food-ontology-alignment",
  },
  {
    alias: "personal-knowledge-graph:058-project-pitch-decks",
    target: "personal-knowledge-graph:057-project-pitch-decks",
  },
  {
    alias: "personal-knowledge-graph:059-temporal-platform-layers",
    target: "personal-knowledge-graph:058-temporal-platform-layers",
  },
  {
    alias: "personal-knowledge-graph:060-product-decision-records",
    target: "personal-knowledge-graph:059-product-decision-records",
  },
  {
    alias: "recipe-site:029-dvc",
    target: "recipe-site:000-dvc",
  },
  {
    alias: "recipe-site:030-cooklang",
    target: "recipe-site:001-cooklang",
  },
  {
    alias: "recipe-site:031-openrouter",
    target: "recipe-site:002-openrouter",
  },
  {
    alias: "recipe-site:032-better-auth",
    target: "recipe-site:003-better-auth",
  },
  {
    alias: "recipe-site:033-backend-platform-for-authenticated-features",
    target: "recipe-site:004-backend-platform-for-authenticated-features",
  },
  {
    alias: "recipe-site:034-authorization-model",
    target: "recipe-site:005-authorization-model",
  },
  {
    alias: "recipe-site:035-application-security-baseline",
    target: "recipe-site:006-application-security-baseline",
  },
  {
    alias: "recipe-site:036-google-oidc-login",
    target: "recipe-site:007-google-oidc-login",
  },
  {
    alias: "recipe-site:037-github-oauth-login",
    target: "recipe-site:008-github-oauth-login",
  },
  {
    alias: "recipe-site:045-sonarqube",
    target: "recipe-site:009-sonarqube",
  },
  {
    alias: "recipe-site:047-posthog-logs",
    target: "recipe-site:010-posthog-logs",
  },
  {
    alias: "recipe-site:048-cloudflare-observability-destinations",
    target: "recipe-site:011-cloudflare-observability-destinations",
  },
  {
    alias: "recipe-site:049-cloudflare-workflows-recipe-ingestion",
    target: "recipe-site:012-cloudflare-workflows-recipe-ingestion",
  },
  {
    alias: "recipe-site:050-cloudflare-access-preview-gates",
    target: "recipe-site:013-cloudflare-access-preview-gates",
  },
  {
    alias: "recipe-site:051-neon-database-snapshots-and-backups",
    target: "recipe-site:014-neon-database-snapshots-and-backups",
  },
  {
    alias: "recipe-site:051-relational-notification-events",
    target: "recipe-site:015-relational-notification-events",
  },
  {
    alias: "recipe-site:052-committed-postgres-migrations",
    target: "recipe-site:016-committed-postgres-migrations",
  },
  {
    alias:
      "recipe-site:053-fresh-migration-baseline-and-isolated-preview-database-project",
    target:
      "recipe-site:017-fresh-migration-baseline-and-isolated-preview-database-project",
  },
  {
    alias: "recipe-site:054-tanstack-query-for-client-server-state",
    target: "recipe-site:018-tanstack-query-for-client-server-state",
  },
  {
    alias: "recipe-site:061-agent-auth",
    target: "recipe-site:019-agent-auth",
  },
  {
    alias: "recipe-site:062-direct-otlp-export-to-posthog",
    target: "recipe-site:020-direct-otlp-export-to-posthog",
  },
  {
    alias: "recipe-site:063-posthog-alerting-and-slack",
    target: "recipe-site:021-posthog-alerting-and-slack",
  },
  {
    alias: "recipe-site:064-realtime-household-collaboration",
    target: "recipe-site:022-realtime-household-collaboration",
  },
  {
    alias: "recipe-site:065-spectral",
    target: "recipe-site:023-spectral",
  },
  {
    alias: "recipe-site:066-batch-recipe-import-staging",
    target: "recipe-site:024-batch-recipe-import-staging",
  },
  {
    alias:
      "recipe-site:067-versioned-ingredient-density-catalog-and-source-ingestion",
    target:
      "recipe-site:025-versioned-ingredient-density-catalog-and-source-ingestion",
  },
  {
    alias: "work-graph:008-authoritative-work-graph",
    target: "work-graph:007-authoritative-work-graph",
  },
  {
    alias: "work-graph:009-github-delivery-evidence-ingestion",
    target: "work-graph:008-github-delivery-evidence-ingestion",
  },
  {
    alias: "work-graph:010-observed-evidence-before-automatic-release",
    target: "work-graph:009-observed-evidence-before-automatic-release",
  },
] satisfies readonly LegacyADRAlias[];
