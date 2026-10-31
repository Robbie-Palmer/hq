import type { Metadata } from "next";
import { getAllExperience } from "@/lib/api/experience";
import { getAllProjects } from "@/lib/api/projects";
import { siteConfig } from "@/lib/config/site-config";
import { buildResumeData } from "./resume-data";
import { ResumeDocument } from "./resume-document";

const pageDescription =
  "A print-ready résumé generated in the browser from Robbie Palmer's canonical experience and project content.";

export const metadata: Metadata = {
  title: "Résumé",
  description: pageDescription,
  alternates: { canonical: `${siteConfig.url}/resume` },
  openGraph: {
    title: `Résumé - ${siteConfig.author.name}`,
    description: pageDescription,
    url: `${siteConfig.url}/resume`,
  },
};

export default function ResumePage() {
  const data = buildResumeData(getAllExperience(), getAllProjects(), {
    name: siteConfig.author.name,
    website: siteConfig.url,
    github: siteConfig.author.github,
    linkedin: siteConfig.author.linkedin,
  });
  return <ResumeDocument data={data} />;
}
