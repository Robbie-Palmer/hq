import { describe, expect, it } from "vitest";
import {
  resolveDeliveryTargets,
  type GeneratedDeliveryMetadataRevision,
} from "../src/index";

const target = (
  id: string,
  projectId: string,
  path: string,
  mode: "exclusive" | "shared" = "exclusive",
) => ({
  id: `delivery-target:${projectId}/${id}`,
  projectId: `project:${projectId}`,
  repository: "Robbie-Palmer/hq",
  sourcePaths: [
    {
      path,
      mode,
      subjects: [`component:${projectId}/${id}`],
    },
  ],
  subjects: [`workload:${projectId}/${id}`],
  sharedHostId: mode === "shared" ? "shared-host:site-ui" : null,
  requiredCiNames: [`${id} CI`],
  productionEnvironments: [`production-${id}`],
});

const metadata = (
  targets: GeneratedDeliveryMetadataRevision["targets"],
): GeneratedDeliveryMetadataRevision => ({
  repository: "Robbie-Palmer/hq",
  sourceRevision: "catalog-abc123",
  targets,
});

describe("resolveDeliveryTargets", () => {
  it("resolves project-owned paths to stable targets and subjects", () => {
    const result = resolveDeliveryTargets({
      metadata: metadata([
        target("api", "work-graph", "workers/work-graph-api"),
        target("observer", "work-graph", "workers/work-graph-observer"),
      ]),
      repository: "robbie-palmer/HQ",
      ticketProjectId: "work-graph",
      changedPaths: ["workers/work-graph-api/src/index.ts"],
    });

    expect(result).toMatchObject({
      repository: "robbie-palmer/hq",
      sourceRevision: "catalog-abc123",
      targets: [
        {
          id: "delivery-target:work-graph/api",
          matchedPaths: ["workers/work-graph-api/src/index.ts"],
          requiredCiNames: ["api CI"],
          productionEnvironments: ["production-api"],
        },
      ],
      subjects: [
        "component:work-graph/api",
        "workload:work-graph/api",
      ],
    });
  });

  it("returns every target for a shared source path", () => {
    const result = resolveDeliveryTargets({
      metadata: metadata([
        target("site-ui", "work-graph", "ui", "shared"),
        target("site-ui", "recipe-site", "ui", "shared"),
      ]),
      repository: "Robbie-Palmer/hq",
      ticketProjectId: null,
      changedPaths: ["ui/components/button.tsx"],
    });

    expect(result.targets.map(({ id }) => id)).toEqual([
      "delivery-target:recipe-site/site-ui",
      "delivery-target:work-graph/site-ui",
    ]);
  });

  it("accepts both sides of a path move", () => {
    const result = resolveDeliveryTargets({
      metadata: metadata([
        target("api", "work-graph", "workers/work-graph-api"),
        target("observer", "work-graph", "workers/work-graph-observer"),
      ]),
      repository: "Robbie-Palmer/hq",
      ticketProjectId: "work-graph",
      changedPaths: [
        "workers/work-graph-api/src/moved.ts",
        "workers/work-graph-observer/src/moved.ts",
      ],
    });

    expect(result.targets.map(({ id }) => id)).toEqual([
      "delivery-target:work-graph/api",
      "delivery-target:work-graph/observer",
    ]);
  });

  it("allows an override to narrow only the owner-selected targets", () => {
    const targets = [
      target("api", "work-graph", "packages/work-graph-domain", "shared"),
      target(
        "observer",
        "work-graph",
        "packages/work-graph-domain",
        "shared",
      ),
    ];
    const result = resolveDeliveryTargets({
      metadata: metadata(targets),
      repository: "Robbie-Palmer/hq",
      ticketProjectId: "work-graph",
      changedPaths: ["packages/work-graph-domain/src/model.ts"],
      overrideTargetIds: ["delivery-target:work-graph/api"],
    });
    expect(result.targets.map(({ id }) => id)).toEqual([
      "delivery-target:work-graph/api",
    ]);

    expect(() =>
      resolveDeliveryTargets({
        metadata: metadata(targets),
        repository: "Robbie-Palmer/hq",
        ticketProjectId: "work-graph",
        changedPaths: ["packages/work-graph-domain/src/model.ts"],
        overrideTargetIds: ["delivery-target:recipe-site/site-ui"],
      }),
    ).toThrow(/only narrow targets/u);
  });

  it("fails closed for missing, unmapped, and ambiguous metadata", () => {
    expect(() =>
      resolveDeliveryTargets({
        metadata: metadata([target("api", "work-graph", "workers/api")]),
        repository: "Robbie-Palmer/another",
        ticketProjectId: "work-graph",
        changedPaths: ["workers/api/index.ts"],
      }),
    ).toThrow(/No generated delivery metadata/u);

    expect(() =>
      resolveDeliveryTargets({
        metadata: metadata([
          target("api", "work-graph", "workers/api"),
          target("observer", "work-graph", "workers/observer"),
        ]),
        repository: "Robbie-Palmer/hq",
        ticketProjectId: "work-graph",
        changedPaths: ["docs/readme.md"],
      }),
    ).toThrow(/do not identify/u);

    expect(() =>
      resolveDeliveryTargets({
        metadata: metadata([
          target("api", "work-graph", "packages/shared"),
          target("api", "recipe-site", "packages/shared"),
        ]),
        repository: "Robbie-Palmer/hq",
        ticketProjectId: null,
        changedPaths: ["packages/shared/index.ts"],
      }),
    ).toThrow(/several exclusive/u);
  });

  it("keeps the repository-only fallback for one unambiguous target", () => {
    const result = resolveDeliveryTargets({
      metadata: metadata([target("api", "work-graph", "workers/api")]),
      repository: "Robbie-Palmer/hq",
      ticketProjectId: null,
      changedPaths: ["README.md"],
    });
    expect(result.targets.map(({ id }) => id)).toEqual([
      "delivery-target:work-graph/api",
    ]);
  });
});
