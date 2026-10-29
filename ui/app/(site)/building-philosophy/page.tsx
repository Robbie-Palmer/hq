import type { Metadata } from "next";
import Link from "next/link";
import { Markdown } from "@/components/markdown";
import { getBuildingPhilosophy } from "@/lib/api/projects";
import { buildingPhilosophyPage } from "@/lib/content/building-philosophy";

export const metadata: Metadata = {
  title: buildingPhilosophyPage.title,
  description: buildingPhilosophyPage.description,
  alternates: {
    canonical: buildingPhilosophyPage.path,
    types: { "text/markdown": buildingPhilosophyPage.markdownPath },
  },
  openGraph: {
    title: buildingPhilosophyPage.title,
    description: buildingPhilosophyPage.description,
    url: buildingPhilosophyPage.path,
  },
};

export default function BuildingPhilosophyPage() {
  return (
    <div className="container mx-auto max-w-5xl px-4 py-8">
      <nav
        aria-label="Breadcrumb"
        className="mb-8 flex items-center gap-2 text-sm text-muted-foreground"
      >
        <Link
          href="/projects"
          className="hover:underline hover:underline-offset-4"
        >
          Projects
        </Link>
        <span>/</span>
        <span>{buildingPhilosophyPage.title}</span>
      </nav>

      <Markdown source={getBuildingPhilosophy()} />
    </div>
  );
}
