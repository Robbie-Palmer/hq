import type { Experience } from "@/lib/api/experience";
import type { Project } from "@/lib/api/projects";

const INCLUDED_PROJECT_STATUSES = new Set(["completed", "in_progress", "live"]);
const INDEPENDENT_PROJECT_LIMIT = 2;
const SKILL_LIMIT = 15;
const PROFESSIONAL_PROJECT_SELECTIONS = [
  { experienceIndex: 0, responsibilityIndex: 0 },
  { experienceIndex: 1, responsibilityIndex: 1 },
  { experienceIndex: 2, responsibilityIndex: 3 },
  { experienceIndex: 3, responsibilityIndex: 5 },
] as const;

export interface ResumeProject {
  slug: string;
  title: string;
  description: string;
  technologies: string[];
  repositoryUrl?: string;
}

export interface ResumeProfessionalProject {
  company: string;
  companyUrl: string;
  description: string;
  experienceStartDate: string;
  technologies: string[];
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
  independentProjects: ResumeProject[];
  professionalProjects: ResumeProfessionalProject[];
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

function selectIndependentProjects(projects: Project[]): ResumeProject[] {
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
    .slice(0, INDEPENDENT_PROJECT_LIMIT)
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

function selectProfessionalProjects(
  experiences: Experience[],
): ResumeProfessionalProject[] {
  return PROFESSIONAL_PROJECT_SELECTIONS.flatMap(
    ({ experienceIndex, responsibilityIndex }) => {
      const experience = experiences[experienceIndex];
      const description = experience?.responsibilities[responsibilityIndex];
      if (!experience || !description) return [];
      return [
        {
          company: experience.company,
          companyUrl: experience.companyUrl,
          description,
          experienceStartDate: experience.startDate,
          technologies: experience.technologies.slice(0, 4),
        },
      ];
    },
  );
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
    independentProjects: selectIndependentProjects(projects),
    professionalProjects: selectProfessionalProjects(experiences),
    skills: selectSkills(experiences),
  };
}
