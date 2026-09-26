import { describe, expect, it } from "vitest";
import { getADRsForProject } from "@/lib/domain/adr/adrQueries";
import {
  compareUtcInstants,
  type DefaultSelection,
  getSelectionLifecycleStatus,
  getUpgradeRecommendations,
  isUseEffectiveAt,
  type PlatformManifest,
  PlatformManifestSchema,
  ProjectLayerUseSchema,
  previousUtcInstant,
  resolveEffectiveProjectStack,
  UtcInstantSchema,
} from "@/lib/domain/platform";
import { getProjectWithADRs } from "@/lib/domain/project/projectQueries";
import { loadDomainRepository } from "@/lib/repository";

function sameDayManifest(linkReplacement = true): PlatformManifest {
  return {
    project: "platform",
    layers: [{ slug: "base", title: "Base", description: "Shared defaults" }],
    slots: [
      {
        slug: "tool.runner",
        title: "Task runner",
        description: "Runs project tasks",
        rationale: "Several task runners address the same requirement",
        kind: "technology",
        cardinality: "one",
        opinionated: true,
      },
    ],
    policies: [
      {
        id: "tool-runner-policy",
        layer: "base",
        slot: "tool.runner",
        mode: "required",
        effectiveFrom: "2026-09-12T09:00:00Z",
        decision: "platform:000-runner",
        prerequisites: [],
      },
    ],
    selections: [
      {
        id: "runner-old",
        slot: "tool.runner",
        kind: "technology",
        technology: "old-runner",
        status: "Accepted",
        effectiveFrom: "2026-09-12T09:00:00Z",
        effectiveUntil: "2026-09-12T12:00:00Z",
        decision: "platform:000-runner",
        originProjects: [],
        evidenceADRs: ["platform:000-runner"],
      },
      {
        id: "runner-new",
        slot: "tool.runner",
        kind: "technology",
        technology: "new-runner",
        status: "Accepted",
        effectiveFrom: "2026-09-12T12:00:00Z",
        decision: "platform:001-new-runner",
        originProjects: [],
        evidenceADRs: ["platform:001-new-runner"],
        ...(linkReplacement ? { supersedes: "runner-old" } : {}),
      },
    ],
  };
}

describe("temporal platform layers", () => {
  it("accepts half-open replacements on the same day and derives superseded status", () => {
    const result = PlatformManifestSchema.safeParse(sameDayManifest());
    expect(result.success).toBe(true);
    if (!result.success) return;
    const firstSelection = result.data.selections[0];
    expect(firstSelection).toBeDefined();
    if (!firstSelection) return;
    expect(getSelectionLifecycleStatus(result.data, firstSelection)).toBe(
      "Superseded",
    );
  });

  it("allows concurrent accepted selections for a multi-valued slot", () => {
    const manifest = sameDayManifest();
    const slot = manifest.slots[0];
    const first = manifest.selections[0];
    const second = manifest.selections[1];
    expect(slot).toBeDefined();
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (!slot || !first || !second) return;

    manifest.slots[0] = { ...slot, cardinality: "many" };
    manifest.selections = [
      { ...first, effectiveUntil: undefined },
      { ...second, supersedes: undefined },
    ];

    expect(PlatformManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it("accepts semantically equal replacement boundary representations", () => {
    const manifest = sameDayManifest();
    const firstSelection = manifest.selections[0];
    expect(firstSelection).toBeDefined();
    if (!firstSelection) return;
    manifest.selections[0] = {
      ...firstSelection,
      effectiveUntil: "2026-09-12T12:00:00.0Z",
    };

    expect(PlatformManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it("rejects unlinked accepted replacements", () => {
    const result = PlatformManifestSchema.safeParse(sameDayManifest(false));
    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) =>
        issue.message.includes("must supersede"),
      ),
    ).toBe(true);
  });

  it("requires exact evidence ADRs for every default selection", () => {
    const manifest = sameDayManifest();
    const selection = manifest.selections[0];
    expect(selection).toBeDefined();
    if (!selection) return;
    manifest.selections[0] = { ...selection, evidenceADRs: [] };

    const result = PlatformManifestSchema.safeParse(manifest);

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([
      "selections",
      0,
      "evidenceADRs",
    ]);
  });

  it("rejects prerequisite selections outside the policy period", () => {
    const manifest = sameDayManifest();
    manifest.slots.push({
      slug: "tool.database",
      title: "Database",
      description: "Stores task state",
      rationale: "Several databases address the same requirement",
      kind: "technology",
      cardinality: "one",
      opinionated: false,
    });
    manifest.selections.push({
      id: "database-old",
      slot: "tool.database",
      kind: "technology",
      technology: "old-database",
      status: "Accepted",
      effectiveFrom: "2026-09-12T07:00:00Z",
      effectiveUntil: "2026-09-12T08:00:00Z",
      decision: "platform:000-database",
      originProjects: [],
      evidenceADRs: ["platform:000-database"],
    });
    const policy = manifest.policies[0];
    expect(policy).toBeDefined();
    if (!policy) return;
    manifest.policies[0] = {
      ...policy,
      prerequisites: [{ slot: "tool.database", technology: "old-database" }],
    };

    const result = PlatformManifestSchema.safeParse(manifest);

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) =>
        issue.message.includes("technology not selected by prerequisite"),
      ),
    ).toBe(true);
  });

  it("rejects gaps in a closed historical policy period", () => {
    const manifest = sameDayManifest();
    const policy = manifest.policies[0];
    expect(policy).toBeDefined();
    if (!policy) return;
    manifest.policies[0] = {
      ...policy,
      effectiveFrom: "2026-09-12T08:00:00Z",
      effectiveUntil: "2026-09-12T14:00:00Z",
    };

    const result = PlatformManifestSchema.safeParse(manifest);

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) =>
        issue.message.includes("must have exactly one accepted selection"),
      ),
    ).toBe(true);
  });

  it("allows an explicit empty default after the last accepted selection", () => {
    const manifest = sameDayManifest();
    const slot = manifest.slots[0];
    const firstSelection = manifest.selections[0];
    expect(slot).toBeDefined();
    expect(firstSelection).toBeDefined();
    if (!slot || !firstSelection) return;
    manifest.slots[0] = {
      ...slot,
      noDefaultFrom: "2026-09-12T12:00:00Z",
    };
    manifest.selections = [firstSelection];

    expect(PlatformManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it("does not mark a selection superseded by a proposed candidate", () => {
    const manifest = sameDayManifest();
    const slot = manifest.slots[0];
    const candidate = manifest.selections[1];
    expect(slot).toBeDefined();
    expect(candidate).toBeDefined();
    if (!slot || !candidate) return;
    manifest.slots[0] = {
      ...slot,
      noDefaultFrom: "2026-09-12T12:00:00Z",
    };
    manifest.selections[1] = {
      ...candidate,
      status: "Proposed",
    };
    const result = PlatformManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const firstSelection = result.data.selections[0];
    expect(firstSelection).toBeDefined();
    if (!firstSelection) return;

    expect(getSelectionLifecycleStatus(result.data, firstSelection)).toBe(
      "Accepted",
    );
  });

  it("rejects date-only temporal values", () => {
    expect(
      ProjectLayerUseSchema.safeParse({
        layer: "base",
        adopted: "2026-09-12",
        tracking: true,
      }).success,
    ).toBe(false);
  });

  it("validates calendar dates and compares fractional UTC instants", () => {
    expect(UtcInstantSchema.safeParse("2026-02-30T00:00:00Z").success).toBe(
      false,
    );
    expect(
      ProjectLayerUseSchema.safeParse({
        layer: "base",
        adopted: "2026-09-12T12:00:00Z",
        until: "2026-09-12T12:00:00.500Z",
        tracking: false,
        rationale: "Fixture adopts the base layer.",
      }).success,
    ).toBe(true);
    expect(
      isUseEffectiveAt(
        { adopted: "2026-09-12T12:00:00Z" },
        "2026-09-12T12:00:00.250Z",
      ),
    ).toBe(true);
    expect(
      compareUtcInstants(
        "2026-09-12T12:00:00.000000001Z",
        "2026-09-12T12:00:00Z",
      ),
    ).toBeGreaterThan(0);
    expect(previousUtcInstant("2026-09-12T12:00:00Z")).toBe(
      "2026-09-12T11:59:59.999999999Z",
    );
    expect(() =>
      compareUtcInstants("not-an-instant", "2026-09-12T12:00:00Z"),
    ).toThrow("Invalid RFC 3339 UTC instant");
  });

  it("requires one adoption decision or rationale", () => {
    const baseUse = {
      layer: "base",
      adopted: "2026-09-12T12:00:00Z",
      tracking: true,
    };

    expect(
      ProjectLayerUseSchema.safeParse({
        ...baseUse,
        decision: "project:001-adopt-platform",
      }).success,
    ).toBe(true);
    expect(
      ProjectLayerUseSchema.safeParse({
        ...baseUse,
        rationale: "The project uses the shared delivery controls.",
      }).success,
    ).toBe(true);
    expect(ProjectLayerUseSchema.safeParse(baseUse).success).toBe(false);
    expect(
      ProjectLayerUseSchema.safeParse({
        ...baseUse,
        decision: "project:001-adopt-platform",
        rationale: "Duplicate explanation",
      }).success,
    ).toBe(false);
  });

  it("resolves required, preferred, and overridden technologies", () => {
    const repository = loadDomainRepository();
    const manifest = repository.platform.manifest;
    expect(
      manifest?.layers.find((layer) => layer.slug === "python")?.activatedBy,
    ).toEqual({ slot: "project.primary-language", technology: "python" });
    expect(
      manifest?.selections.some(
        (selection) =>
          selection.slot === "project.primary-language" &&
          selection.kind === "technology" &&
          selection.technology === "python",
      ),
    ).toBe(false);

    const recipe = resolveEffectiveProjectStack(
      repository,
      "recipe-site",
      "2026-09-12T12:00:00Z",
    );
    expect(recipe.layers).toEqual(
      expect.arrayContaining(["base", "typescript", "database"]),
    );
    expect(recipe.technologies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          technology: "zod",
          source: "required-layer",
        }),
        expect.objectContaining({
          technology: "postgresql",
          source: "preferred-layer",
        }),
        expect.objectContaining({
          technology: "neon",
          source: "preferred-layer",
        }),
        expect.objectContaining({
          technology: "cloudflare-workers",
          source: "preferred-layer",
        }),
      ]),
    );
    expect(recipe.technologies.map((use) => use.technology)).not.toContain(
      "duckdb",
    );
    expect(
      recipe.technologies.find((use) => use.technology === "postgresql"),
    ).toMatchObject({
      adoptionDecision:
        "recipe-site:033-backend-platform-for-authenticated-features",
      policyDecision: "personal-engineering-platform:005-database-defaults",
      decision: "personal-engineering-platform:005-database-defaults",
      originProjects: ["recipe-site"],
      evidenceADRs: [
        "recipe-site:033-backend-platform-for-authenticated-features",
      ],
    });

    const python = resolveEffectiveProjectStack(
      repository,
      "agent-first-writing",
      "2026-09-12T12:00:00Z",
    );
    expect(python.layers).toContain("python");
    expect(python.layers).not.toContain("typescript");
    expect(python.technologies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ technology: "python", source: "override" }),
        expect.objectContaining({
          technology: "pydantic",
          source: "required-layer",
        }),
        expect.objectContaining({
          technology: "pytest-cases",
          source: "required-layer",
        }),
      ]),
    );
  });

  it("derives stable adoption dates for activated language layers", () => {
    const repository = loadDomainRepository();
    const recipe = getProjectWithADRs(repository, "recipe-site");
    const writing = getProjectWithADRs(repository, "agent-first-writing");

    expect(
      recipe?.builtOn?.find((layer) => layer.slug === "typescript")?.adopted,
    ).toBe("2026-09-12T00:00:00Z");
    expect(
      recipe?.builtOn?.find((layer) => layer.slug === "database")?.decision,
    ).toBe("recipe-site:033-backend-platform-for-authenticated-features");
    expect(
      writing?.builtOn?.find((layer) => layer.slug === "python")?.adopted,
    ).toBe("2026-09-12T00:00:00Z");
  });

  it("resolves the repository, language, web, and infrastructure baseline", () => {
    const repository = loadDomainRepository();
    const recipe = resolveEffectiveProjectStack(
      repository,
      "recipe-site",
      "2026-09-15T12:00:00Z",
    );
    const recipeTechnologies = recipe.technologies.map((use) => use.technology);

    expect(recipe.layers).toContain("governance");
    expect(recipe.policies.map((use) => use.value)).toEqual(
      expect.arrayContaining([
        "Public source",
        "AGPL-3.0",
        "Shared personal-project monorepo",
      ]),
    );

    expect(recipeTechnologies).toEqual(
      expect.arrayContaining([
        "github",
        "mise",
        "github-actions",
        "claude-code",
        "codex",
        "coderabbit",
        "greptile",
        "agentic-code-review",
        "renovate",
        "gitleaks",
        "openssf-scorecard",
        "sonarqube",
        "pnpm",
        "vitest",
        "biome",
        "react",
        "nextdotjs",
        "tailwind-css",
        "shadcnui",
        "cloudflare-pages",
        "doppler",
        "github-secrets",
        "terraform-cloud",
        "tflint",
      ]),
    );
    expect(
      recipe.technologies
        .filter((use) => use.slot === "development.coding-agents")
        .map((use) => use.technology),
    ).toEqual(expect.arrayContaining(["claude-code", "codex"]));
    expect(
      recipe.technologies
        .filter((use) => use.slot === "quality.ai-reviewers")
        .map((use) => use.technology),
    ).toEqual(
      expect.arrayContaining([
        "coderabbit",
        "greptile",
        "codex",
        "agentic-code-review",
      ]),
    );
    const recipeView = getProjectWithADRs(repository, "recipe-site");
    expect(
      recipeView?.platformTechnologies?.filter(
        (technology) => technology.slug === "codex",
      ),
    ).toHaveLength(1);

    const writing = resolveEffectiveProjectStack(
      repository,
      "agent-first-writing",
      "2026-09-15T12:00:00Z",
    );
    const writingTechnologies = writing.technologies.map(
      (use) => use.technology,
    );
    expect(writingTechnologies).toEqual(
      expect.arrayContaining(["uv", "ruff", "pytest", "doppler"]),
    );
    expect(writingTechnologies).not.toContain("github-secrets");
  });

  it("resolves a project ADR override for a governance value", () => {
    const repository = loadDomainRepository();
    const overrideRef = "personal-knowledge-graph:059-temporal-platform-layers";
    const existingADR = repository.adrs.get(overrideRef);
    expect(existingADR).toBeDefined();
    if (!existingADR) return;

    const adrs = new Map(repository.adrs);
    adrs.set(overrideRef, {
      ...existingADR,
      projectSlug: "recipe-site",
      status: "Accepted",
    });
    const adrOverrides = new Map(repository.platform.adrOverrides);
    adrOverrides.set(overrideRef, {
      kind: "policy",
      slot: "governance.repository-visibility",
      value: "Private source",
      adopted: "2026-09-15T00:00:00Z",
    });

    const stack = resolveEffectiveProjectStack(
      {
        ...repository,
        adrs,
        platform: { ...repository.platform, adrOverrides },
      },
      "recipe-site",
      "2026-09-15T12:00:00Z",
    );

    expect(stack.policies).toContainEqual(
      expect.objectContaining({
        slot: "governance.repository-visibility",
        value: "Private source",
        source: "override",
        decision: overrideRef,
      }),
    );
    expect(stack.policies.map((policy) => policy.value)).not.toContain(
      "Public source",
    );
  });

  it("retains concurrent project overrides for a multi-valued slot", () => {
    const repository = loadDomainRepository();
    const existingADR = repository.adrs.get(
      "personal-knowledge-graph:059-temporal-platform-layers",
    );
    expect(existingADR).toBeDefined();
    if (!existingADR) return;

    const firstRef = "recipe-site:998-claude-code-override";
    const secondRef = "recipe-site:999-codex-override";
    const adrs = new Map(repository.adrs);
    adrs.set(firstRef, {
      ...existingADR,
      adrRef: firstRef,
      slug: "998-claude-code-override",
      projectSlug: "recipe-site",
      status: "Accepted",
    });
    adrs.set(secondRef, {
      ...existingADR,
      adrRef: secondRef,
      slug: "999-codex-override",
      projectSlug: "recipe-site",
      status: "Accepted",
    });
    const adrOverrides = new Map(repository.platform.adrOverrides);
    adrOverrides.set(firstRef, {
      kind: "technology",
      slot: "development.coding-agents",
      technology: "claude-code",
      adopted: "2026-09-15T00:00:00Z",
    });
    adrOverrides.set(secondRef, {
      kind: "technology",
      slot: "development.coding-agents",
      technology: "codex",
      adopted: "2026-09-15T00:00:00Z",
    });

    const stack = resolveEffectiveProjectStack(
      {
        ...repository,
        adrs,
        platform: { ...repository.platform, adrOverrides },
      },
      "recipe-site",
      "2026-09-15T12:00:00Z",
    );
    const codingAgentOverrides = stack.technologies.filter(
      (technology) =>
        technology.slot === "development.coding-agents" &&
        technology.source === "override",
    );

    expect(codingAgentOverrides).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          technology: "claude-code",
          decision: firstRef,
        }),
        expect.objectContaining({ technology: "codex", decision: secondRef }),
      ]),
    );
    expect(codingAgentOverrides).toHaveLength(2);
  });

  it("uses the effective record when a project re-adopts a layer", () => {
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
    const project = getProjectWithADRs(
      {
        ...repository,
        platform: { ...repository.platform, projectLayerUses },
      },
      "personal-knowledge-graph",
    );

    expect(project?.builtOn?.find((layer) => layer.slug === "base")).toEqual(
      expect.objectContaining({
        adopted: "2026-09-13T00:00:00Z",
        tracking: true,
      }),
    );
  });

  it("keeps inherited ADR aliases out of local project histories", () => {
    const repository = loadDomainRepository();
    const recipeADRs = getADRsForProject(repository, "recipe-site");
    expect(
      recipeADRs.some((adr) => adr.slug === "000-github-public-repo"),
    ).toBe(false);
    expect(
      repository.adrAliases.get("recipe-site:000-github-public-repo"),
    ).toBe("personal-knowledge-graph:000-github-public-repo");
  });

  it("freezes a closed project before a later platform replacement", () => {
    const repository = loadDomainRepository();
    const manifest = repository.platform.manifest;
    expect(manifest).toBeDefined();
    if (!manifest) return;
    const oldPrimary = manifest.selections.find(
      (selection) =>
        selection.id === "project-primary-language-typescript-2026-09-12",
    );
    expect(oldPrimary).toBeDefined();
    if (!oldPrimary) return;
    const frozenRepository = {
      ...repository,
      platform: {
        ...repository.platform,
        manifest: {
          ...manifest,
          selections: [
            ...manifest.selections.filter(
              (selection) => selection !== oldPrimary,
            ),
            { ...oldPrimary, effectiveUntil: "2026-10-01T00:00:00Z" },
            {
              ...oldPrimary,
              id: "project-primary-language-python-2026-10-01",
              technology: "python",
              effectiveFrom: "2026-10-01T00:00:00Z",
              supersedes: oldPrimary.id,
            },
          ],
        },
        projectLayerUses: new Map([
          [
            "personal-knowledge-graph",
            [
              {
                layer: "base",
                adopted: "2026-09-12T00:00:00Z",
                until: "2026-09-20T00:00:00Z",
                tracking: false,
                slots: [],
              },
            ],
          ],
        ]),
      },
    };
    const stack = resolveEffectiveProjectStack(
      frozenRepository,
      "personal-knowledge-graph",
      "2026-10-02T00:00:00Z",
    );
    expect(stack.at).toBe("2026-09-19T23:59:59.999999999Z");
    expect(stack.layers).toContain("typescript");
    expect(stack.layers).not.toContain("python");
  });

  it("recommends a simulated supersession only to tracking personal projects", () => {
    const repository = loadDomainRepository();
    const manifest = repository.platform.manifest;
    expect(manifest).toBeDefined();
    if (!manifest) return;
    const previousId = "typescript-schema-validation-zod-2026-09-12";
    const previousSelection = manifest.selections.find(
      (selection) => selection.id === previousId,
    );
    expect(previousSelection).toBeDefined();
    if (!previousSelection) return;
    const replacement: DefaultSelection = {
      id: "typescript-schema-validation-valibot-2026-10-01",
      slot: "typescript.schema-validation",
      kind: "technology",
      technology: "valibot",
      status: "Accepted",
      effectiveFrom: "2026-10-01T00:00:00Z",
      decision: "personal-engineering-platform:001-language-defaults",
      originProjects: [],
      evidenceADRs: ["personal-engineering-platform:001-language-defaults"],
      supersedes: previousId,
    };
    const repositoryAfterReplacement = {
      ...repository,
      platform: {
        ...repository.platform,
        manifest: {
          ...manifest,
          selections: [
            ...manifest.selections
              .filter((selection) => selection.id !== previousId)
              .map((selection) => ({ ...selection })),
            {
              ...previousSelection,
              effectiveUntil: replacement.effectiveFrom,
            },
            replacement,
          ],
        },
      },
    };
    const recommendations = getUpgradeRecommendations(
      repositoryAfterReplacement,
      replacement,
    );
    const projects = recommendations.map(
      (recommendation) => recommendation.project,
    );
    expect(projects).toContain("personal-knowledge-graph");
    expect(projects).toContain("recipe-site");
    expect(projects).not.toContain("agent-first-writing");
    expect(projects).not.toContain("genomic-prediction");

    const overrideRef = "personal-knowledge-graph:059-temporal-platform-layers";
    const overrideADR = repository.adrs.get(overrideRef);
    expect(overrideADR).toBeDefined();
    if (!overrideADR) return;
    const adrs = new Map(repositoryAfterReplacement.adrs);
    adrs.set(overrideRef, { ...overrideADR, status: "Proposed" });
    const adrOverrides = new Map(
      repositoryAfterReplacement.platform.adrOverrides,
    );
    adrOverrides.set(overrideRef, {
      slot: replacement.slot,
      kind: "technology",
      technology: "zod",
      adopted: replacement.effectiveFrom,
    });
    const withProposedOverride = getUpgradeRecommendations(
      {
        ...repositoryAfterReplacement,
        adrs,
        platform: {
          ...repositoryAfterReplacement.platform,
          adrOverrides,
        },
      },
      replacement,
    );
    expect(
      withProposedOverride.map((recommendation) => recommendation.project),
    ).toContain("personal-knowledge-graph");
  });

  it("does not recommend a preferred-slot change to a project that never activated the slot", () => {
    const repository = loadDomainRepository();
    const manifest = repository.platform.manifest;
    expect(manifest).toBeDefined();
    if (!manifest) return;
    const previousId = "backend-api-runtime-cloudflare-workers-2026-09-12";
    const replacement: DefaultSelection = {
      id: "backend-api-runtime-next-2026-10-01",
      slot: "backend-api.runtime",
      kind: "technology",
      technology: "nextdotjs",
      status: "Accepted",
      effectiveFrom: "2026-10-01T00:00:00Z",
      decision: "personal-engineering-platform:002-cloudflare-workers",
      originProjects: [],
      evidenceADRs: ["personal-engineering-platform:002-cloudflare-workers"],
      supersedes: previousId,
    };
    const previous = manifest.selections.find(
      (selection) => selection.id === previousId,
    );
    expect(previous).toBeDefined();
    if (!previous) return;
    const projectLayerUses = new Map(repository.platform.projectLayerUses);
    projectLayerUses.set("agent-first-writing", [
      ...(projectLayerUses.get("agent-first-writing") ?? []),
      {
        layer: "backend-api",
        adopted: "2026-09-12T00:00:00Z",
        tracking: true,
        slots: [],
      },
    ]);
    const repositoryAfterReplacement = {
      ...repository,
      platform: {
        ...repository.platform,
        manifest: {
          ...manifest,
          selections: [
            ...manifest.selections.filter(
              (selection) => selection.id !== previousId,
            ),
            { ...previous, effectiveUntil: replacement.effectiveFrom },
            replacement,
          ],
        },
        projectLayerUses,
      },
    };

    const projects = getUpgradeRecommendations(
      repositoryAfterReplacement,
      replacement,
    ).map((recommendation) => recommendation.project);

    expect(projects).not.toContain("agent-first-writing");
    expect(projects).toContain("recipe-site");
  });

  it("separates preferred-slot adopters from consumers of the containing layer", () => {
    const repository = loadDomainRepository();
    const overrideRef =
      "recipe-site:033-backend-platform-for-authenticated-features";
    const projectLayerUses = new Map(repository.platform.projectLayerUses);
    projectLayerUses.set("agent-first-writing", [
      ...(projectLayerUses.get("agent-first-writing") ?? []),
      {
        layer: "backend-api",
        adopted: "2026-09-12T00:00:00Z",
        tracking: true,
        slots: [],
        rationale:
          "The project exposes an API without adopting its runtime default.",
      },
    ]);
    const adrOverrides = new Map(repository.platform.adrOverrides);
    adrOverrides.set(overrideRef, {
      slot: "backend-api.runtime",
      kind: "technology",
      technology: "nextdotjs",
      adopted: "2026-09-12T00:00:00Z",
    });
    const repositoryWithConsumers = {
      ...repository,
      platform: {
        ...repository.platform,
        projectLayerUses,
        adrOverrides,
      },
    };

    expect(
      resolveEffectiveProjectStack(
        repositoryWithConsumers,
        "recipe-site",
        "2026-09-23T00:00:00Z",
      ).technologies,
    ).toContainEqual(
      expect.objectContaining({
        slot: "backend-api.runtime",
        technology: "nextdotjs",
        source: "override",
      }),
    );

    const platform = getProjectWithADRs(
      repositoryWithConsumers,
      "personal-engineering-platform",
    );
    const runtime = platform?.platformManifest?.slots.find(
      (slot) => slot.slug === "backend-api.runtime",
    );

    expect(runtime?.adopters).toContain("recipe-site");
    expect(runtime?.adopters).not.toContain("agent-first-writing");
    expect(runtime?.layerConsumers).toEqual(
      expect.arrayContaining(["recipe-site", "agent-first-writing"]),
    );
  });
});
