import type { Metadata } from "next";
import { ExportsWorkflow } from "@/app/_projects/wedding-planner/routes/feature-workflows";

export const metadata: Metadata = { title: "Exports" };

export default function WeddingExportsPage() {
  return <ExportsWorkflow />;
}
