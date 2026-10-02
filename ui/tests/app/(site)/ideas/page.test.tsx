import { render, screen, within } from "@testing-library/react";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import IdeaPage, {
  generateMetadata,
  generateStaticParams,
} from "@/app/(site)/ideas/[slug]/page";
import IdeasPage from "@/app/(site)/ideas/page";
import { getAllIdeas, getIdea } from "@/lib/api/ideas";

vi.mock("@/lib/api/ideas", () => ({
  getAllIdeaSlugs: () => ["goodharts-law", "eventstorming"],
  getAllIdeas: vi.fn(),
  getIdea: vi.fn(),
}));

vi.mock("@/components/markdown", () => ({
  Markdown: ({ source }: { source: string }) => <div>{source}</div>,
}));

const idea = {
  slug: "goodharts-law",
  title: "Goodhart's Law",
  description: "Measures can lose their value when they become targets.",
  sourceUrl: "https://example.com/goodhart",
  content: "## How I use it",
  relatedIdeas: [
    {
      slug: "dora-metrics",
      title: "DORA Metrics",
      description: "Delivery performance measures.",
    },
  ],
  relatedContent: {
    technologies: [
      {
        slug: "kafka",
        name: "Kafka",
        description: "Distributed event streaming platform",
        website: "https://kafka.apache.org",
        hasIcon: true,
      },
    ],
    projects: [
      {
        slug: "agentic-code-review",
        title: "Agentic Code Review",
        status: "in_progress",
      },
    ],
    blogs: [
      {
        slug: "platform-teams",
        title: "Platform Teams",
        date: "2026-08-18",
        readingTime: "6 min read",
      },
    ],
    adrs: [
      {
        slug: "048-zizmor",
        projectSlug: "personal-knowledge-graph",
        title: "ADR 049: Zizmor",
        status: "accepted",
      },
    ],
  },
};

describe("ideas pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the ideas index with singular and plural connection counts", () => {
    (getAllIdeas as Mock).mockReturnValue([
      { ...idea, referenceCount: 1 },
      {
        ...idea,
        slug: "eventstorming",
        title: "EventStorming",
        referenceCount: 2,
      },
    ]);

    render(<IdeasPage />);

    expect(screen.getByRole("heading", { name: "Ideas" })).toBeInTheDocument();
    expect(screen.getByText(/1 graph connection$/)).toBeInTheDocument();
    expect(screen.getByText(/2 graph connections$/)).toBeInTheDocument();
  });

  it("generates routes and metadata", async () => {
    (getIdea as Mock).mockReturnValue(idea);

    expect(generateStaticParams()).toEqual([
      { slug: "goodharts-law" },
      { slug: "eventstorming" },
    ]);
    await expect(
      generateMetadata({
        params: Promise.resolve({ slug: "goodharts-law" }),
      }),
    ).resolves.toEqual({
      title: "Goodhart's Law - Ideas",
      description: idea.description,
      alternates: {
        canonical: "https://robbiepalmer.me/ideas/goodharts-law",
      },
      openGraph: {
        title: "Goodhart's Law",
        description: idea.description,
        url: "https://robbiepalmer.me/ideas/goodharts-law",
      },
    });

    (getIdea as Mock).mockReturnValue(null);
    await expect(
      generateMetadata({ params: Promise.resolve({ slug: "missing" }) }),
    ).resolves.toEqual({ title: "Idea Not Found" });
  });

  it("renders the source, related ideas, and each backlink type", async () => {
    (getIdea as Mock).mockReturnValue(idea);

    render(
      await IdeaPage({
        params: Promise.resolve({ slug: "goodharts-law" }),
      }),
    );

    expect(
      screen.getByRole("heading", { name: "Goodhart's Law" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Read the source/ }),
    ).toHaveAttribute("href", idea.sourceUrl);
    expect(screen.getByRole("link", { name: "DORA Metrics" })).toHaveAttribute(
      "href",
      "/ideas/dora-metrics",
    );
    expect(screen.getByRole("link", { name: /^Kafka/ })).toHaveAttribute(
      "href",
      "/technologies/kafka",
    );
    expect(
      screen.getByRole("link", { name: /^Agentic Code Review/ }),
    ).toHaveAttribute("href", "/projects/agentic-code-review");
    expect(
      screen.getByRole("link", { name: /^Platform Teams/ }),
    ).toHaveAttribute("href", "/blog/platform-teams");
    expect(
      screen.getByRole("link", { name: /^ADR 049: Zizmor/ }),
    ).toHaveAttribute(
      "href",
      "/projects/personal-knowledge-graph/adrs/048-zizmor",
    );
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(
      within(breadcrumb).getByRole("link", { name: "Ideas" }),
    ).toHaveAttribute("href", "/ideas");
  });

  it("explains when an idea has no published references", async () => {
    (getIdea as Mock).mockReturnValue({
      ...idea,
      sourceUrl: undefined,
      relatedIdeas: [],
      relatedContent: { technologies: [], projects: [], blogs: [], adrs: [] },
    });

    render(
      await IdeaPage({
        params: Promise.resolve({ slug: "eventstorming" }),
      }),
    );

    expect(screen.queryByRole("link", { name: /Read the source/ })).toBeNull();
    expect(
      screen.getByText(/has no technology or published-content references/),
    ).toBeInTheDocument();
  });

  it("uses the not-found boundary for an unknown idea", async () => {
    (getIdea as Mock).mockReturnValue(null);

    await expect(
      IdeaPage({ params: Promise.resolve({ slug: "missing" }) }),
    ).rejects.toThrow();
  });
});
