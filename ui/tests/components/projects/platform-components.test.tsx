import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PlatformManifest } from "@/components/projects/platform-manifest";
import { PlatformSummary } from "@/components/projects/platform-summary";
import { getProjectWithADRs } from "@/lib/domain/project/projectQueries";
import { loadDomainRepository } from "@/lib/repository";

describe("project platform components", () => {
  it("keeps the platform sections collapsed until requested", async () => {
    const repository = loadDomainRepository();
    const project = getProjectWithADRs(
      repository,
      "personal-engineering-platform",
    );
    expect(project?.platformManifest).toBeDefined();
    if (!project?.platformManifest) return;

    render(<PlatformManifest manifest={project.platformManifest} />);

    expect(screen.getByText("Component catalog")).toBeVisible();
    expect(screen.getByText("component:recipe-site/web")).not.toBeVisible();

    const user = userEvent.setup();
    await user.click(screen.getByText("Component catalog"));
    await user.click(screen.getByText("Current layer manifest"));
    await user.click(screen.getByText("Default history"));

    expect(
      screen.getByRole("link", { name: "machine-readable catalog" }),
    ).toHaveAttribute("href", "/catalog.json");
    expect(screen.getByText("component:recipe-site/web")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Backend API" })).toBeVisible();
    expect(screen.getAllByText("preferred").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Adopters:/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Layer consumers:/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "decision" })).toHaveLength(
      project.platformManifest.slots.flatMap((slot) => slot.selections).length,
    );
    expect(
      screen.getAllByRole("link", {
        name: "personal-knowledge-graph:000-github-public-repo",
      }).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/originated in/).length).toBeGreaterThan(0);
    expect(
      screen.getByRole("list", {
        name: "observability.telemetry-protocol prerequisites",
      }),
    ).toHaveTextContent(
      "instrumented-runtimetelemetry-redactionbounded-exporter-failure",
    );
    expect(
      screen.getByRole("list", {
        name: "observability.alert-delivery prerequisites",
      }),
    ).toHaveTextContent("project-owned-slack-credentials");
  }, 30_000);

  it("groups catalog records by project and kind", async () => {
    const project = getProjectWithADRs(
      loadDomainRepository(),
      "personal-engineering-platform",
    );
    expect(project?.platformManifest).toBeDefined();
    if (!project?.platformManifest) return;

    render(<PlatformManifest manifest={project.platformManifest} />);
    await userEvent.setup().click(screen.getByText("Component catalog"));

    const recipeCatalog = screen.getByRole("region", {
      name: "recipe-site catalog records",
    });
    expect(
      within(recipeCatalog).getByRole("link", { name: "recipe-site" }),
    ).toHaveAttribute("href", "/projects/recipe-site");
    expect(
      within(recipeCatalog).getByText("component:recipe-site/recipe-api"),
    ).toBeVisible();

    const kinds = within(recipeCatalog)
      .getAllByRole("heading", { level: 4 })
      .map((heading) => heading.textContent?.match(/^[a-z]+/)?.[0]);
    expect(kinds).toEqual([
      "system",
      "component",
      "api",
      "workload",
      "resource",
      "package",
      "environment",
    ]);

    const expectedComponentIds = project.platformManifest.catalog.records
      .filter(
        (record) =>
          record.project === "project:recipe-site" &&
          record.kind === "component",
      )
      .toSorted(
        (left, right) =>
          left.name.localeCompare(right.name) ||
          left.id.localeCompare(right.id),
      )
      .map((record) => record.id);
    const componentRecords = within(recipeCatalog).getByRole("region", {
      name: "component records",
    });
    expect(
      within(componentRecords)
        .getAllByRole("listitem")
        .map((item) => item.querySelector("code")?.textContent),
    ).toEqual(expectedComponentIds);
  }, 30_000);

  it("keeps adopters and layer consumers under their labels", async () => {
    const project = getProjectWithADRs(
      loadDomainRepository(),
      "personal-engineering-platform",
    );

    expect(project?.platformManifest).toBeDefined();
    if (!project?.platformManifest) return;
    const slot = project.platformManifest.slots.find(
      (candidate) => candidate.slug === "backend-api.runtime",
    );
    expect(slot).toBeDefined();
    if (!slot) return;

    render(
      <PlatformManifest
        manifest={{
          ...project.platformManifest,
          slots: [
            {
              ...slot,
              selections: [],
              adopters: ["adopter-fixture"],
              layerConsumers: ["layer-consumer-fixture"],
            },
          ],
        }}
      />,
    );

    await userEvent.setup().click(screen.getByText("Default history"));

    expect(
      within(screen.getByText(/Adopters:/)).getByRole("link", {
        name: "adopter-fixture",
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByText(/Layer consumers:/)).getByRole("link", {
        name: "layer-consumer-fixture",
      }),
    ).toBeInTheDocument();
  });

  it("opens the section containing a linked manifest item", async () => {
    const project = getProjectWithADRs(
      loadDomainRepository(),
      "personal-engineering-platform",
    );
    expect(project?.platformManifest).toBeDefined();
    if (!project?.platformManifest) return;

    window.history.replaceState(null, "", "#slot-backend-api.runtime");
    render(<PlatformManifest manifest={project.platformManifest} />);

    const section = screen.getByText("Default history").closest("details");
    await waitFor(() => expect(section).toHaveAttribute("open"));
    window.history.replaceState(null, "", "/");
  });

  it("renders adopted layers and expandable platform technologies", () => {
    const project = getProjectWithADRs(loadDomainRepository(), "recipe-site");
    expect(project).not.toBeNull();
    if (!project) return;

    const { container } = render(
      <PlatformSummary
        builtOn={project.builtOn}
        platformPolicies={project.platformPolicies}
        platformTechnologies={project.platformTechnologies}
      />,
    );

    expect(screen.getByLabelText("Platform")).toHaveTextContent("Built on");
    expect(
      screen.getAllByRole("link", { name: "Governance" })[0],
    ).toHaveAttribute(
      "href",
      "/projects/personal-engineering-platform?tab=platform#layer-governance",
    );
    expect(screen.getByText(/platform technologies/)).toBeVisible();
    expect(screen.getByText(/platform policies/)).toBeVisible();
    expect(screen.getByText("Adoption provenance")).toBeVisible();
    expect(screen.getByText("AGPL-3.0")).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: "adoption" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("link", {
        name: "recipe-site:004-backend-platform-for-authenticated-features",
      }).length,
    ).toBeGreaterThan(0);
    expect(container.querySelectorAll("a").length).toBeGreaterThan(1);
  });

  it("labels a project-local decision as an override", () => {
    const project = getProjectWithADRs(
      loadDomainRepository(),
      "agent-first-writing",
    );
    expect(project).not.toBeNull();
    if (!project) return;

    render(
      <PlatformSummary
        builtOn={project.builtOn}
        platformPolicies={project.platformPolicies}
        platformTechnologies={project.platformTechnologies}
      />,
    );

    expect(screen.getByRole("link", { name: "override" })).toHaveAttribute(
      "href",
      "/projects/agent-first-writing/adrs/009-primary-language-python",
    );
  });

  it("does not present a future policy as current", () => {
    const project = getProjectWithADRs(
      loadDomainRepository(),
      "personal-engineering-platform",
    );
    expect(project?.platformManifest).toBeDefined();
    if (!project?.platformManifest) return;
    const layer = project.platformManifest.layers[0];
    const policy = project.platformManifest.policies[0];
    expect(layer).toBeDefined();
    expect(policy).toBeDefined();
    if (!layer || !policy) return;

    render(
      <PlatformManifest
        manifest={{
          schemaVersion: project.platformManifest.schemaVersion,
          catalog: { records: [] },
          layers: [layer],
          policies: [
            {
              ...policy,
              layer: layer.slug,
              effectiveFrom: "2099-01-01T00:00:00Z",
            },
          ],
          slots: [],
        }}
      />,
    );

    expect(screen.queryByText(policy.mode)).not.toBeInTheDocument();
  });

  it("omits the summary when no platform layer is adopted", () => {
    const { container } = render(<PlatformSummary />);
    expect(container).toBeEmptyDOMElement();
  });
});
