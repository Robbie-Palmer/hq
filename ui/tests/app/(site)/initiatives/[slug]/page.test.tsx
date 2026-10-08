import { render, screen, within } from "@testing-library/react";
import type { Mock } from "vitest";
import { describe, expect, it, vi } from "vitest";
import InitiativePage, {
  generateMetadata,
  generateStaticParams,
} from "@/app/(site)/initiatives/[slug]/page";
import {
  getInitiative,
  type InitiativeWithProjects,
} from "@/lib/api/initiatives";

vi.mock("@/lib/api/initiatives", () => ({
  getAllInitiativeSlugs: () => ["personalized-medicine"],
  getInitiative: vi.fn(),
}));

vi.mock("@/components/markdown", () => ({
  Markdown: ({ source }: { source: string }) => <div>{source}</div>,
}));

const fixture = {
  slug: "personalized-medicine",
  title: "Personalized Medicine",
  description: "Patient-specific treatment decisions",
  date: "2017-07-04",
  updated: "2021-11-01",
  status: "inactive" as const,
  projectContributions: {
    "pathology-viewer": "Made model outputs inspectable.",
  },
  content: "## Goal\n\nImprove patient-specific decisions.",
  projects: [
    {
      slug: "pathology-viewer",
      title: "Pathology Viewer",
      description: "View digital pathology slides",
      date: "2021-11-01",
      status: "completed" as const,
      content: "# Pathology Viewer",
      technologies: [],
      adrSlugs: [],
      adrs: [],
      tags: [],
      contribution: "Made model outputs inspectable.",
    },
  ],
} satisfies InitiativeWithProjects;

describe("initiative page", () => {
  it("generates routes and metadata", async () => {
    (getInitiative as Mock).mockReturnValue(fixture);

    expect(generateStaticParams()).toEqual([{ slug: "personalized-medicine" }]);
    await expect(
      generateMetadata({
        params: Promise.resolve({ slug: "personalized-medicine" }),
      }),
    ).resolves.toEqual({
      title: "Personalized Medicine - Initiative",
      description: "Patient-specific treatment decisions",
      alternates: {
        types: {
          "application/rss+xml": [
            {
              url: "/initiatives/personalized-medicine/feed.xml",
              title: "Personalized Medicine RSS feed",
            },
          ],
        },
      },
    });
  });

  it("renders retained initiative content and project contributions", async () => {
    (getInitiative as Mock).mockReturnValue(fixture);

    render(
      await InitiativePage({
        params: Promise.resolve({ slug: "personalized-medicine" }),
      }),
    );

    expect(
      screen.getByRole("heading", { name: "Personalized Medicine" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(
      within(breadcrumb).getByRole("link", { name: "Initiatives" }),
    ).toHaveAttribute("href", "/projects");
    expect(
      screen.getByText(/Improve patient-specific decisions/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Made model outputs inspectable."),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: "Pathology Viewer" }),
    ).toHaveLength(2);
    expect(
      screen.getByRole("link", {
        name: "Subscribe to Personalized Medicine",
      }),
    ).toHaveAttribute("href", "/initiatives/personalized-medicine/feed.xml");
  });

  it("renders related projects when contribution prose is not yet written", async () => {
    (getInitiative as Mock).mockReturnValue({
      ...fixture,
      projectContributions: {},
      projects: fixture.projects.map(
        ({ contribution: _, ...project }) => project,
      ),
    });

    render(
      await InitiativePage({
        params: Promise.resolve({ slug: "personalized-medicine" }),
      }),
    );

    expect(
      screen.getByRole("heading", { name: "Projects advancing this goal" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("View digital pathology slides"),
    ).toBeInTheDocument();
  });

  it("renders the not-found boundary for an unknown initiative", async () => {
    (getInitiative as Mock).mockReturnValue(null);

    await expect(
      InitiativePage({ params: Promise.resolve({ slug: "missing" }) }),
    ).rejects.toThrow();
  });

  it("does not disguise unexpected page failures as missing content", async () => {
    (getInitiative as Mock).mockImplementation(() => {
      throw new Error("Repository unavailable");
    });

    await expect(
      InitiativePage({ params: Promise.resolve({ slug: "known" }) }),
    ).rejects.toThrow("Repository unavailable");
  });

  it("uses not-found metadata for an unknown initiative", async () => {
    (getInitiative as Mock).mockReturnValue(null);

    await expect(
      generateMetadata({ params: Promise.resolve({ slug: "missing" }) }),
    ).resolves.toEqual({ title: "Initiative Not Found" });
  });

  it("does not disguise unexpected metadata failures as missing content", async () => {
    (getInitiative as Mock).mockImplementation(() => {
      throw new Error("Repository unavailable");
    });

    await expect(
      generateMetadata({ params: Promise.resolve({ slug: "known" }) }),
    ).rejects.toThrow("Repository unavailable");
  });
});
