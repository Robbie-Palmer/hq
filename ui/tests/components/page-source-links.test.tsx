import { fireEvent, render, screen } from "@testing-library/react";
import posthog from "posthog-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PageSourceLinks } from "@/components/page-source-links";
import { siteConfig } from "@/lib/config/site-config";

const navigation = vi.hoisted(() => ({ pathname: "/ideas/data-provenance" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

vi.mock("posthog-js", () => ({
  default: { capture: vi.fn() },
}));

describe("PageSourceLinks", () => {
  beforeEach(() => {
    navigation.pathname = "/ideas/data-provenance";
    vi.mocked(posthog.capture).mockReset();
  });

  it("links the current page and repository separately", () => {
    render(<PageSourceLinks />);

    expect(screen.getByRole("link", { name: "Page source" })).toHaveAttribute(
      "href",
      `${siteConfig.author.sourceRepo}/blob/main/ui/content/ideas/data-provenance.mdx`,
    );
    expect(screen.getByRole("link", { name: "Repository" })).toHaveAttribute(
      "href",
      siteConfig.author.sourceRepo,
    );
  });

  it("records the resolved source kind", () => {
    render(<PageSourceLinks />);

    fireEvent.click(screen.getByRole("link", { name: "Page source" }));

    expect(posthog.capture).toHaveBeenCalledWith("source_code_viewed", {
      source: "page_footer",
      source_kind: "repository-file",
      pathname: navigation.pathname,
      url: `${siteConfig.author.sourceRepo}/blob/main/ui/content/ideas/data-provenance.mdx`,
    });
  });

  it("records repository navigation separately", () => {
    render(<PageSourceLinks />);

    fireEvent.click(screen.getByRole("link", { name: "Repository" }));

    expect(posthog.capture).toHaveBeenCalledWith("source_code_viewed", {
      source: "repository_footer",
      pathname: navigation.pathname,
      url: siteConfig.author.sourceRepo,
    });
  });

  it("shows the runtime source fallback without hiding the repository", () => {
    navigation.pathname = "/recipes/settings";

    render(<PageSourceLinks />);

    expect(screen.getByRole("link", { name: "Page source" })).toHaveAttribute(
      "href",
      `${siteConfig.author.sourceRepo}/tree/main/ui/app/recipes`,
    );
    expect(screen.getByRole("link", { name: "Repository" })).toBeVisible();
  });
});
