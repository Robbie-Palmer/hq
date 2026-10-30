import type { Metadata } from "next";
import { TermReviewDashboard } from "@/components/recipes/admin/term-review-dashboard";

export const metadata: Metadata = {
  title: "Term review",
  description: "Review unresolved ingredient and equipment terms.",
};

export default function TermReviewPage() {
  return <TermReviewDashboard />;
}
