import type { Metadata } from "next";
import { ReadinessWorkflow } from "@/app/_projects/wedding-planner/routes/feature-workflows";

export const metadata: Metadata = { title: "Readiness" };

export default function WeddingReadinessPage() {
  return <ReadinessWorkflow />;
}
