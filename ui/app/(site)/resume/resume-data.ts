import type { Experience } from "@/lib/api/experience";
import type { Project } from "@/lib/api/projects";

const INCLUDED_PROJECT_STATUSES = new Set(["completed", "in_progress", "live"]);
const PROJECT_LIMIT = 5;
const SKILL_LIMIT = 15;

export interface ResumeProject {
  slug: string;
  title: string;
  description: string;
  technologies: string[];
  repositoryUrl?: string;
}

export interface ResumeData {
  person: {
    name: string;
    website: string;
    github: string;
    linkedin: string;
  };
  headline: string;
  summary: string;
  experiences: Experience[];
  projects: ResumeProject[];
  skills: string[];
}

interface ResumeProfile {
  name: string;
  website: string;
  github: string;
  linkedin: string;
}

function projectSortKey(project: Project): string {
  return `${project.updated ?? project.date}\0${project.date}\0${project.title}`;
}

function selectProjects(projects: Project[]): ResumeProject[] {
  return projects
    .filter(
      (project) =>
        INCLUDED_PROJECT_STATUSES.has(project.status) &&
        Boolean(
          project.role ||
            project.repoUrl ||
            project.demoUrl ||
            project.productUrl,
        ),
    )
    .sort((left, right) =>
      projectSortKey(right).localeCompare(projectSortKey(left), "en"),
    )
    .slice(0, PROJECT_LIMIT)
    .map((project) => ({
      slug: project.slug,
      title: project.title,
      description: project.description,
      technologies: project.technologies
        .slice(0, 7)
        .map((technology) => technology.name),
      repositoryUrl: project.repoUrl,
    }));
}

function selectSkills(experiences: Experience[]): string[] {
  const counts = new Map<string, number>();
  for (const experience of experiences.slice(0, 5)) {
    for (const technology of experience.technologies) {
      counts.set(technology, (counts.get(technology) ?? 0) + 1);
    }
  }
  return [...counts]
    .sort(
      ([leftName, leftCount], [rightName, rightCount]) =>
        rightCount - leftCount || leftName.localeCompare(rightName, "en"),
    )
    .slice(0, SKILL_LIMIT)
    .map(([name]) => name);
}

export function buildResumeData(
  experiences: Experience[],
  projects: Project[],
  profile: ResumeProfile,
): ResumeData {
  const currentExperience = experiences[0];
  if (!currentExperience) {
    throw new Error("The résumé needs at least one canonical experience");
  }
  return {
    person: profile,
    headline: currentExperience.title,
    summary: currentExperience.description,
    experiences,
    projects: selectProjects(projects),
    skills: selectSkills(experiences),
  };
}
