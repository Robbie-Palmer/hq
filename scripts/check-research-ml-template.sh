#!/usr/bin/env bash
set -euo pipefail

repository_root="$(git rev-parse --show-toplevel)"
scratch_root="$(mktemp -d)"
trap 'rm -rf -- "$scratch_root"' EXIT

template_root="$scratch_root/template"
render_root="$scratch_root/render"
component_root="$render_root/ml-pipelines/research-template-fixture"
mkdir -p "$template_root" "$render_root/ml-pipelines"
cp "$repository_root/copier.yml" "$template_root/copier.yml"
cp -R "$repository_root/copier-templates" "$template_root/copier-templates"
cp -R "$repository_root/ml-pipelines/dvc-tool" "$render_root/ml-pipelines/dvc-tool"
cp -R "$repository_root/ml-pipelines/scripts" "$render_root/ml-pipelines/scripts"
git -C "$render_root" init --quiet --initial-branch=main

cat >"$scratch_root/answers.yaml" <<'YAML'
project_id: research-template-fixture
blueprint:
  schema_version: 4
  profile_schema_version: 3
  effective_at: "2026-11-06T00:00:00Z"
  project:
    id: research-template-fixture
    stable_id: project:research-template-fixture
    name: Research template fixture
    kind: data-pipeline
    published: false
  components:
    - id: research-template-fixture
      stable_id: component:research-template-fixture/research-template-fixture
      name: Research template fixture
      kind: python-pipeline
      path: ml-pipelines/research-template-fixture
      template_ownership: structure-only
      tasks: []
    - id: support-contract
      stable_id: component:research-template-fixture/support-contract
      name: Support contract
      kind: typescript-package
      path: packages/support-contract
      template_ownership: structure-only
      tasks: []
  repository_paths:
    copier_answers: .copier/projects/research-template-fixture.yml
    project_index: ui/content/projects/research-template-fixture/index.mdx
    architecture_decisions: ui/content/projects/research-template-fixture/adrs/{sequence}-{slug}.mdx
    product_decisions: ui/content/projects/research-template-fixture/pdrs/{sequence}-{slug}.mdx
  selections: []
  catalog:
    system:
      id: system:research-template-fixture/data-pipeline
      kind: system
      project: project:research-template-fixture
    components: []
  ownership:
    owned_paths:
      - ml-pipelines/research-template-fixture
      - packages/support-contract
    structural_edits: []
  nix:
    enabled: false
  opentelemetry:
    enabled: false
  fulfillment_checkpoints: []
  rollout:
    operational_checks: []
    migration_checkpoints: []
YAML

copier copy \
  --data-file "$scratch_root/answers.yaml" \
  --defaults \
  --overwrite \
  --skip-tasks \
  "$template_root" \
  "$render_root"

export MISE_TRUSTED_CONFIG_PATHS="$render_root"
mise --cd "$component_root" run lock
mise --cd "$component_root" run ci

test -f "$component_root/uv.lock"
test -f "$component_root/dvc.lock"
test -f "$component_root/.dvcignore"
test -f "$component_root/coverage.xml"
test -f "$component_root/metrics/metrics.json"
test -f "$component_root/outputs/provenance.json"
grep -Fqx '    remote = r2' "$component_root/.dvc/config"
grep -Fqx '    url = s3://dvc/research-template-fixture' "$component_root/.dvc/config"
grep -Fqx '    endpointurl = https://dcd7cd68dd892d610267ded6b1af567b.r2.cloudflarestorage.com' "$component_root/.dvc/config"
test -f "$render_root/packages/support-contract/generated-component.yaml"
test -f "$render_root/packages/support-contract/mise.toml"

provenance_before="$(sha256sum "$component_root/outputs/provenance.json")"
jq '.local_decisions = ["research-template-fixture:001-local-decision"]' \
  "$component_root/manifests/decision-provenance.json" \
  >"$scratch_root/decision-provenance.json"
mv "$scratch_root/decision-provenance.json" \
  "$component_root/manifests/decision-provenance.json"
mise --cd "$component_root" run repro
mise --cd "$component_root" run verify
provenance_after="$(sha256sum "$component_root/outputs/provenance.json")"
test "$provenance_before" != "$provenance_after"
