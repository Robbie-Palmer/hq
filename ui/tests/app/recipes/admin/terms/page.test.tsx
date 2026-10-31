import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TermReviewPage, { metadata } from "@/app/recipes/admin/terms/page";

vi.mock("@/components/recipes/admin/term-review-dashboard", () => ({
  TermReviewDashboard: () => <div>Reviewer dashboard</div>,
}));

describe("term review page", () => {
  it("renders the reviewer dashboard with descriptive metadata", () => {
    render(<TermReviewPage />);

    expect(screen.getByText("Reviewer dashboard")).toBeInTheDocument();
    expect(metadata).toMatchObject({
      title: "Term review",
      description: "Review unresolved ingredient and equipment terms.",
      robots: { index: false, follow: false },
    });
  });
});
