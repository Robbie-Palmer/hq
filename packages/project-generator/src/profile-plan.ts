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

export type PinnedTemplateSource = TemplateSource & { readonly revision: string };

function jsonRecord(value: unknown, label: string): Record<string, JsonValue> {
  const parsed = jsonValueSchema.parse(value);
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new TypeError(`${label} must be a JSON object`);
  }
  return parsed;
}

function recordId(record: Record<string, JsonValue>, label: string): string {
  if (typeof record.id !== "string" || record.id.length === 0) {
    throw new TypeError(`${label} must have a non-empty string id`);
  }
  return record.id;
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
    throw new TypeError("platform catalog records must be an array");
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
  const terraformRoots = blueprint.components.filter(
    ({ kind }) => kind === "terraform-root",
  );
  if (terraformRoots.length > 1) {
    throw new Error(
      `The monorepo project template supports one terraform-root component, found ${terraformRoots.length}`,
    );
  }
  const published = blueprint.project.published !== false;
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
  const systemCatalogRecord = jsonRecord(
    blueprint.catalog.system,
    "resolved system catalog record",
  );
  const catalogTargets = [
    systemCatalogRecord,
    ...blueprint.catalog.components,
  ].map((record) => jsonRecord(record, "resolved catalog record"));
  const componentKinds = new Map(
    contracts.layout.component_kinds.map((kind) => [kind.id, kind]),
  );
  const registeredRoots = (field: "mise_config_root" | "pnpm_workspace_package") =>
    blueprint.components
      .filter(({ kind }) => componentKinds.get(kind)?.[field] === true)
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
      ...registeredRoots("mise_config_root").map((value) => ({
        kind: "mise_config_root",
        value,
      })),
      ...registeredRoots("pnpm_workspace_package").map((value) => ({
        kind: "pnpm_workspace_package",
        value,
      })),
      ...(published
        ? [
            {
              kind: "repository_project" as const,
              value: {
                id: blueprint.project.id,
                kind: blueprint.project.kind,
                catalog_record: recordId(
                  systemCatalogRecord,
                  "resolved system catalog record",
                ),
              },
              expected: expectedProject,
            },
            ...catalogTargets.map((value) => ({
              kind: "catalog_record" as const,
              value,
              expected: recordById(
                existingCatalog,
                recordId(value, "resolved catalog record"),
              ),
            })),
          ]
        : []),
    ],
  });
}
