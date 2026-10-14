import { describe, expect, it } from "vitest";
import {
  buildCatalogDocument,
  CatalogManifestSchema,
  CatalogRecordSchema,
  catalogIdToUri,
  findBrokenCatalogReferences,
} from "@/lib/domain/catalog";
import { loadDomainRepository } from "@/lib/repository";

const component = {
  id: "component:recipe-site/web",
  kind: "component",
  name: "Recipe Site web application",
  project: "project:recipe-site",
  sourcePaths: ["ui"],
  relations: [{ type: "part_of", target: "project:recipe-site" }],
  decisionRefs: [],
  aliases: [],
  externalIds: [],
} as const;

describe("component catalog", () => {
  it("accepts typed repository-owned records", () => {
    expect(CatalogRecordSchema.parse(component)).toMatchObject(component);
    expect(catalogIdToUri("component:recipe-site/web")).toBe(
      "https://robbiepalmer.me/id/component/recipe-site/web",
    );
  });

  it("rejects duplicate IDs, alias chains, and containment cycles", () => {
    const duplicate = CatalogManifestSchema.safeParse({
      records: [component, component],
    });
    expect(duplicate.success).toBe(false);

    const aliasChain = CatalogManifestSchema.safeParse({
      records: [
        { ...component, aliases: ["component:recipe-site/old-web"] },
        {
          ...component,
          id: "component:recipe-site/old-web",
          name: "Old web",
        },
      ],
    });
    expect(aliasChain.success).toBe(false);

    const cycle = CatalogManifestSchema.safeParse({
      records: [
        {
          ...component,
          id: "component:recipe-site/a",
          relations: [{ type: "part_of", target: "component:recipe-site/b" }],
        },
        {
          ...component,
          id: "component:recipe-site/b",
          relations: [{ type: "part_of", target: "component:recipe-site/a" }],
        },
      ],
    });
    expect(cycle.success).toBe(false);
  });

  it("rejects invalid relation endpoints and unsafe source paths", () => {
    expect(
      CatalogManifestSchema.safeParse({
        records: [
          {
            ...component,
            sourcePaths: ["../outside"],
            relations: [
              { type: "provides", target: "resource:recipe-site/database" },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires canonical package and complete OCI artifact coordinates", () => {
    expect(
      CatalogRecordSchema.safeParse({
        id: "package:recipe-site/zod",
        kind: "package",
        name: "Zod",
        project: "project:recipe-site",
        version: "4.6.5",
        externalIds: [{ kind: "package-url", value: "pkg:npm/zod@4.6.5" }],
      }).success,
    ).toBe(true);
    expect(
      CatalogRecordSchema.safeParse({
        id: "package:recipe-site/zod",
        kind: "package",
        name: "Zod",
        project: "project:recipe-site",
        externalIds: [{ kind: "package-url", value: "pkg:NPM/zod" }],
      }).success,
    ).toBe(false);
    expect(
      CatalogRecordSchema.safeParse({
        id: "package:recipe-site/zod",
        kind: "package",
        name: "Zod",
        project: "project:recipe-site",
        version: "4.6.4",
        externalIds: [{ kind: "package-url", value: "pkg:npm/zod@4.6.5" }],
      }).success,
    ).toBe(false);
    expect(
      CatalogRecordSchema.safeParse({
        id: "artifact:recipe-site/api",
        kind: "artifact",
        name: "Recipe API image",
        project: "project:recipe-site",
      }).success,
    ).toBe(false);
    expect(
      CatalogRecordSchema.safeParse({
        id: "artifact:recipe-site/api",
        kind: "artifact",
        name: "Recipe API image",
        project: "project:recipe-site",
        oci: {
          repository: "registry.example.test/recipe-api",
          mediaType: "application/vnd.oci.image.manifest.v1+json",
          digest: `sha256:${"a".repeat(64)}`,
          size: 42,
          subject: "artifact:recipe-site/source",
          referrers: ["artifact:recipe-site/signature"],
        },
      }).success,
    ).toBe(true);
  });

  it("reports unresolved canonical and OCI references", () => {
    const manifest = CatalogManifestSchema.parse({
      records: [component],
    });
    expect(findBrokenCatalogReferences(manifest, new Set())).toEqual([
      {
        recordId: "component:recipe-site/web",
        field: "project",
        target: "project:recipe-site",
      },
      {
        recordId: "component:recipe-site/web",
        field: "relations",
        target: "project:recipe-site",
      },
    ]);
    expect(
      findBrokenCatalogReferences(manifest, new Set(["project:recipe-site"])),
    ).toEqual([]);
  });

  it("builds the real repository view with unique stable IDs", () => {
    const catalog = buildCatalogDocument(loadDomainRepository());
    const ids = catalog?.records.map((record) => record.id) ?? [];

    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("component:recipe-site/web");
    expect(ids).toContain("project:recipe-site");
    expect(ids).toContain("technology:copier");
  }, 30_000);
});
