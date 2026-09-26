import { describe, expect, it } from "vitest";
import { extractGraphData } from "@/lib/api/graph-data";
import type { DomainRepository } from "@/lib/domain";
import { loadDomainRepository } from "@/lib/repository";
import {
  getOverridesForDefaultSlot,
  getPlatformLayersForProject,
  getProjectsForPlatformLayer,
} from "@/lib/repository/graph/queries";

describe("extractGraphData", () => {
  it("skips ADR nodes when project mapping is missing", () => {
    const repository = {
      technologies: new Map([["kafka", { name: "Kafka" }]]),
      ideas: new Map([
        ["conways-law", { title: "Conway's Law" }],
        ["reverse-conway-maneuver", { title: "Reverse Conway Maneuver" }],
      ]),
      initiatives: new Map([
        ["software-development", { title: "Software Development" }],
      ]),
      projects: new Map([
        [
          "site",
          {
            title: "Site",
            paperTitle: "A Site Paper",
            paperUrl: "https://doi.org/10.1000/site",
          },
        ],
      ]),
      blogs: new Map(),
      roles: new Map(),
      adrs: new Map([
        ["site:001-react", { title: "ADR 001: React" }],
        ["site:999-missing", { title: "ADR 999: Missing" }],
      ]),
      graph: {
        edges: {
          usesTechnology: new Map(),
          contributesToInitiative: new Map([
            ["site", new Set(["software-development"])],
          ]),
          partOfProject: new Map([["site:001-react", "site"]]),
          supersedes: new Map(),
          inheritsFrom: new Map(),
          hasTag: new Map(),
          createdAtRole: new Map(),
          writtenAtRole: new Map(),
          referencesIdea: new Map([
            ["project:site", new Set(["conways-law", "missing-idea"])],
            ["blog:missing", new Set(["conways-law"])],
          ]),
          technologyIdeas: new Map([
            ["kafka", new Set(["conways-law", "missing-idea"])],
          ]),
          relatedIdea: new Map([
            [
              "conways-law",
              new Set(["reverse-conway-maneuver", "missing-idea"]),
            ],
            ["reverse-conway-maneuver", new Set(["conways-law"])],
            ["missing-idea", new Set(["reverse-conway-maneuver"])],
          ]),
        },
        reverse: {
          technologyUsedBy: new Map([["kafka", new Set()]]),
          initiativeProjects: new Map(),
          projectADRs: new Map(),
          supersededBy: new Map(),
          inheritedBy: new Map(),
          tagUsedBy: new Map(),
          roleProjects: new Map(),
          roleBlogs: new Map(),
          ideaReferencedBy: new Map(),
          ideaTechnologies: new Map(),
        },
      },
      buildingPhilosophy: "",
      referentialIntegrityErrors: [],
    } as unknown as DomainRepository;

    const data = extractGraphData(repository);
    const adrNodeIds = data.nodes
      .filter((n) => n.type === "adr")
      .map((n) => n.id);

    expect(adrNodeIds).toContain("adr:site:001-react");
    expect(adrNodeIds).not.toContain("adr:site:999-missing");
    expect(data.nodes).toContainEqual(
      expect.objectContaining({
        id: "initiative:software-development",
        href: "/initiatives/software-development",
      }),
    );
    expect(data.edges).toContainEqual({
      source: "project:site",
      target: "initiative:software-development",
      type: "CONTRIBUTES_TO_INITIATIVE",
    });
    expect(data.nodes).toContainEqual({
      id: "paper:site",
      name: "A Site Paper",
      type: "paper",
      href: "https://doi.org/10.1000/site",
      connections: 1,
    });
    expect(data.edges).toContainEqual({
      source: "project:site",
      target: "paper:site",
      type: "HAS_RESEARCH_PAPER",
    });
    expect(data.nodes).toContainEqual(
      expect.objectContaining({
        id: "idea:conways-law",
        href: "/ideas/conways-law",
        connections: 3,
      }),
    );
    expect(data.edges).toContainEqual({
      source: "project:site",
      target: "idea:conways-law",
      type: "REFERENCES_IDEA",
    });
    expect(data.edges).toContainEqual({
      source: "technology:kafka",
      target: "idea:conways-law",
      type: "HAS_IDEA",
    });
    expect(data.edges).toContainEqual({
      source: "idea:conways-law",
      target: "idea:reverse-conway-maneuver",
      type: "RELATED_IDEA",
    });
    expect(
      data.edges.filter((edge) => edge.type === "RELATED_IDEA"),
    ).toHaveLength(1);
    expect(data.edges).not.toContainEqual(
      expect.objectContaining({ target: "idea:missing-idea" }),
    );
  });

  it("presents platform policy as direct project-layer-technology edges", () => {
    const repository = loadDomainRepository();
    const data = extractGraphData(repository);
    const implementationNodePrefixes = [
      "default-slot:",
      "layer-extension:",
      "layer-slot-policy:",
      "default-selection:",
      "project-layer-use:",
      "project-slot-use:",
    ];

    expect(
      data.nodes.some((node) =>
        implementationNodePrefixes.some((prefix) => node.id.startsWith(prefix)),
      ),
    ).toBe(false);
    expect(data.edges).toContainEqual(
      expect.objectContaining({
        source: "project:agentic-code-review",
        target: "platform-layer:observability",
        type: "USES_PLATFORM_LAYER",
      }),
    );
    expect(data.edges).toContainEqual(
      expect.objectContaining({
        source: "platform-layer:backend-api",
        target: "technology:cloudflare-workers",
        type: "PREFERS_TECHNOLOGY",
      }),
    );
    expect(data.nodes).toContainEqual(
      expect.objectContaining({
        id: "platform-policy:governance-license-agpl-3-0-2026-09-15",
        name: "AGPL-3.0",
        type: "platform-policy",
      }),
    );
    expect(data.edges).toContainEqual(
      expect.objectContaining({
        source: "platform-layer:governance",
        target: "platform-policy:governance-license-agpl-3-0-2026-09-15",
        type: "REQUIRES_POLICY",
      }),
    );
    expect(data.edges).toContainEqual(
      expect.objectContaining({
        source: "platform-layer:base",
        target: "technology:codex",
        type: "REQUIRES_TECHNOLOGY",
        provenance: expect.objectContaining({
          slot: "development.coding-agents",
        }),
      }),
    );
    expect(
      data.edges.filter(
        (edge) =>
          edge.source ===
            "adr:personal-engineering-platform:001-language-defaults" &&
          edge.target === "project:personal-knowledge-graph" &&
          edge.type === "DRIVEN_BY",
      ),
    ).toHaveLength(1);
    expect(
      getPlatformLayersForProject(repository.graph, "recipe-site"),
    ).toContain("backend-api");
    expect(getProjectsForPlatformLayer(repository.graph, "base")).toContain(
      "personal-knowledge-graph",
    );
    expect(
      getOverridesForDefaultSlot(repository.graph, "project.primary-language"),
    ).toContain("agent-first-writing:009-primary-language-python");
  });

  it("uses effective layer-use provenance after re-adoption", () => {
    const repository = loadDomainRepository();
    const projectLayerUses = new Map(repository.platform.projectLayerUses);
    const existingUses = projectLayerUses.get("personal-knowledge-graph") ?? [];
    projectLayerUses.set("personal-knowledge-graph", [
      ...existingUses.filter((use) => use.layer !== "base"),
      {
        layer: "base",
        adopted: "2026-09-12T00:00:00Z",
        until: "2026-09-13T00:00:00Z",
        tracking: false,
        slots: [],
      },
      {
        layer: "base",
        adopted: "2026-09-13T00:00:00Z",
        tracking: true,
        slots: [],
      },
    ]);

    const data = extractGraphData({
      ...repository,
      platform: { ...repository.platform, projectLayerUses },
    });

    expect(data.edges).toContainEqual(
      expect.objectContaining({
        source: "project:personal-knowledge-graph",
        target: "platform-layer:base",
        type: "USES_PLATFORM_LAYER",
        provenance: expect.objectContaining({
          adopted: "2026-09-13T00:00:00Z",
          tracking: true,
        }),
      }),
    );
  });

  it("can render a deterministic historical platform snapshot", () => {
    const repository = loadDomainRepository();
    const data = extractGraphData(repository, "2026-09-11T23:59:59Z");

    expect(data.edges).not.toContainEqual(
      expect.objectContaining({
        source: "platform-layer:backend-api",
        type: "PREFERS_TECHNOLOGY",
      }),
    );
    expect(data.edges).not.toContainEqual(
      expect.objectContaining({
        source: "project:personal-knowledge-graph",
        type: "USES_PLATFORM_LAYER",
      }),
    );
    expect(data.nodes).not.toContainEqual(
      expect.objectContaining({ type: "platform-policy" }),
    );
  });
});
