import type { Metadata } from "next";
import { ProductDecisionList } from "@/components/projects/product-decision-list";
import { getAllProductDecisions } from "@/lib/api/product-decisions";

export const metadata: Metadata = {
  title: "Product decisions",
  description: "Project decisions about product behaviour, scope, and policy.",
  alternates: { canonical: "/product-decisions" },
};

export default function ProductDecisionIndex() {
  return (
    <div className="container mx-auto max-w-6xl px-4 py-12">
      <header className="mb-10 max-w-3xl space-y-4">
        <h1 className="text-4xl font-bold md:text-5xl">Product decisions</h1>
        <p className="text-xl leading-relaxed text-muted-foreground">
          Decisions from each project's product history, with their context and
          evidence.
        </p>
      </header>
      <ProductDecisionList decisions={getAllProductDecisions()} />
    </div>
  );
}
