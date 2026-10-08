import { render, screen, within } from "@testing-library/react";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProductDecisionPage, {
  generateMetadata,
  generateStaticParams,
} from "@/app/(site)/product-decisions/[[...slug]]/page";
import {
  getAllProductDecisions,
  getProductDecision,
} from "@/lib/api/product-decisions";

const { notFoundMock } = vi.hoisted(() => ({
  notFoundMock: vi.fn(() => {
    throw new Error("not found");
  }),
}));

vi.mock("next/navigation", () => ({ notFound: notFoundMock }));
vi.mock("@/lib/api/product-decisions", () => ({
  getAllProductDecisions: vi.fn(),
  getProductDecision: vi.fn(),
}));
vi.mock("@/components/markdown", () => ({
  Markdown: ({ source }: { source: string }) => <div>{source}</div>,
}));

const decision = {
  slug: "002-new-policy",
  title: "PDR 002: New policy",
  date: "2026-10-08",
  status: "Accepted",
  authoredStatus: "Accepted",
  decisionDate: "2026-10-08",
  supersedes: "001-old-policy",
  supersededBy: "003-next-policy",
  content: "## Decision\n\nAdopt the new policy.",
  readingTime: "2 min read",
  backlinks: {
    projects: [{ slug: "project-one", title: "Project One" }],
    ideas: [{ slug: "clear-policy", title: "Clear policy" }],
    informedByADRs: [
      {
        adrRef: "project-one:001-context",
        projectSlug: "project-one",
        slug: "001-context",
        title: "ADR 001: Context",
      },
    ],
    implementingADRs: [
      {
        adrRef: "project-one:002-implementation",
        projectSlug: "project-one",
        slug: "002-implementation",
        title: "ADR 002: Implementation",
      },
    ],
    blogs: [{ slug: "policy-explained", title: "Policy explained" }],
    evidence: [{ title: "Research report", url: "https://example.com/report" }],
  },
};

describe("product decision pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getAllProductDecisions as Mock).mockReturnValue([]);
  });

  it("renders the empty index and index metadata", async () => {
    render(
      await ProductDecisionPage({ params: Promise.resolve({ slug: [] }) }),
    );
    expect(
      screen.getByRole("heading", { name: "Product decisions" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No product decisions have been published yet."),
    ).toBeInTheDocument();
    await expect(
      generateMetadata({ params: Promise.resolve({}) }),
    ).resolves.toEqual({
      title: "Product decisions",
      description:
        "Durable choices about product behaviour, scope, and policy.",
      alternates: { canonical: "/product-decisions" },
    });
  });

  it("generates routes and renders decision cards", async () => {
    (getAllProductDecisions as Mock).mockReturnValue([decision]);
    expect(generateStaticParams()).toEqual([
      { slug: [] },
      { slug: ["002-new-policy"] },
    ]);
    render(
      await ProductDecisionPage({ params: Promise.resolve({ slug: [] }) }),
    );
    expect(
      screen.getByRole("link", { name: /PDR 002: New policy/ }),
    ).toHaveAttribute("href", "/product-decisions/002-new-policy");
    expect(screen.getByText(/Opened 2026-10-08/)).toBeInTheDocument();
  });

  it("generates detail and missing metadata", async () => {
    (getProductDecision as Mock)
      .mockReturnValueOnce(decision)
      .mockReturnValueOnce(null);
    await expect(
      generateMetadata({
        params: Promise.resolve({ slug: ["002-new-policy"] }),
      }),
    ).resolves.toEqual({
      title: "PDR 002: New policy - Product decision",
      description: "Product Decision Record: PDR 002: New policy",
      alternates: {
        canonical: "https://robbiepalmer.me/product-decisions/002-new-policy",
      },
    });
    await expect(
      generateMetadata({ params: Promise.resolve({ slug: ["missing"] }) }),
    ).resolves.toEqual({ title: "Product decision not found" });
  });

  it("renders a decision and every related-record type", async () => {
    (getProductDecision as Mock).mockReturnValue(decision);
    render(
      await ProductDecisionPage({
        params: Promise.resolve({ slug: ["002-new-policy"] }),
      }),
    );
    expect(
      screen.getByRole("heading", { name: "PDR 002: New policy" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Adopt the new policy/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "001-old-policy" }),
    ).toHaveAttribute("href", "/product-decisions/001-old-policy");
    expect(
      screen.getByRole("link", { name: "003-next-policy" }),
    ).toHaveAttribute("href", "/product-decisions/003-next-policy");

    const related = screen.getByRole("region", { name: "Related records" });
    const expectedLinks = [
      ["Project One", "/projects/project-one"],
      ["Clear policy", "/ideas/clear-policy"],
      ["ADR 001: Context", "/projects/project-one/adrs/001-context"],
      [
        "ADR 002: Implementation",
        "/projects/project-one/adrs/002-implementation",
      ],
      ["Policy explained", "/blog/policy-explained"],
    ];
    for (const [name, href] of expectedLinks) {
      expect(within(related).getByRole("link", { name })).toHaveAttribute(
        "href",
        href,
      );
    }
    expect(
      within(related).getByRole("link", { name: /Research report/ }),
    ).toHaveAttribute("target", "_blank");
  });

  it("uses the not-found boundary for unknown and nested routes", async () => {
    (getProductDecision as Mock).mockReturnValue(null);
    await expect(
      ProductDecisionPage({ params: Promise.resolve({ slug: ["missing"] }) }),
    ).rejects.toThrow("not found");
    await expect(
      ProductDecisionPage({
        params: Promise.resolve({ slug: ["002-new-policy", "extra"] }),
      }),
    ).rejects.toThrow("not found");
    expect(notFoundMock).toHaveBeenCalledTimes(2);
  });
});
