import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { EditorView } from "@/app/_projects/wedding-planner/components/accommodation-editor";
import { AccommodationWorkflow } from "@/app/_projects/wedding-planner/routes/workflow";

const steps = {
  sharing: "sharing",
  inventory: "inventory",
  rooms: "plan",
  result: "result",
} as const satisfies Record<string, EditorView>;

type Step = keyof typeof steps;

export const metadata: Metadata = { title: "Accommodation" };

export function generateStaticParams() {
  return Object.keys(steps).map((step) => ({ step }));
}

export default async function WeddingAccommodationStepPage({
  params,
}: Readonly<{ params: Promise<{ step: string }> }>) {
  const { step } = await params;
  if (!(step in steps)) notFound();
  return <AccommodationWorkflow view={steps[step as Step]} />;
}
