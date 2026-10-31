import type { Metadata } from "next";
import { MusicWorkflow } from "@/app/_projects/wedding-planner/routes/feature-workflows";

export const metadata: Metadata = { title: "Music" };

export default function WeddingMusicPage() {
  return <MusicWorkflow />;
}
