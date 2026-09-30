import { render, screen, within } from "@testing-library/react";
import type { Mock } from "vitest";
import { describe, expect, it, vi } from "vitest";
import ProjectPage, {
  generateMetadata,
  generateStaticParams,
} from "@/app/(site)/projects/[slug]/page";
import type { InitiativeWithProjects } from "@/lib/api/initiatives";
import { getInitiativesForProject } from "@/lib/api/initiatives";
import type { ProjectWithADRs } from "@/lib/api/projects";
import { getProject } from "@/lib/api/projects";

vi.mock("@/lib/api/projects", () => ({
  getAllProjectAliases: () => [{ alias: "old-homelab", target: "homelab" }],
  getAllProjectSlugs: () => ["homelab"],
  getProject: vi.fn(),
}));

vi.mock("@/lib/api/initiatives", () => ({
  getInitiativesForProject: vi.fn(() => []),
}));

vi.mock("@/components/projects/project-tabs", () => ({
  ProjectTabs: ({
    overview,
    adrs,
  }: {
    overview: React.ReactNode;
    adrs: React.ReactNode;
  }) => (
    <div>
      <div data-testid="overview">{overview}</div>
      <div data-testid="adrs">{adrs}</div>
    </div>
  ),
}));

vi.mock("@/components/markdown", () => ({
  Markdown: ({
    source,
    components,
  }: {
    source: string;
    components?: Record<string, unknown>;
  }) => (
    <div>
      <div>{source}</div>
      <div data-testid="registered-components">
        {Object.keys(components ?? {})
          .sort()
          .join(",")}
      </div>
    </div>
  ),
}));

vi.mock("@/components/mermaid", () => ({
  Mermaid: () => <div>mermaid</div>,
}));

vi.mock("@/components/projects/pitch-deck/embedded-pitch-deck-content", () => ({
  EmbeddedPitchDeckContent: () => <div>pitch-content</div>,
}));

vi.mock("@/components/projects/pitch-deck/lazy-project-pitch-deck", () => ({
  LazyProjectPitchDeck: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/projects/adr-list", () => ({
  ADRList: () => <div>adr-list</div>,
}));

const fixture = {
  slug: "homelab",
  title: "Home Lab",
  description: "Test description",
  date: "2026-08-02",
  status: "live",
  paperUrl: "https://doi.org/10.1000/example",
  content: "# Home Lab\n\nHello",
  technologies: [
    {
      name: "Tailscale",
      slug: "tailscale",
      iconSlug: "tailscale",
      hasIcon: true,
      website: "https://tailscale.com",
    },
    {
      name: "Kafka",
      slug: "kafka",
      iconSlug: "apachekafka",
      hasIcon: true,
      website: "https://kafka.apache.org",
    },
  ],
  adrSlugs: ["000-tailscale"],
  adrs: [
    {
      adrRef: "ADR-000",
      slug: "000-tailscale",
      title: "Tailscale",
      date: "2026-08-02",
      status: "Accepted",
      readingTime: "1 min",
      projectSlug: "homelab",
      originProjectSlug: "homelab",
      originAdrSlug: "000-tailscale",
      isInherited: false,
      technologies: [],
    },
  ],
  tags: [],
} as ProjectWithADRs;

describe("project page", () => {
  it("generates the legacy project route", () => {
    expect(generateStaticParams()).toContainEqual({
      slug: "old-homelab",
    });
  });

  it("sets the canonical URL for a legacy project route", async () => {
    (getProject as Mock).mockReturnValue(fixture);

    await expect(
      generateMetadata({ params: Promise.resolve({ slug: "old-homelab" }) }),
    ).resolves.toMatchObject({
      alternates: { canonical: "/projects/homelab" },
    });
  });

  it("advertises its project-specific feed", async () => {
    (getProject as Mock).mockReturnValue(fixture);

    await expect(
      generateMetadata({ params: Promise.resolve({ slug: "homelab" }) }),
    ).resolves.toEqual({
      title: "Home Lab - Projects",
      description: "Test description",
      alternates: {
        types: {
          "application/rss+xml": [
            {
              url: "/projects/homelab/feed.xml",
              title: "Home Lab RSS feed",
            },
          ],
        },
      },
    });
  });

  it("renders the project with the content component registry", async () => {
    (getProject as Mock).mockReturnValue(fixture);

    render(await ProjectPage({ params: Promise.resolve({ slug: "homelab" }) }));

    expect(
      screen.getByRole("heading", { name: "Home Lab" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Test description")).toBeInTheDocument();
    expect(screen.getByText("adr-list")).toBeInTheDocument();
    expect(screen.getByTitle("Apache Kafka")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Subscribe to Home Lab" }),
    ).toHaveAttribute("href", "/projects/homelab/feed.xml");
    expect(screen.getByRole("link", { name: "Read Paper" })).toHaveAttribute(
      "href",
      "https://doi.org/10.1000/example",
    );
  });

  it("passes Mermaid and DesignEmbed to the project markdown renderer", async () => {
    (getProject as Mock).mockReturnValue(fixture);

    render(await ProjectPage({ params: Promise.resolve({ slug: "homelab" }) }));

    expect(screen.getByTestId("registered-components")).toHaveTextContent(
      "DesignEmbed,Mermaid",
    );
  });

  it("shows initiatives as relationships outside the breadcrumb", async () => {
    (getProject as Mock).mockReturnValue(fixture);
    (getInitiativesForProject as Mock).mockReturnValue([
      {
        slug: "personalized-medicine",
        title: "Personalized Medicine",
        description: "A longer-running goal",
        date: "2017-07-04",
        status: "inactive",
        content: "",
        projectContributions: {
          homelab: "This project advances the goal.",
        },
        projects: [fixture],
      },
    ] satisfies InitiativeWithProjects[]);

    render(await ProjectPage({ params: Promise.resolve({ slug: "homelab" }) }));

    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).queryByText("Personalized Medicine")).toBeNull();
    expect(
      screen.getByRole("link", { name: "Personalized Medicine" }),
    ).toHaveAttribute("href", "/initiatives/personalized-medicine");
    expect(
      screen.getByText("This project advances the goal."),
    ).toBeInTheDocument();
  });
});
