import { z } from "zod";
import { ADRRefSchema } from "../slugs";

export const CATALOG_SCHEMA_VERSION = 1 as const;

export const CatalogRecordKindSchema = z.enum([
  "project",
  "system",
  "component",
  "api",
  "workload",
  "resource",
  "capability",
  "slot",
  "technology",
  "package",
  "artifact",
  "environment",
  "decision",
  "evidence",
  "adoption",
  "override",
]);

export type CatalogRecordKind = z.infer<typeof CatalogRecordKindSchema>;

const CATALOG_ID_PATTERN =
  /^(project|system|component|api|workload|resource|capability|slot|technology|package|artifact|environment|decision|evidence|adoption|override):[a-z0-9][a-z0-9./:@+-]*$/;

export const CatalogIdSchema = z
  .string()
  .regex(CATALOG_ID_PATTERN, "Expected a typed, lowercase catalog ID");

export type CatalogId = z.infer<typeof CatalogIdSchema>;

export const CatalogRelationTypeSchema = z.enum([
  "part_of",
  "depends_on",
  "provides",
  "uses",
  "deployed_as",
  "produces",
  "selects",
  "decided_by",
  "supported_by",
  "adopts",
  "overrides",
]);

export type CatalogRelationType = z.infer<typeof CatalogRelationTypeSchema>;

export const CatalogRelationSchema = z.object({
  type: CatalogRelationTypeSchema,
  target: CatalogIdSchema,
});

const PackageUrlSchema = z
  .string()
  .regex(
    /^pkg:[a-z][a-z0-9.+-]*\/[A-Za-z0-9._~%+-]+(?:\/[A-Za-z0-9._~%+-]+)*@[A-Za-z0-9._~%:+-]+(?:\?[A-Za-z0-9._~%=&+-]+)?(?:#[A-Za-z0-9._~%/+-]+)?$/,
    "Expected a canonical, versioned Package URL",
  )
  .refine(
    (value) =>
      value.replaceAll(/%[0-9a-fA-F]{2}/g, (percentEscape) =>
        percentEscape.toUpperCase(),
      ) === value,
    { message: "Package URL percent escapes must use uppercase hex digits" },
  );

const PackageExternalIdSchema = z.object({
  kind: z.literal("package-url"),
  value: PackageUrlSchema,
});

const ProviderExternalIdSchema = z.object({
  kind: z.literal("provider"),
  value: z.string().min(1),
});

const KubernetesExternalIdSchema = z.object({
  kind: z.literal("kubernetes"),
  apiGroup: z.string().min(1),
  resource: z.string().min(1),
  namespace: z.string().min(1),
  name: z.string().min(1),
  uid: z.string().min(1).optional(),
});

export const CatalogExternalIdSchema = z.discriminatedUnion("kind", [
  PackageExternalIdSchema,
  ProviderExternalIdSchema,
  KubernetesExternalIdSchema,
]);

export const OciDescriptorSchema = z.object({
  repository: z.string().min(1),
  mediaType: z
    .string()
    .regex(/^[a-z0-9][a-z0-9!#$&^_.+-]+\/[a-z0-9][a-z0-9!#$&^_.+-]+$/),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  size: z.number().int().nonnegative(),
  artifactType: z.string().min(1).optional(),
  subject: CatalogIdSchema.optional(),
  referrers: z.array(CatalogIdSchema).default([]),
});

const PROJECT_OWNED_KINDS = new Set<CatalogRecordKind>([
  "system",
  "component",
  "api",
  "workload",
  "resource",
  "package",
  "artifact",
  "environment",
  "adoption",
  "override",
]);

const CatalogRecordFieldsSchema = z.object({
  id: CatalogIdSchema,
  kind: CatalogRecordKindSchema,
  name: z.string().min(1),
  project: CatalogIdSchema.optional(),
  sourcePaths: z
    .array(
      z
        .string()
        .min(1)
        .refine(
          (value) => !value.startsWith("/") && !value.split("/").includes(".."),
          "Source paths must be repository-relative and cannot traverse parents",
        ),
    )
    .default([]),
  relations: z.array(CatalogRelationSchema).default([]),
  decisionRefs: z.array(ADRRefSchema).default([]),
  aliases: z.array(CatalogIdSchema).default([]),
  externalIds: z.array(CatalogExternalIdSchema).default([]),
  version: z.string().min(1).optional(),
  oci: OciDescriptorSchema.optional(),
});

type CatalogRecordInput = z.infer<typeof CatalogRecordFieldsSchema>;

function addCatalogIssue(context: z.RefinementCtx, message: string): void {
  context.addIssue({ code: "custom", message });
}

function validateRecordIdentity(
  record: CatalogRecordInput,
  context: z.RefinementCtx,
): void {
  const idKind = record.id.slice(0, record.id.indexOf(":"));
  if (idKind !== record.kind) {
    addCatalogIssue(
      context,
      `Catalog ID '${record.id}' does not match kind '${record.kind}'`,
    );
  }
  for (const alias of record.aliases) {
    if (!alias.startsWith(`${record.kind}:`)) {
      addCatalogIssue(
        context,
        `Alias '${alias}' must preserve kind '${record.kind}'`,
      );
    }
  }
}

function validateProjectOwnership(
  record: CatalogRecordInput,
  context: z.RefinementCtx,
): void {
  if (!PROJECT_OWNED_KINDS.has(record.kind)) return;
  if (!record.project?.startsWith("project:")) {
    addCatalogIssue(
      context,
      `Catalog record '${record.id}' requires a project owner`,
    );
    return;
  }
  const projectSlug = record.project.slice("project:".length);
  const idPath = record.id.slice(record.id.indexOf(":") + 1);
  if (!idPath.startsWith(`${projectSlug}/`)) {
    addCatalogIssue(
      context,
      `Catalog record '${record.id}' must use its owning project in the ID`,
    );
  }
}

function validateExternalCoordinates(
  record: CatalogRecordInput,
  context: z.RefinementCtx,
): void {
  const purlCount = record.externalIds.filter(
    (externalId) => externalId.kind === "package-url",
  ).length;
  if (record.kind === "package" && (!record.version || purlCount !== 1)) {
    addCatalogIssue(
      context,
      `Package '${record.id}' requires a version and exactly one Package URL`,
    );
  }
  const packageUrl = record.externalIds.find(
    (externalId) => externalId.kind === "package-url",
  );
  if (
    record.kind === "package" &&
    record.version &&
    packageUrl &&
    packageUrl.value.split("@").at(-1)?.split(/[?#]/)[0] !== record.version
  ) {
    addCatalogIssue(
      context,
      `Package '${record.id}' version does not match its Package URL`,
    );
  }
  if (record.kind !== "package" && purlCount > 0) {
    addCatalogIssue(context, "Only package records may declare a Package URL");
  }
  if (record.kind === "artifact" && !record.oci) {
    addCatalogIssue(
      context,
      `Artifact '${record.id}' requires a complete OCI descriptor`,
    );
  }
  if (record.kind !== "artifact" && record.oci) {
    addCatalogIssue(
      context,
      "Only artifact records may declare an OCI descriptor",
    );
  }
}

export const CatalogRecordSchema = CatalogRecordFieldsSchema.superRefine(
  (record, context) => {
    validateRecordIdentity(record, context);
    validateProjectOwnership(record, context);
    validateExternalCoordinates(record, context);
  },
);

export type CatalogRecord = z.infer<typeof CatalogRecordSchema>;

const CatalogManifestFieldsSchema = z.object({
  records: z.array(CatalogRecordSchema).default([]),
});

const RELATION_ENDPOINTS: Record<
  CatalogRelationType,
  { from: ReadonlySet<CatalogRecordKind>; to: ReadonlySet<CatalogRecordKind> }
> = {
  part_of: {
    from: new Set([
      "system",
      "component",
      "api",
      "workload",
      "resource",
      "package",
      "artifact",
      "environment",
      "slot",
    ]),
    to: new Set(["project", "system", "component", "capability"]),
  },
  depends_on: {
    from: new Set(["system", "component", "api", "workload", "resource"]),
    to: new Set(["system", "component", "api", "workload", "resource"]),
  },
  provides: {
    from: new Set(["system", "component", "workload"]),
    to: new Set(["api"]),
  },
  uses: {
    from: new Set(["system", "component", "workload", "resource", "package"]),
    to: new Set(["component", "api", "resource", "package", "technology"]),
  },
  deployed_as: {
    from: new Set(["component"]),
    to: new Set(["workload"]),
  },
  produces: {
    from: new Set(["component", "workload"]),
    to: new Set(["package", "artifact"]),
  },
  selects: {
    from: new Set(["capability", "slot", "override"]),
    to: new Set(["technology"]),
  },
  decided_by: {
    from: new Set(CatalogRecordKindSchema.options),
    to: new Set(["decision"]),
  },
  supported_by: {
    from: new Set(["decision", "evidence"]),
    to: new Set(["evidence", "decision"]),
  },
  adopts: {
    from: new Set(["adoption"]),
    to: new Set(["capability", "slot"]),
  },
  overrides: {
    from: new Set(["override"]),
    to: new Set(["capability", "slot"]),
  },
};

function catalogIdKind(id: string): CatalogRecordKind {
  return id.slice(0, id.indexOf(":")) as CatalogRecordKind;
}

function collectCatalogIds(
  records: CatalogRecord[],
  context: z.RefinementCtx,
): { canonicalIds: Set<string>; aliases: Set<string> } {
  const canonicalIds = new Set<string>();
  const aliases = new Set<string>();
  for (const record of records) {
    if (canonicalIds.has(record.id)) {
      addCatalogIssue(context, `Duplicate catalog ID '${record.id}'`);
    }
    canonicalIds.add(record.id);
    for (const alias of record.aliases) {
      if (aliases.has(alias)) {
        addCatalogIssue(context, `Duplicate catalog alias '${alias}'`);
      }
      aliases.add(alias);
    }
  }
  return { canonicalIds, aliases };
}

function validateAliasCollisions(
  canonicalIds: ReadonlySet<string>,
  aliases: ReadonlySet<string>,
  context: z.RefinementCtx,
): void {
  for (const alias of aliases) {
    if (canonicalIds.has(alias)) {
      addCatalogIssue(
        context,
        `Catalog alias '${alias}' is also a canonical ID`,
      );
    }
  }
}

function validateRelationEndpoints(
  records: CatalogRecord[],
  context: z.RefinementCtx,
): void {
  for (const record of records) {
    for (const relation of record.relations) {
      const endpoints = RELATION_ENDPOINTS[relation.type];
      const targetKind = catalogIdKind(relation.target);
      if (endpoints.from.has(record.kind) && endpoints.to.has(targetKind)) {
        continue;
      }
      addCatalogIssue(
        context,
        `Relation '${relation.type}' cannot connect '${record.kind}' to '${targetKind}'`,
      );
    }
  }
}

function findContainmentCycle(records: CatalogRecord[]): string[] | undefined {
  const containment = new Map<string, string[]>();
  for (const record of records) {
    containment.set(
      record.id,
      record.relations
        .filter((relation) => relation.type === "part_of")
        .map((relation) => relation.target),
    );
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];
  const visit = (id: string): string[] | undefined => {
    if (visiting.has(id)) {
      const start = path.indexOf(id);
      return [...path.slice(start), id];
    }
    if (visited.has(id)) return undefined;
    visiting.add(id);
    path.push(id);
    for (const target of containment.get(id) ?? []) {
      const cycle = visit(target);
      if (cycle) return cycle;
    }
    path.pop();
    visiting.delete(id);
    visited.add(id);
    return undefined;
  };
  for (const id of containment.keys()) {
    const cycle = visit(id);
    if (cycle) return cycle;
  }
  return undefined;
}

export const CatalogManifestSchema = CatalogManifestFieldsSchema.superRefine(
  (manifest, context) => {
    const { canonicalIds, aliases } = collectCatalogIds(
      manifest.records,
      context,
    );
    validateAliasCollisions(canonicalIds, aliases, context);
    validateRelationEndpoints(manifest.records, context);
    const cycle = findContainmentCycle(manifest.records);
    if (cycle) {
      addCatalogIssue(
        context,
        `Catalog containment cycle: ${cycle.join(" -> ")}`,
      );
    }
  },
);

export type CatalogManifest = z.infer<typeof CatalogManifestSchema>;

export interface CatalogReferenceIssue {
  recordId: CatalogId;
  field: "project" | "relations" | "oci.subject" | "oci.referrers";
  target: CatalogId;
}

export function findBrokenCatalogReferences(
  manifest: CatalogManifest,
  derivedIds: ReadonlySet<string>,
): CatalogReferenceIssue[] {
  const knownIds = new Set<string>([
    ...derivedIds,
    ...manifest.records.map((record) => record.id),
    ...manifest.records.flatMap((record) => record.aliases),
  ]);
  const issues: CatalogReferenceIssue[] = [];
  const check = (
    recordId: CatalogId,
    field: CatalogReferenceIssue["field"],
    target: CatalogId | undefined,
  ) => {
    if (target && !knownIds.has(target))
      issues.push({ recordId, field, target });
  };
  for (const record of manifest.records) {
    check(record.id, "project", record.project);
    for (const relation of record.relations) {
      check(record.id, "relations", relation.target);
    }
    check(record.id, "oci.subject", record.oci?.subject);
    for (const referrer of record.oci?.referrers ?? []) {
      check(record.id, "oci.referrers", referrer);
    }
  }
  return issues;
}

export function catalogIdToUri(id: CatalogId): string {
  const [kind, ...path] = id.split(":");
  return `https://robbiepalmer.me/id/${kind}/${path.join(":")}`;
}
