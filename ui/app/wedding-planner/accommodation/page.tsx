import type { Metadata } from "next";
import { AccommodationWorkflow } from "@/app/_projects/wedding-planner/routes/workflow";

export const metadata: Metadata = { title: "Accommodation" };

export default function WeddingAccommodationPage() {
  return <AccommodationWorkflow view="bed_groups" />;
}
