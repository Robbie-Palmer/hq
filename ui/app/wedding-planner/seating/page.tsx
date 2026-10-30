import type { Metadata } from "next";
import { SeatingWorkflow } from "@/app/_projects/wedding-planner/routes/feature-workflows";

export const metadata: Metadata = { title: "Seating" };

export default function WeddingSeatingPage() {
  return <SeatingWorkflow />;
}
