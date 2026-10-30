import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { experiences as canonicalExperiences } from "../../ui/content/experience";
import { siteConfig } from "../../ui/lib/config/site-config";
import type {
  ResumeExperience,
  ResumeProject,
  ResumeSource,
  ResumeSourceFile,
} from "./model";

const EXPERIENCE_SOURCE_PATH = "ui/content/experience.ts";
const SITE_CONFIG_SOURCE_PATH = "ui/lib/config/site-config.ts";
const PROJECT_DIRECTORY = "ui/content/projects";
const INCLUDED_PROJECT_STATUSES = new Set([
  "completed",
  "in_progress",
  "live",
]);
const MAX_PROJECTS = 5;
const MAX_SKILLS = 16;

interface ProjectFrontmatter {
  title?: unknown;
  description?: unknown;
  date?: unknown;
  updated?: unknown;
  status?: unknown;
  role?: unknown;
  tech_stack?: unknown;
  repo_url?: unknown;
  demo_url?: unknown;
}

interface LoadedProjectSource {
  project: ResumeProject;
  file: ResumeSourceFile;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function requireString(
  value: unknown,
  field: string,
  sourcePath: string,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${sourcePath} has no string '${field}' field`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function parseFrontmatter(source: string, sourcePath: string): ProjectFrontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!match?.[1]) {
    throw new Error(`${sourcePath} has no YAML frontmatter`);
  }
  const parsed: unknown = parse(match[1]);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${sourcePath} frontmatter must be a mapping`);
  }
  return parsed as ProjectFrontmatter;
}

function projectSortKey(project: ResumeProject): string {
  return `${project.updated ?? project.date}\0${project.date}\0${project.title}`;
}

function selectProjects(projects: ResumeProject[]): ResumeProject[] {
  return projects
    .filter(
      (project) =>
        INCLUDED_PROJECT_STATUSES.has(project.status) &&
        Boolean(project.role || project.repositoryUrl || project.demoUrl),
    )
    .sort((left, right) =>
      projectSortKey(right).localeCompare(projectSortKey(left)),
    )
    .slice(0, MAX_PROJECTS);
}

function selectSkills(experiences: ResumeExperience[]): string[] {
  const counts = new Map<string, number>();
  for (const experience of experiences.slice(0, 5)) {
    for (const technology of experience.technologies) {
      counts.set(technology, (counts.get(technology) ?? 0) + 1);
    }
  }
  return [...counts]
    .sort(
      ([leftName, leftCount], [rightName, rightCount]) =>
        rightCount - leftCount || leftName.localeCompare(rightName),
    )
    .slice(0, MAX_SKILLS)
    .map(([name]) => name);
}

async function loadProjectSource(
  repositoryRoot: string,
  slug: string,
): Promise<LoadedProjectSource | undefined> {
  const sourcePath = `${PROJECT_DIRECTORY}/${slug}/index.mdx`;
  let source: string;
  try {
    source = await readFile(path.join(repositoryRoot, sourcePath), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const frontmatter = parseFrontmatter(source, sourcePath);
  return {
    file: { path: sourcePath, sha256: sha256(source) },
    project: {
      slug,
      title: requireString(frontmatter.title, "title", sourcePath),
      description: requireString(
        frontmatter.description,
        "description",
        sourcePath,
      ),
      date: requireString(frontmatter.date, "date", sourcePath),
      updated: optionalString(frontmatter.updated),
      status: requireString(frontmatter.status, "status", sourcePath),
      role: optionalString(frontmatter.role),
      technologies: stringArray(frontmatter.tech_stack),
      repositoryUrl: optionalString(frontmatter.repo_url),
      demoUrl: optionalString(frontmatter.demo_url),
      canonicalUrl: `${siteConfig.url}/projects/${slug}`,
      sourcePath,
    },
  };
}

async function loadProjectSources(
  repositoryRoot: string,
): Promise<{ projects: ResumeProject[]; files: ResumeSourceFile[] }> {
  const absoluteDirectory = path.join(repositoryRoot, PROJECT_DIRECTORY);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const projectDirectories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const loadedProjects = (
    await Promise.all(
      projectDirectories.map((slug) => loadProjectSource(repositoryRoot, slug)),
    )
  ).filter((entry): entry is LoadedProjectSource => entry !== undefined);

  return {
    projects: loadedProjects.map(({ project }) => project),
    files: loadedProjects.map(({ file }) => file),
  };
}

export async function loadResumeSource(
  repositoryRoot: string,
): Promise<ResumeSource> {
  const experiences: ResumeExperience[] = canonicalExperiences.map(
    (experience) => ({
      ...experience,
      sourcePath: EXPERIENCE_SOURCE_PATH,
    }),
  );
  const { projects: allProjects, files: projectFiles } =
    await loadProjectSources(repositoryRoot);
  const directFiles = await Promise.all(
    [EXPERIENCE_SOURCE_PATH, SITE_CONFIG_SOURCE_PATH].map(
      async (sourcePath): Promise<ResumeSourceFile> => {
        const source = await readFile(path.join(repositoryRoot, sourcePath));
        return { path: sourcePath, sha256: sha256(source) };
      },
    ),
  );
  const sourceFiles = [...directFiles, ...projectFiles].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  const sourceDigest = sha256(
    sourceFiles.map(({ path: filePath, sha256: hash }) => `${filePath}:${hash}`).join("\n"),
  );

  return {
    person: {
      name: siteConfig.author.name,
      website: siteConfig.url,
      github: siteConfig.author.github,
      linkedin: siteConfig.author.linkedin,
    },
    experiences,
    projects: selectProjects(allProjects),
    skills: selectSkills(experiences),
    sourceFiles,
    sourceDigest,
  };
}
