import {
  jsonValueSchema,
  projectPlanSchema,
  type JsonValue,
  type ProjectPlan,
  type TemplateSource,
} from "./contracts.js";
import type {
  ProjectProfileContracts,
  ResolvedProjectBlueprint,
} from "./profile.js";

const NODE_COMPONENT_KINDS = new Set([
  "ui",
  "worker",
  "typescript-package",
]);

export type PinnedTemplateSource = TemplateSource & { readonly revision: string };

function jsonRecord(value: unknown, label: string): Record<string, JsonValue> {
  const parsed = jsonValueSchema.parse(value);
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed;
}

function catalogRecords(
  contracts: ProjectProfileContracts,
): readonly Record<string, JsonValue>[] {
  const catalog = jsonRecord(
    contracts.platform.catalog ?? {},
    "platform catalog",
  );
  const records = catalog.records ?? [];
  if (!Array.isArray(records)) {
    throw new Error("platform catalog records must be an array");
  }
  return records.map((record) => jsonRecord(record, "platform catalog record"));
}

function recordById(
  records: readonly Record<string, JsonValue>[],
  id: string,
): Record<string, JsonValue> | null {
  return records.find((record) => record.id === id) ?? null;
}

export function requirePinnedTemplate(
  template: TemplateSource,
): PinnedTemplateSource {
  if (!template.revision) {
    throw new Error(
      `Template '${template.id}' must declare an immutable revision for profile generation`,
    );
  }
  return { ...template, revision: template.revision };
}

export function projectPlanFromBlueprint(input: {
  readonly blueprint: ResolvedProjectBlueprint;
  readonly contracts: ProjectProfileContracts;
  readonly template: PinnedTemplateSource;
}): ProjectPlan {
  const { blueprint, contracts, template } = input;
  const existingProject = contracts.layout.projects.find(
    ({ id }) => id === blueprint.project.id,
  );
  const expectedProject = existingProject
    ? {
        id: existingProject.id,
        kind: existingProject.kind,
        catalog_record: existingProject.catalog_record,
      }
    : null;
  const existingCatalog = catalogRecords(contracts);
  const catalogTargets = [
    blueprint.catalog.system,
    ...blueprint.catalog.components,
  ].map((record) => jsonRecord(record, "resolved catalog record"));
  const componentRoots = blueprint.components.map(({ path }) => path);
  const nodeWorkspaceRoots = blueprint.components
    .filter(({ kind }) => NODE_COMPONENT_KINDS.has(kind))
    .map(({ path }) => path);

  return projectPlanSchema.parse({
    schema_version: 1,
    project_id: blueprint.project.id,
    template_id: template.id,
    template_revision: template.revision,
    answers: {
      project_id: blueprint.project.id,
      blueprint: jsonValueSchema.parse(blueprint),
    },
    owned_paths: blueprint.ownership.owned_paths,
    shared_manifest_edits: [
      ...componentRoots.map((value) => ({ kind: "mise_config_root", value })),
      ...nodeWorkspaceRoots.map((value) => ({
        kind: "pnpm_workspace_package",
        value,
      })),
      {
        kind: "repository_project",
        value: {
          id: blueprint.project.id,
          kind: blueprint.project.kind,
          catalog_record: String(blueprint.catalog.system.id),
        },
        expected: expectedProject,
      },
      ...catalogTargets.map((value) => ({
        kind: "catalog_record",
        value,
        expected: recordById(existingCatalog, String(value.id)),
      })),
    ],
  });
}
