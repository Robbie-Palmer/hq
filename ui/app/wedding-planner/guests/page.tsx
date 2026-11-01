import type { Metadata } from "next";
import { GuestWorkflow } from "@/app/_projects/wedding-planner/routes/workflow";

export const metadata: Metadata = { title: "Guests" };

export default function WeddingGuestsPage() {
  return <GuestWorkflow />;
}
