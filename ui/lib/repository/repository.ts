import fs from "node:fs";
import path from "node:path";
import { isValid, parse } from "date-fns";
import readingTime from "reading-time";
import { parse as parseYaml } from "yaml";
import { experiences as definedExperiences } from "../../content/experience";
import { technologies as definedTechnologies } from "../../content/technologies";
import { parseFrontmatter } from "../content/frontmatter";
import {
  type ADR,
  type ADRRef,
  type ADRRelations,
  ADRSchema,
  makeADRRef,
} from "../domain/adr/adr";
import {
  type BlogPost,
  BlogPostSchema,
  type BlogRelations,
  type BlogSlug,
} from "../domain/blog/blogPost";
import {
  type Idea,
  type IdeaRelations,
  IdeaRelationsSchema,
  IdeaSchema,
  type IdeaSlug,
} from "../domain/idea/idea";
import {
  type Initiative,
  InitiativeSchema,
  type InitiativeSlug,
} from "../domain/initiative/initiative";
import {
  compareUtcInstants,
  type DefaultOverride,
  DefaultOverrideSchema,
  type DefaultSelection,
  type PlatformManifest,
  PlatformManifestSchema,
  type ProjectLayerUse,
} from "../domain/platform/platform";
import { type PitchDeck, PitchDeckSchema } from "../domain/project/pitchDeck";
import {
  type Project,
  type ProjectRelations,
  ProjectRelationsSchema,
  ProjectSchema,
  type ProjectSlug,
} from "../domain/project/project";
import {
  type JobRole,
  JobRoleSchema,
  type RoleRelations,
  type RoleSlug,
} from "../domain/role/jobRole";
import { ProjectSlugSchema } from "../domain/slugs";
import {
  type Technology,
  TechnologySchema,
  type TechnologySlug,
} from "../domain/technology/technology";
import { normalizeSlug } from "../generic/slugs";
import {
  buildContentGraph,
  type ContentGraph,
  createEmptyRelationData,
  type RelationData,
} from "./graph";

// Validation types
export type DomainValidationResult<T> =
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      schemaErrors?: import("zod").ZodError;
      referentialErrors?: ReferentialIntegrityError[];
    };

export interface ReferentialIntegrityError {
  type: "missing_reference" | "invalid_reference" | "circular_reference";
  entity: string;
  field: string;
  value: string;
  message: string;
}

const CONTENT_DIR = path.join(process.cwd(), "content");
const BLOG_DIR = path.join(CONTENT_DIR, "blog");
const INITIATIVES_DIR = path.join(CONTENT_DIR, "initiatives");
const IDEAS_DIR = path.join(CONTENT_DIR, "ideas");
const PROJECTS_DIR = path.join(CONTENT_DIR, "projects");
const BUILDING_PHILOSOPHY_PATH = path.join(
  PROJECTS_DIR,
  "building-philosophy.mdx",
);
const PLATFORM_MANIFEST_PATH = path.join(
  PROJECTS_DIR,
  "personal-engineering-platform",
  "platform.yaml",
);

function projectDirectories(): string[] {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  return fs
    .readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);
}

export function loadTechnologies(): Map<TechnologySlug, Technology> {
  const techMap = new Map<TechnologySlug, Technology>();

  for (const techContent of definedTechnologies) {
    const slug = (techContent.slug ||
      normalizeSlug(techContent.name)) as TechnologySlug;
    const tech: Technology = {
      ...techContent,
      slug,
      ideas: techContent.ideas ?? [],
    };
    techMap.set(slug, tech);
  }

  return techMap;
}

function collectProjectTechnologyReferences(
  projectSlug: string,
  collectMissingTech: (name: string, source: string) => void,
): void {
  const projectPath = path.join(PROJECTS_DIR, projectSlug, "index.mdx");
  if (!fs.existsSync(projectPath)) return;
  const { data } = parseFrontmatter(fs.readFileSync(projectPath, "utf-8"));
  if (Array.isArray(data.tech_stack)) {
    for (const tech of data.tech_stack) {
      collectMissingTech(tech, `project: ${projectSlug}`);
    }
  }
  const adrsDir = path.join(PROJECTS_DIR, projectSlug, "adrs");
  if (!fs.existsSync(adrsDir)) return;
  for (const adrFile of fs
    .readdirSync(adrsDir)
    .filter((file) => file.endsWith(".mdx"))) {
    const { data: adrData } = parseFrontmatter(
      fs.readFileSync(path.join(adrsDir, adrFile), "utf-8"),
    );
    if (!Array.isArray(adrData.tech_stack)) continue;
    for (const tech of adrData.tech_stack) {
      collectMissingTech(tech, `ADR: ${projectSlug}/${adrFile}`);
    }
  }
}

// Validate that all referenced technologies are defined
export function validateTechnologyReferences(
  technologies: Map<TechnologySlug, Technology>,
): void {
  const missingTechs = new Set<string>();
  const collectMissingTech = (name: string, source: string) => {
    const slug = normalizeSlug(name);
    if (!technologies.has(slug)) {
      missingTechs.add(`"${name}" (referenced in ${source})`);
    }
  };

  // Check experience technologies
  for (const exp of definedExperiences) {
    for (const tech of exp.technologies) {
      collectMissingTech(tech, `experience: ${exp.company}`);
    }
  }

  // Check project and ADR technologies
  if (fs.existsSync(PROJECTS_DIR)) {
    const projectDirs = fs
      .readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);

    projectDirs.forEach((projectSlug) => {
      collectProjectTechnologyReferences(projectSlug, collectMissingTech);
    });
  }

  // Check blog technologies
  if (fs.existsSync(BLOG_DIR)) {
    const blogFiles = fs
      .readdirSync(BLOG_DIR)
      .filter((f) => f.endsWith(".mdx") && f !== "README.mdx");
    blogFiles.forEach((blogFile) => {
      const blogPath = path.join(BLOG_DIR, blogFile);
      const blogContent = fs.readFileSync(blogPath, "utf-8");
      const { data: blogData } = parseFrontmatter(blogContent);
      if (Array.isArray(blogData.technologies)) {
        for (const tech of blogData.technologies) {
          collectMissingTech(tech, `blog: ${blogFile}`);
        }
      }
    });
  }

  if (missingTechs.size > 0) {
    const errorMessage = [
      "\n❌ ERROR: The following technologies are referenced but not defined in content/technologies.ts:",
      "",
      ...Array.from(missingTechs)
        .sort((a, b) => a.localeCompare(b, "en"))
        .map((tech) => `  - ${tech}`),
      "",
      "Please add these technologies to content/technologies.ts",
      "",
    ].join("\n");
    throw new Error(errorMessage);
  }
}

export function validateTechnology(
  tech: unknown,
): DomainValidationResult<Technology> {
  const result = TechnologySchema.safeParse(tech);
  if (!result.success) {
    return {
      success: false,
      schemaErrors: result.error,
    };
  }
  // Derive slug if not provided
  const slug = (result.data.slug ||
    normalizeSlug(result.data.name)) as TechnologySlug;
  return {
    success: true,
    data: {
      ...result.data,
      slug,
    },
  };
}

interface BlogLoadResult {
  entities: Map<BlogSlug, BlogPost>;
  relations: Map<BlogSlug, BlogRelations>;
}

interface IdeaLoadResult {
  entities: Map<IdeaSlug, Idea>;
  relations: Map<IdeaSlug, IdeaRelations>;
}

export function loadIdeas(): IdeaLoadResult {
  const entities = new Map<IdeaSlug, Idea>();
  const relations = new Map<IdeaSlug, IdeaRelations>();

  if (!fs.existsSync(IDEAS_DIR)) return { entities, relations };

  const files = fs
    .readdirSync(IDEAS_DIR)
    .filter((file) => file.endsWith(".mdx"))
    .sort((a, b) => a.localeCompare(b, "en"));

  for (const filename of files) {
    const slug = filename.replace(/\.mdx$/, "") as IdeaSlug;
    const fileContent = fs.readFileSync(
      path.join(IDEAS_DIR, filename),
      "utf-8",
    );
    const { data, content } = parseFrontmatter(fileContent);
    const ideaResult = IdeaSchema.safeParse({
      slug,
      title: data.title,
      description: data.description,
      sourceUrl: data.source_url,
      content,
    });
    const relationsResult = IdeaRelationsSchema.safeParse({
      relatedIdeas: (data.related_ideas || []).map((idea: string) =>
        normalizeSlug(idea),
      ),
    });

    if (!ideaResult.success || !relationsResult.success) {
      console.error(`Failed to validate idea ${slug}:`, {
        idea: ideaResult.error,
        relations: relationsResult.error,
      });
      throw new Error(`Idea ${slug} failed validation`);
    }
    entities.set(slug, ideaResult.data);
    relations.set(slug, relationsResult.data);
  }

  return { entities, relations };
}

export function loadBlogPosts(): BlogLoadResult {
  const entities = new Map<BlogSlug, BlogPost>();
  const relations = new Map<BlogSlug, BlogRelations>();

  if (!fs.existsSync(BLOG_DIR)) {
    return { entities, relations };
  }
  const files = fs
    .readdirSync(BLOG_DIR)
    .filter((file) => file.endsWith(".mdx") && file !== "README.mdx");

  files.forEach((filename) => {
    const slug = filename.replace(/\.mdx$/, "");
    const filePath = path.join(BLOG_DIR, filename);
    const fileContent = fs.readFileSync(filePath, "utf-8");
    const { data, content } = parseFrontmatter(fileContent);

    const post: BlogPost = {
      slug,
      title: data.title,
      description: data.description,
      date: data.date,
      updated: data.updated,
      canonicalUrl: data.canonical,
      content,
      readingTime: readingTime(content).text,
      image: data.image,
      imageAlt: data.imageAlt,
    };

    const blogRelations: BlogRelations = {
      technologies: (data.technologies || []).map((tech: string) =>
        normalizeSlug(tech),
      ),
      ideas: (data.ideas || []).map((idea: string) => normalizeSlug(idea)),
      tags: data.tags || [],
      role: data.role ? normalizeSlug(data.role) : undefined,
    };

    const validation = validateBlogPost(post);
    if (validation.success) {
      entities.set(slug, validation.data);
      relations.set(slug, blogRelations);
    } else {
      console.error(
        `Failed to validate blog post ${slug}:`,
        validation.schemaErrors,
      );
      throw new Error(`Blog post ${slug} failed validation`);
    }
  });

  return { entities, relations };
}

export function validateBlogPost(
  post: unknown,
): DomainValidationResult<BlogPost> {
  const result = BlogPostSchema.safeParse(post);
  if (!result.success) {
    return {
      success: false,
      schemaErrors: result.error,
    };
  }
  const dateValid = isValid(parse(result.data.date, "yyyy-MM-dd", new Date()));
  if (!dateValid) {
    return {
      success: false,
      referentialErrors: [
        {
          type: "invalid_reference",
          entity: "BlogPost",
          field: "date",
          value: result.data.date,
          message: `Invalid date format: ${result.data.date}`,
        },
      ],
    };
  }

  if (result.data.updated) {
    const updatedValid = isValid(
      parse(result.data.updated, "yyyy-MM-dd", new Date()),
    );
    if (!updatedValid) {
      return {
        success: false,
        referentialErrors: [
          {
            type: "invalid_reference",
            entity: "BlogPost",
            field: "updated",
            value: result.data.updated,
            message: `Invalid updated date format: ${result.data.updated}`,
          },
        ],
      };
    }
  }

  return {
    success: true,
    data: result.data,
  };
}

interface InitiativeLoadResult {
  entities: Map<InitiativeSlug, Initiative>;
}

export function loadInitiatives(): InitiativeLoadResult {
  const entities = new Map<InitiativeSlug, Initiative>();

  if (!fs.existsSync(INITIATIVES_DIR)) {
    return { entities };
  }

  const files = fs
    .readdirSync(INITIATIVES_DIR)
    .filter((file) => file.endsWith(".mdx"));

  for (const filename of files) {
    const slug = filename.replace(/\.mdx$/, "");
    const filePath = path.join(INITIATIVES_DIR, filename);
    const fileContent = fs.readFileSync(filePath, "utf-8");
    const { data, content } = parseFrontmatter(fileContent);
    const initiative: Initiative = {
      slug,
      title: data.title,
      description: data.description,
      date: data.date,
      updated: data.updated,
      status: data.status,
      projectContributions: data.project_contributions ?? {},
      content,
    };

    const validation = validateInitiative(initiative);
    if (!validation.success) {
      console.error(
        `Failed to validate initiative ${slug}:`,
        validation.schemaErrors,
      );
      throw new Error(`Initiative ${slug} failed validation`);
    }
    entities.set(slug, validation.data);
  }

  return { entities };
}

export function validateInitiative(
  initiative: unknown,
): DomainValidationResult<Initiative> {
  const result = InitiativeSchema.safeParse(initiative);
  if (!result.success) {
    return {
      success: false,
      schemaErrors: result.error,
    };
  }
  return {
    success: true,
    data: result.data,
  };
}

interface ProjectLoadResult {
  entities: Map<ProjectSlug, Project>;
  relations: Map<ProjectSlug, ProjectRelations>;
  aliases: Map<ProjectSlug, ProjectSlug>;
}

function parseProjectAliases(
  rawAliases: unknown,
  projectSlug: ProjectSlug,
): ProjectSlug[] {
  const validation = ProjectSlugSchema.array().safeParse(rawAliases ?? []);
  if (!validation.success) {
    console.error(
      `Failed to validate aliases for project ${projectSlug}:`,
      validation.error,
    );
    throw new Error(`Project ${projectSlug} aliases failed validation`);
  }
  return validation.data;
}

function registerProjectAliases(
  aliases: Map<ProjectSlug, ProjectSlug>,
  projectAliases: ProjectSlug[],
  projectSlug: ProjectSlug,
): void {
  for (const alias of projectAliases) {
    const existingTarget = aliases.get(alias);
    if (existingTarget) {
      throw new Error(
        `Project alias '${alias}' points to both '${existingTarget}' and '${projectSlug}'`,
      );
    }
    aliases.set(alias, projectSlug);
  }
}

function loadPitchDeck(projectSlug: string): PitchDeck | undefined {
  const pitchPath = path.join(PROJECTS_DIR, projectSlug, "pitch.mdx");
  if (!fs.existsSync(pitchPath)) return undefined;
  const { data, content } = parseFrontmatter(
    fs.readFileSync(pitchPath, "utf-8"),
  );
  const result = PitchDeckSchema.safeParse({
    title: data.title,
    description: data.description,
    content,
  });
  if (result.success) return result.data;
  console.error(`Failed to validate pitch deck ${projectSlug}:`, result.error);
  throw new Error(`Pitch deck ${projectSlug} failed validation`);
}

function loadProjectAdrRefs(projectSlug: string): ADRRef[] {
  const adrsDir = path.join(PROJECTS_DIR, projectSlug, "adrs");
  if (!fs.existsSync(adrsDir)) return [];
  return fs
    .readdirSync(adrsDir)
    .filter((file) => file.endsWith(".mdx"))
    .sort((left, right) => left.localeCompare(right, "en"))
    .flatMap((adrFile) => {
      const adrSlug = adrFile.replace(/\.mdx$/, "");
      const { data } = parseFrontmatter(
        fs.readFileSync(path.join(adrsDir, adrFile), "utf-8"),
      );
      return typeof data.inherits_from === "string"
        ? []
        : [makeADRRef(projectSlug, adrSlug)];
    });
}

function parseProjectInitiatives(raw: unknown, projectSlug: string) {
  const normalized = Array.isArray(raw)
    ? raw.map((initiative) =>
        typeof initiative === "string" ? normalizeSlug(initiative) : initiative,
      )
    : raw;
  const result = ProjectRelationsSchema.shape.initiatives.safeParse(normalized);
  if (result.success) return result.data;
  console.error(`Failed to validate project ${projectSlug}:`, result.error);
  throw new Error(`Project ${projectSlug} failed validation`);
}

function parseProjectPlatformLayers(raw: unknown, projectSlug: string) {
  const normalized = Array.isArray(raw)
    ? raw.map((entry) => {
        const use = entry as Record<string, unknown>;
        const slots = Array.isArray(use.slots) ? use.slots : [];
        return {
          layer: use.layer,
          adopted: use.adopted,
          until: use.until,
          tracking: use.tracking,
          decision: use.decision,
          rationale: use.rationale,
          slots: slots.map((entry) => {
            const slot = entry as Record<string, unknown>;
            return {
              slot: slot.slot,
              adopted: slot.adopted,
              until: slot.until,
              decision: slot.decision,
              rationale: slot.rationale,
            };
          }),
        };
      })
    : raw;
  const result =
    ProjectRelationsSchema.shape.platformLayers.safeParse(normalized);
  if (result.success) return result.data;
  console.error(
    `Failed to validate platform layers for ${projectSlug}:`,
    result.error,
  );
  throw new Error(`Project ${projectSlug} failed validation`);
}

export function loadProjects(): ProjectLoadResult {
  const entities = new Map<ProjectSlug, Project>();
  const relations = new Map<ProjectSlug, ProjectRelations>();
  const aliases = new Map<ProjectSlug, ProjectSlug>();

  const projectDirs = projectDirectories();

  projectDirs.forEach((projectSlug) => {
    const projectPath = path.join(PROJECTS_DIR, projectSlug, "index.mdx");
    if (!fs.existsSync(projectPath)) {
      return;
    }
    const fileContent = fs.readFileSync(projectPath, "utf-8");
    const { data, content } = parseFrontmatter(fileContent);

    const pitch = loadPitchDeck(projectSlug);
    const adrRefs = loadProjectAdrRefs(projectSlug);
    if (Array.isArray(data.inherits_adrs) && data.inherits_adrs.length > 0) {
      throw new Error(
        `Project ${projectSlug} uses deprecated 'inherits_adrs'. Use inherited ADR stub files in ${projectSlug}/adrs/ with 'inherits_from' instead.`,
      );
    }

    const technologies: TechnologySlug[] = (data.tech_stack || []).map(
      (tech: string) => normalizeSlug(tech),
    );
    const projectAliases = parseProjectAliases(data.aliases, projectSlug);

    const project: Project = {
      slug: projectSlug,
      title: data.title,
      description: data.description,
      date: data.date,
      updated: data.updated,
      status: data.status,
      repoUrl: data.repo_url,
      demoUrl: data.demo_url,
      productUrl: data.product_url,
      paperUrl: data.paper_url,
      paperTitle: data.paper_title,
      pitch,
      content,
    };

    const initiatives = parseProjectInitiatives(
      data.initiatives || [],
      projectSlug,
    );
    const platformLayers = parseProjectPlatformLayers(
      data.platform_layers || [],
      projectSlug,
    );

    const projectRelations: ProjectRelations = {
      technologies,
      ideas: (data.ideas || []).map((idea: string) => normalizeSlug(idea)),
      adrs: adrRefs,
      initiatives,
      role: data.role ? normalizeSlug(data.role) : undefined,
      tags: data.tags || [],
      platformLayers,
    };

    const validation = validateProject(project);
    if (validation.success) {
      entities.set(projectSlug, validation.data);
      relations.set(projectSlug, projectRelations);
      registerProjectAliases(aliases, projectAliases, projectSlug);
    } else {
      console.error(
        `Failed to validate project ${projectSlug}:`,
        validation.schemaErrors,
      );
      throw new Error(`Project ${projectSlug} failed validation`);
    }
  });

  for (const alias of aliases.keys()) {
    if (entities.has(alias)) {
      throw new Error(`Project alias '${alias}' conflicts with a project slug`);
    }
  }

  return { entities, relations, aliases };
}

export function validateProject(
  project: unknown,
): DomainValidationResult<Project> {
  const result = ProjectSchema.safeParse(project);
  if (!result.success) {
    return {
      success: false,
      schemaErrors: result.error,
    };
  }
  return {
    success: true,
    data: result.data,
  };
}

interface ADRLoadResult {
  entities: Map<ADRRef, ADR>;
  relations: Map<ADRRef, ADRRelations>;
  aliases: Map<ADRRef, ADRRef>;
}

function parseDefaultOverride(value: unknown): DefaultOverride | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const override = value as Record<string, unknown>;
  if (
    override.kind === "policy" ||
    (override.kind === undefined && override.value !== undefined)
  ) {
    return DefaultOverrideSchema.parse({
      slot: override.slot,
      kind: "policy",
      value: override.value,
      adopted: override.adopted,
      until: override.until,
    });
  }
  return DefaultOverrideSchema.parse({
    slot: override.slot,
    kind: "technology",
    technology: normalizeSlug(String(override.technology)),
    adopted: override.adopted,
    until: override.until,
  });
}

export function loadADRs(): ADRLoadResult {
  const entities = new Map<ADRRef, ADR>();
  const relations = new Map<ADRRef, ADRRelations>();
  const aliases = new Map<ADRRef, ADRRef>();
  const inheritedStubRecords: Array<{
    adrRef: ADRRef;
    slug: string;
    projectSlug: ProjectSlug;
    data: Record<string, unknown>;
    content: string;
  }> = [];

  const projectDirs = projectDirectories();

  projectDirs.forEach((projectSlug) => {
    const adrsDir = path.join(PROJECTS_DIR, projectSlug, "adrs");
    if (!fs.existsSync(adrsDir)) {
      return;
    }
    const adrFiles = fs.readdirSync(adrsDir).filter((f) => f.endsWith(".mdx"));
    adrFiles.forEach((adrFile) => {
      const adrSlug = adrFile.replace(/\.mdx$/, "");
      const adrRef = makeADRRef(projectSlug, adrSlug);
      const adrPath = path.join(adrsDir, adrFile);
      const fileContent = fs.readFileSync(adrPath, "utf-8");
      const { data, content } = parseFrontmatter(fileContent);

      if (typeof data.inherits_from === "string") {
        inheritedStubRecords.push({
          adrRef,
          slug: adrSlug,
          projectSlug,
          data: data as Record<string, unknown>,
          content,
        });
        return;
      }

      const technologies: TechnologySlug[] = (data.tech_stack || []).map(
        (tech: string) => normalizeSlug(tech),
      );

      const adr: ADR = {
        adrRef,
        slug: adrSlug,
        projectSlug,
        title: data.title as string,
        date: data.date as string,
        status: data.status as ADR["status"],
        inheritsFrom: undefined,
        supersedes: data.supersedes as ADRRef | undefined,
        overridesDefault: parseDefaultOverride(data.overrides_default),
        content,
        readingTime: readingTime(content).text,
      };

      const adrRelations: ADRRelations = {
        project: projectSlug,
        technologies,
        ideas: (data.ideas || []).map((idea: string) => normalizeSlug(idea)),
      };

      const validation = validateADR(adr);
      if (!validation.success) {
        console.error(
          `Failed to validate ADR ${adrRef}:`,
          validation.schemaErrors,
        );
        throw new Error(`ADR ${adrRef} failed validation`);
      }
      entities.set(adrRef, validation.data);
      relations.set(adrRef, adrRelations);
    });
  });

  for (const record of inheritedStubRecords) {
    const inheritsFromValue = record.data.inherits_from;
    if (
      typeof inheritsFromValue !== "string" ||
      !/^[^:]+:[^:]+$/.test(inheritsFromValue)
    ) {
      throw new Error(
        `Inherited ADR stub ${record.adrRef} has invalid inherits_from '${String(inheritsFromValue)}'. Expected format 'project:adr-slug'`,
      );
    }
    const inheritsFrom = inheritsFromValue as ADRRef;
    const sourceADR = entities.get(inheritsFrom);
    if (!sourceADR) {
      throw new Error(
        `Inherited ADR stub ${record.adrRef} references missing source ADR '${inheritsFrom}'`,
      );
    }
    if (sourceADR.inheritsFrom) {
      throw new Error(
        `Inherited ADR stub ${record.adrRef} cannot inherit from another inherited stub '${inheritsFrom}'`,
      );
    }
    if (
      Array.isArray(record.data.tech_stack) &&
      record.data.tech_stack.length > 0
    ) {
      throw new Error(
        `Inherited ADR stub ${record.adrRef} must not define tech_stack; technologies are derived from '${inheritsFrom}'`,
      );
    }
    const titleOverride = record.data.title;
    if (
      titleOverride !== undefined &&
      (typeof titleOverride !== "string" || titleOverride.trim().length === 0)
    ) {
      throw new Error(
        `Inherited ADR stub ${record.adrRef} has invalid title override`,
      );
    }

    aliases.set(record.adrRef, inheritsFrom);
  }

  return { entities, relations, aliases };
}

export function validateADR(adr: unknown): DomainValidationResult<ADR> {
  const result = ADRSchema.safeParse(adr);
  if (!result.success) {
    return {
      success: false,
      schemaErrors: result.error,
    };
  }
  return {
    success: true,
    data: result.data,
  };
}

interface RoleLoadResult {
  entities: Map<RoleSlug, JobRole>;
  relations: Map<RoleSlug, RoleRelations>;
}

export function loadJobRoles(): RoleLoadResult {
  const entities = new Map<RoleSlug, JobRole>();
  const relations = new Map<RoleSlug, RoleRelations>();

  for (const exp of definedExperiences) {
    const slug = normalizeSlug(exp.company);
    const technologies: TechnologySlug[] = exp.technologies.map(
      (tech: string) => normalizeSlug(tech),
    );

    const role: JobRole = {
      slug,
      company: exp.company,
      companyUrl: exp.companyUrl,
      logoPath: exp.logoPath,
      title: exp.title,
      previousTitles: exp.previousTitles,
      location: exp.location,
      startDate: exp.startDate,
      endDate: exp.endDate,
      description: exp.description,
      responsibilities: exp.responsibilities,
    };

    const roleRelations: RoleRelations = {
      technologies,
    };

    const validation = validateJobRole(role);
    if (validation.success) {
      entities.set(slug, validation.data);
      relations.set(slug, roleRelations);
    } else {
      console.error(
        `Failed to validate job role ${slug}:`,
        validation.schemaErrors,
      );
      throw new Error(`Job role ${slug} failed validation`);
    }
  }

  return { entities, relations };
}

export function validateJobRole(
  role: unknown,
): DomainValidationResult<JobRole> {
  const result = JobRoleSchema.safeParse(role);
  if (!result.success) {
    return {
      success: false,
      schemaErrors: result.error,
    };
  }
  return {
    success: true,
    data: result.data,
  };
}

export function loadBuildingPhilosophy(): string {
  if (!fs.existsSync(BUILDING_PHILOSOPHY_PATH)) {
    return "";
  }
  const fileContent = fs.readFileSync(BUILDING_PHILOSOPHY_PATH, "utf-8");
  const { content } = parseFrontmatter(fileContent);
  return content;
}

export function loadPlatformManifest(): PlatformManifest | undefined {
  if (!fs.existsSync(PLATFORM_MANIFEST_PATH)) return undefined;
  const fileContent = fs.readFileSync(PLATFORM_MANIFEST_PATH, "utf-8");
  const parsed = parseYaml(fileContent);
  const data =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const records = (value: unknown): Record<string, unknown>[] =>
    Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  const manifest = {
    project: data.project,
    layers: records(data.layers).map((layer) => ({
      ...layer,
      activatedBy: layer.activated_by
        ? {
            ...(layer.activated_by as Record<string, unknown>),
            technology: normalizeSlug(
              String(
                (layer.activated_by as Record<string, unknown>).technology,
              ),
            ),
          }
        : undefined,
    })),
    slots: records(data.slots).map((slot) => ({
      ...slot,
      effectiveFrom: slot.effective_from,
      effectiveUntil: slot.effective_until,
      noDefaultFrom: slot.no_default_from,
    })),
    policies: records(data.policies).map((policy) => ({
      ...policy,
      effectiveFrom: policy.effective_from,
      effectiveUntil: policy.effective_until,
    })),
    selections: records(data.selections).map(
      (selection: Record<string, unknown>) =>
        selection.kind === "policy" ||
        (selection.kind === undefined && selection.value !== undefined)
          ? {
              ...selection,
              kind: "policy",
              value: selection.value,
              originProjects: selection.origin_projects ?? [],
              evidenceADRs: selection.evidence_adrs ?? [],
              effectiveFrom: selection.effective_from,
              effectiveUntil: selection.effective_until,
            }
          : {
              ...selection,
              kind: "technology",
              technology: normalizeSlug(String(selection.technology)),
              originProjects: selection.origin_projects ?? [],
              evidenceADRs: selection.evidence_adrs ?? [],
              effectiveFrom: selection.effective_from,
              effectiveUntil: selection.effective_until,
            },
    ),
  };
  const result = PlatformManifestSchema.safeParse(manifest);
  if (!result.success) {
    console.error("Failed to validate platform manifest:", result.error);
    throw new Error("Personal Engineering Platform manifest failed validation");
  }
  return result.data;
}

interface ValidationInput {
  technologies: Map<TechnologySlug, Technology>;
  ideas?: Map<IdeaSlug, Idea>;
  ideaRelations?: Map<IdeaSlug, IdeaRelations>;
  initiatives: Map<InitiativeSlug, Initiative>;
  adrs: Map<ADRRef, ADR>;
  projects: Map<ProjectSlug, Project>;
  blogRelations: Map<BlogSlug, BlogRelations>;
  projectRelations: Map<ProjectSlug, ProjectRelations>;
  adrRelations: Map<ADRRef, ADRRelations>;
  roleRelations: Map<RoleSlug, RoleRelations>;
  adrAliases?: Map<ADRRef, ADRRef>;
  platformManifest?: PlatformManifest;
}

type TechnologyReferenceCheck = (
  slug: TechnologySlug,
  entity: string,
  field: string,
) => void;

function periodsOverlap(
  left: { adopted: string; until?: string },
  right: { effectiveFrom: string; effectiveUntil?: string },
): boolean {
  return (
    (right.effectiveUntil === undefined ||
      compareUtcInstants(left.adopted, right.effectiveUntil) < 0) &&
    (left.until === undefined ||
      compareUtcInstants(right.effectiveFrom, left.until) < 0)
  );
}

function validatePlatformDecisions(
  input: ValidationInput,
  manifest: PlatformManifest,
  errors: ReferentialIntegrityError[],
): void {
  for (const decision of [
    ...manifest.policies.map((record) => record.decision),
    ...manifest.selections.map((record) => record.decision),
  ]) {
    if (!input.adrs.has(decision)) {
      errors.push({
        type: "missing_reference",
        entity: "PlatformManifest",
        field: "decision",
        value: decision,
        message: `Platform record references missing ADR '${decision}'`,
      });
    }
  }
}

function validatePlatformSelections(
  input: ValidationInput,
  manifest: PlatformManifest,
  errors: ReferentialIntegrityError[],
  checkTech: TechnologyReferenceCheck,
): void {
  for (const selection of manifest.selections) {
    if (selection.kind === "technology") {
      checkTech(
        selection.technology,
        `DefaultSelection[${selection.id}]`,
        "technology",
      );
    }
    validateSelectionOrigins(input, selection, errors);
    validateSelectionEvidence(input, selection, errors);
  }
}

function validateSelectionOrigins(
  input: ValidationInput,
  selection: DefaultSelection,
  errors: ReferentialIntegrityError[],
): void {
  for (const projectSlug of selection.originProjects) {
    if (!input.projects.has(projectSlug)) {
      errors.push({
        type: "missing_reference",
        entity: `DefaultSelection[${selection.id}]`,
        field: "originProjects",
        value: projectSlug,
        message: `Selection '${selection.id}' references missing origin project '${projectSlug}'`,
      });
    }
  }
}

function validateSelectionEvidence(
  input: ValidationInput,
  selection: DefaultSelection,
  errors: ReferentialIntegrityError[],
): void {
  const evidenceProjects = new Set<ProjectSlug>();
  for (const adrRef of selection.evidenceADRs) {
    const adr = input.adrs.get(adrRef);
    if (!adr) {
      errors.push({
        type: "missing_reference",
        entity: `DefaultSelection[${selection.id}]`,
        field: "evidenceADRs",
        value: adrRef,
        message: `Selection '${selection.id}' references missing evidence ADR '${adrRef}'`,
      });
      continue;
    }
    evidenceProjects.add(adr.projectSlug);
    if (!selection.originProjects.includes(adr.projectSlug)) {
      errors.push({
        type: "invalid_reference",
        entity: `DefaultSelection[${selection.id}]`,
        field: "evidenceADRs",
        value: adrRef,
        message: `Selection '${selection.id}' evidence ADR '${adrRef}' does not belong to an origin project`,
      });
    }
  }
  for (const projectSlug of selection.originProjects) {
    if (!evidenceProjects.has(projectSlug)) {
      errors.push({
        type: "invalid_reference",
        entity: `DefaultSelection[${selection.id}]`,
        field: "originProjects",
        value: projectSlug,
        message: `Selection '${selection.id}' has no evidence ADR from origin project '${projectSlug}'`,
      });
    }
  }
}

function validateAdoptionDecision(
  input: ValidationInput,
  projectSlug: ProjectSlug,
  entity: string,
  decision: ADRRef | undefined,
  errors: ReferentialIntegrityError[],
): void {
  if (!decision) return;
  const adr = input.adrs.get(decision);
  if (!adr) {
    errors.push({
      type: "missing_reference",
      entity,
      field: "decision",
      value: decision,
      message: `${entity} references missing adoption ADR '${decision}'`,
    });
  } else if (adr.projectSlug !== projectSlug) {
    errors.push({
      type: "invalid_reference",
      entity,
      field: "decision",
      value: decision,
      message: `${entity} adoption ADR '${decision}' belongs to project '${adr.projectSlug}'`,
    });
  }
}

function validateProjectLayerUse(
  input: ValidationInput,
  manifest: PlatformManifest,
  projectSlug: ProjectSlug,
  use: ProjectLayerUse,
  layerSlugs: ReadonlySet<string>,
  slotSlugs: ReadonlySet<string>,
  errors: ReferentialIntegrityError[],
): void {
  const entity = `Project[${projectSlug}].platformLayers[${use.layer}]`;
  validateAdoptionDecision(input, projectSlug, entity, use.decision, errors);
  if (!layerSlugs.has(use.layer)) {
    errors.push({
      type: "missing_reference",
      entity: `Project[${projectSlug}]`,
      field: "platformLayers",
      value: use.layer,
      message: `Project '${projectSlug}' references missing platform layer '${use.layer}'`,
    });
  }
  if (input.projects.get(projectSlug)?.status === "completed" && use.tracking) {
    errors.push({
      type: "invalid_reference",
      entity: `Project[${projectSlug}]`,
      field: "platformLayers",
      value: use.layer,
      message: `Completed project '${projectSlug}' cannot track current platform defaults`,
    });
  }
  for (const slotUse of use.slots) {
    validateAdoptionDecision(
      input,
      projectSlug,
      `${entity}.slots[${slotUse.slot}]`,
      slotUse.decision,
      errors,
    );
    if (!slotSlugs.has(slotUse.slot)) {
      errors.push({
        type: "missing_reference",
        entity: `Project[${projectSlug}]`,
        field: "platformLayers.slots",
        value: slotUse.slot,
        message: `Project '${projectSlug}' references missing default slot '${slotUse.slot}'`,
      });
    }
    const belongsToLayer = manifest.policies.some(
      (policy) =>
        policy.layer === use.layer &&
        policy.slot === slotUse.slot &&
        periodsOverlap(slotUse, policy),
    );
    if (!belongsToLayer) {
      errors.push({
        type: "invalid_reference",
        entity: `Project[${projectSlug}]`,
        field: "platformLayers.slots",
        value: slotUse.slot,
        message: `Project '${projectSlug}' activates slot '${slotUse.slot}' outside layer '${use.layer}'`,
      });
    }
  }
}

function validateProjectPlatformUses(
  input: ValidationInput,
  manifest: PlatformManifest,
  layerSlugs: ReadonlySet<string>,
  slotSlugs: ReadonlySet<string>,
  errors: ReferentialIntegrityError[],
): void {
  input.projectRelations.forEach((relations, projectSlug) => {
    if ((relations.platformLayers?.length ?? 0) > 0 && relations.role) {
      errors.push({
        type: "invalid_reference",
        entity: `Project[${projectSlug}]`,
        field: "platformLayers",
        value: relations.role,
        message: `Organisation-governed project '${projectSlug}' cannot adopt the personal platform`,
      });
    }
    for (const use of relations.platformLayers ?? []) {
      validateProjectLayerUse(
        input,
        manifest,
        projectSlug,
        use,
        layerSlugs,
        slotSlugs,
        errors,
      );
    }
  });
}

function validatePlatformOverrides(
  input: ValidationInput,
  manifest: PlatformManifest,
  slotSlugs: ReadonlySet<string>,
  errors: ReferentialIntegrityError[],
  checkTech: TechnologyReferenceCheck,
): void {
  input.adrs.forEach((adr, adrRef) => {
    const override = adr.overridesDefault;
    if (!override) return;
    if (!slotSlugs.has(override.slot)) {
      errors.push({
        type: "missing_reference",
        entity: `ADR[${adrRef}]`,
        field: "overridesDefault",
        value: override.slot,
        message: `ADR '${adrRef}' overrides missing slot '${override.slot}'`,
      });
    }
    if (override.kind === "technology") {
      checkTech(override.technology, `ADR[${adrRef}]`, "overridesDefault");
    }
    const slot = manifest.slots.find(
      (candidate) => candidate.slug === override.slot,
    );
    if (slot && slot.kind !== override.kind) {
      errors.push({
        type: "invalid_reference",
        entity: `ADR[${adrRef}]`,
        field: "overridesDefault",
        value: override.slot,
        message: `ADR '${adrRef}' override kind '${override.kind}' does not match slot '${override.slot}' kind '${slot.kind}'`,
      });
    }
    const owningLayers = new Set(
      manifest.policies
        .filter((policy) => policy.slot === override.slot)
        .map((policy) => policy.layer),
    );
    const projectLayers = input.projectRelations.get(
      adr.projectSlug,
    )?.platformLayers;
    if (!projectLayers?.some((use) => owningLayers.has(use.layer))) {
      errors.push({
        type: "invalid_reference",
        entity: `ADR[${adrRef}]`,
        field: "overridesDefault",
        value: override.slot,
        message: `ADR '${adrRef}' cannot override a slot from a layer the project has not adopted`,
      });
    }
  });
}

function validatePlatformReferences(
  input: ValidationInput,
  manifest: PlatformManifest,
  errors: ReferentialIntegrityError[],
  checkTech: TechnologyReferenceCheck,
): void {
  const layerSlugs = new Set(manifest.layers.map((layer) => layer.slug));
  const slotSlugs = new Set(manifest.slots.map((slot) => slot.slug));
  if (!input.projects.has(manifest.project)) {
    errors.push({
      type: "missing_reference",
      entity: "PlatformManifest",
      field: "project",
      value: manifest.project,
      message: `Platform project '${manifest.project}' does not exist`,
    });
  }
  validatePlatformDecisions(input, manifest, errors);
  validatePlatformSelections(input, manifest, errors, checkTech);
  for (const layer of manifest.layers) {
    if (layer.activatedBy) {
      checkTech(
        layer.activatedBy.technology,
        `PlatformLayer[${layer.slug}]`,
        "activatedBy.technology",
      );
    }
  }
  validateProjectPlatformUses(input, manifest, layerSlugs, slotSlugs, errors);
  validatePlatformOverrides(input, manifest, slotSlugs, errors, checkTech);
}

export function validateReferentialIntegrity(
  input: ValidationInput,
): ReferentialIntegrityError[] {
  const errors: ReferentialIntegrityError[] = [];

  const checkTech = (slug: TechnologySlug, entity: string, field: string) => {
    if (!input.technologies.has(slug)) {
      errors.push({
        type: "missing_reference",
        entity,
        field,
        value: slug,
        message: `Technology '${slug}' referenced by ${entity}.${field} does not exist`,
      });
    }
  };

  const checkIdea = (slug: IdeaSlug, entity: string, field: string) => {
    if (input.ideas && !input.ideas.has(slug)) {
      errors.push({
        type: "missing_reference",
        entity,
        field,
        value: slug,
        message: `Idea '${slug}' referenced by ${entity}.${field} does not exist`,
      });
    }
  };

  input.ideaRelations?.forEach((relations, ideaSlug) => {
    relations.relatedIdeas.forEach((relatedSlug) => {
      checkIdea(relatedSlug, `Idea[${ideaSlug}]`, "relatedIdeas");
      if (relatedSlug === ideaSlug) {
        errors.push({
          type: "circular_reference",
          entity: `Idea[${ideaSlug}]`,
          field: "relatedIdeas",
          value: relatedSlug,
          message: `Idea '${ideaSlug}' cannot relate to itself`,
        });
      }
    });
  });

  input.technologies.forEach((technology, techSlug) => {
    technology.ideas.forEach((ideaSlug) => {
      checkIdea(ideaSlug, `Technology[${techSlug}]`, "ideas");
    });
  });

  input.blogRelations.forEach((relations, blogSlug) => {
    relations.technologies.forEach((techSlug) => {
      checkTech(techSlug, `BlogPost[${blogSlug}]`, "technologies");
    });
    relations.ideas.forEach((ideaSlug) => {
      checkIdea(ideaSlug, `BlogPost[${blogSlug}]`, "ideas");
    });
    if (relations.role && !input.roleRelations.has(relations.role)) {
      errors.push({
        type: "missing_reference",
        entity: `BlogPost[${blogSlug}]`,
        field: "role",
        value: relations.role,
        message: `Role '${relations.role}' referenced by blog '${blogSlug}' does not exist`,
      });
    }
  });

  input.projectRelations.forEach((relations, projectSlug) => {
    relations.technologies.forEach((techSlug) => {
      checkTech(techSlug, `Project[${projectSlug}]`, "technologies");
    });
    relations.ideas.forEach((ideaSlug) => {
      checkIdea(ideaSlug, `Project[${projectSlug}]`, "ideas");
    });
    relations.adrs.forEach((adrRef) => {
      if (!input.adrs.has(adrRef)) {
        errors.push({
          type: "missing_reference",
          entity: `Project[${projectSlug}]`,
          field: "adrs",
          value: adrRef,
          message: `ADR '${adrRef}' referenced by project '${projectSlug}' does not exist`,
        });
      }
    });
    relations.initiatives.forEach((initiativeSlug) => {
      if (!input.initiatives.has(initiativeSlug)) {
        errors.push({
          type: "missing_reference",
          entity: `Project[${projectSlug}]`,
          field: "initiatives",
          value: initiativeSlug,
          message: `Initiative '${initiativeSlug}' referenced by project '${projectSlug}' does not exist`,
        });
      }
    });
    const adrSlugSet = new Set<string>();
    for (const adrRef of relations.adrs) {
      const adr = input.adrs.get(adrRef);
      if (!adr) continue;
      if (adrSlugSet.has(adr.slug)) {
        errors.push({
          type: "invalid_reference",
          entity: `Project[${projectSlug}]`,
          field: "adrs",
          value: adr.slug,
          message: `Duplicate ADR slug '${adr.slug}' in project '${projectSlug}' context (local + inherited ADRs must be unique)`,
        });
      } else {
        adrSlugSet.add(adr.slug);
      }
    }
    if (relations.role && !input.roleRelations.has(relations.role)) {
      errors.push({
        type: "missing_reference",
        entity: `Project[${projectSlug}]`,
        field: "role",
        value: relations.role,
        message: `Role '${relations.role}' referenced by project '${projectSlug}' does not exist`,
      });
    }
  });

  input.initiatives.forEach((initiative, initiativeSlug) => {
    for (const projectSlug of Object.keys(initiative.projectContributions)) {
      if (!input.projects.has(projectSlug)) {
        errors.push({
          type: "missing_reference",
          entity: `Initiative[${initiativeSlug}]`,
          field: "projectContributions",
          value: projectSlug,
          message: `Project '${projectSlug}' described by initiative '${initiativeSlug}' does not exist`,
        });
        continue;
      }
      if (
        !input.projectRelations
          .get(projectSlug)
          ?.initiatives.includes(initiativeSlug)
      ) {
        errors.push({
          type: "invalid_reference",
          entity: `Initiative[${initiativeSlug}]`,
          field: "projectContributions",
          value: projectSlug,
          message: `Project '${projectSlug}' has contribution prose for initiative '${initiativeSlug}' but does not reference that initiative`,
        });
      }
    }
  });

  input.adrRelations.forEach((relations, adrRef) => {
    if (!input.projects.has(relations.project)) {
      errors.push({
        type: "missing_reference",
        entity: `ADR[${adrRef}]`,
        field: "project",
        value: relations.project,
        message: `Project '${relations.project}' referenced by ADR '${adrRef}' does not exist`,
      });
    }
    relations.technologies.forEach((techSlug) => {
      checkTech(techSlug, `ADR[${adrRef}]`, "technologies");
    });
    relations.ideas.forEach((ideaSlug) => {
      checkIdea(ideaSlug, `ADR[${adrRef}]`, "ideas");
    });
    const adr = input.adrs.get(adrRef);
    if (adr?.supersedes && !input.adrs.has(adr.supersedes)) {
      errors.push({
        type: "missing_reference",
        entity: `ADR[${adrRef}]`,
        field: "supersedes",
        value: adr.supersedes,
        message: `ADR '${adr.supersedes}' referenced by supersedes does not exist`,
      });
    }
    if (adr?.supersedes) {
      const allowedTargets = input.projectRelations.get(
        relations.project,
      )?.adrs;
      if (!allowedTargets?.includes(adr.supersedes)) {
        errors.push({
          type: "invalid_reference",
          entity: `ADR[${adrRef}]`,
          field: "supersedes",
          value: adr.supersedes,
          message: `ADR '${adrRef}' cannot supersede '${adr.supersedes}' because it is not local or inherited in project '${relations.project}'`,
        });
      }
    }
    if (adr?.supersedes === adrRef) {
      errors.push({
        type: "circular_reference",
        entity: `ADR[${adrRef}]`,
        field: "supersedes",
        value: adrRef,
        message: `ADR '${adrRef}' cannot supersede itself`,
      });
    }
  });

  input.adrs.forEach((adr, startRef) => {
    const seen = new Set<ADRRef>([startRef]);
    let current = adr.supersedes;
    while (current) {
      if (seen.has(current)) {
        errors.push({
          type: "circular_reference",
          entity: `ADR[${startRef}]`,
          field: "supersedes",
          value: current,
          message: `Circular supersedes chain detected starting at '${startRef}'`,
        });
        break;
      }
      seen.add(current);
      current = input.adrs.get(current)?.supersedes;
    }
  });

  input.roleRelations.forEach((relations, roleSlug) => {
    relations.technologies.forEach((techSlug) => {
      checkTech(techSlug, `JobRole[${roleSlug}]`, "technologies");
    });
  });

  input.adrAliases?.forEach((target, alias) => {
    if (!input.adrs.has(target)) {
      errors.push({
        type: "missing_reference",
        entity: `ADRAlias[${alias}]`,
        field: "target",
        value: target,
        message: `Legacy ADR alias '${alias}' references missing ADR '${target}'`,
      });
    }
  });

  const manifest = input.platformManifest;
  if (manifest) validatePlatformReferences(input, manifest, errors, checkTech);

  return errors;
}

export interface DomainRepository {
  technologies: Map<TechnologySlug, Technology>;
  ideas: Map<IdeaSlug, Idea>;
  initiatives: Map<InitiativeSlug, Initiative>;
  blogs: Map<BlogSlug, BlogPost>;
  projects: Map<ProjectSlug, Project>;
  projectAliases: Map<ProjectSlug, ProjectSlug>;
  adrs: Map<ADRRef, ADR>;
  adrAliases: Map<ADRRef, ADRRef>;
  roles: Map<RoleSlug, JobRole>;
  graph: ContentGraph;
  buildingPhilosophy: string;
  referentialIntegrityErrors: ReferentialIntegrityError[];
  platform: {
    manifest?: PlatformManifest;
    projectLayerUses: Map<ProjectSlug, ProjectLayerUse[]>;
    adrOverrides: Map<ADRRef, DefaultOverride>;
  };
}

interface LoaderResults {
  ideas: IdeaLoadResult;
  blogs: BlogLoadResult;
  initiatives: InitiativeLoadResult;
  projects: ProjectLoadResult;
  adrs: ADRLoadResult;
  roles: RoleLoadResult;
}

function buildRelationDataFromLoaders(loaders: LoaderResults): RelationData {
  const relations = createEmptyRelationData();

  for (const [slug, projectRels] of loaders.projects.relations) {
    relations.projectTechnologies.set(slug, projectRels.technologies);
    relations.projectADRs.set(slug, projectRels.adrs);
    if (projectRels.role) {
      relations.projectRole.set(slug, projectRels.role);
    }
    relations.projectTags.set(slug, projectRels.tags);
    relations.projectInitiatives.set(slug, projectRels.initiatives);
    relations.projectIdeas.set(slug, projectRels.ideas);
  }

  for (const [slug, blogRels] of loaders.blogs.relations) {
    relations.blogTechnologies.set(slug, blogRels.technologies);
    relations.blogTags.set(slug, blogRels.tags);
    relations.blogIdeas.set(slug, blogRels.ideas);
    if (blogRels.role) {
      relations.blogRole.set(slug, blogRels.role);
    }
  }

  for (const [adrRef, adrRels] of loaders.adrs.relations) {
    relations.adrTechnologies.set(adrRef, adrRels.technologies);
    relations.adrProject.set(adrRef, adrRels.project);
    relations.adrIdeas.set(adrRef, adrRels.ideas);
  }

  for (const [adrRef, adr] of loaders.adrs.entities) {
    if (adr.supersedes) {
      relations.adrSupersedes.set(adrRef, adr.supersedes);
    }
    if (adr.inheritsFrom) {
      relations.adrInheritsFrom.set(adrRef, adr.inheritsFrom);
    }
  }

  for (const [slug, roleRels] of loaders.roles.relations) {
    relations.roleTechnologies.set(slug, roleRels.technologies);
  }

  for (const [slug, ideaRels] of loaders.ideas.relations) {
    relations.ideaRelatedIdeas.set(slug, ideaRels.relatedIdeas);
  }

  return relations;
}

function buildDomainRepository(): DomainRepository {
  const technologies = loadTechnologies();
  validateTechnologyReferences(technologies);
  const ideasResult = loadIdeas();
  const blogsResult = loadBlogPosts();
  const initiativesResult = loadInitiatives();
  const projectsResult = loadProjects();
  const adrsResult = loadADRs();
  const rolesResult = loadJobRoles();
  const platformManifest = loadPlatformManifest();
  const buildingPhilosophy = loadBuildingPhilosophy();

  const referentialIntegrityErrors = validateReferentialIntegrity({
    technologies,
    ideas: ideasResult.entities,
    ideaRelations: ideasResult.relations,
    initiatives: initiativesResult.entities,
    adrs: adrsResult.entities,
    projects: projectsResult.entities,
    blogRelations: blogsResult.relations,
    projectRelations: projectsResult.relations,
    adrRelations: adrsResult.relations,
    roleRelations: rolesResult.relations,
    adrAliases: adrsResult.aliases,
    platformManifest,
  });

  if (referentialIntegrityErrors.length > 0) {
    console.error("Referential integrity errors found:");
    referentialIntegrityErrors.forEach((err) => {
      console.error(`  - ${err.message}`);
    });
    throw new Error(
      `Found ${referentialIntegrityErrors.length} referential integrity errors`,
    );
  }

  const loaders: LoaderResults = {
    ideas: ideasResult,
    blogs: blogsResult,
    initiatives: initiativesResult,
    projects: projectsResult,
    adrs: adrsResult,
    roles: rolesResult,
  };

  const relations = buildRelationDataFromLoaders(loaders);
  for (const [slug, technology] of technologies) {
    relations.technologyIdeas.set(slug, technology.ideas);
  }
  relations.platformManifest = platformManifest;
  for (const [projectSlug, projectRelations] of projectsResult.relations) {
    if ((projectRelations.platformLayers?.length ?? 0) > 0) {
      relations.projectLayerUses.set(
        projectSlug,
        projectRelations.platformLayers ?? [],
      );
    }
  }
  for (const [adrRef, adr] of adrsResult.entities) {
    if (adr.overridesDefault) {
      relations.adrOverridesDefault.set(adrRef, adr.overridesDefault);
    }
  }
  const graph = buildContentGraph({
    technologySlugs: technologies.keys(),
    projectSlugs: projectsResult.entities.keys(),
    initiativeSlugs: initiativesResult.entities.keys(),
    ideaSlugs: ideasResult.entities.keys(),
    relations,
  });

  return {
    technologies,
    ideas: ideasResult.entities,
    initiatives: initiativesResult.entities,
    blogs: blogsResult.entities,
    projects: projectsResult.entities,
    projectAliases: projectsResult.aliases,
    adrs: adrsResult.entities,
    adrAliases: adrsResult.aliases,
    roles: rolesResult.entities,
    graph,
    buildingPhilosophy,
    referentialIntegrityErrors,
    platform: {
      manifest: platformManifest,
      projectLayerUses: relations.projectLayerUses,
      adrOverrides: relations.adrOverridesDefault,
    },
  };
}

// Loading reparses and validates every content file, so the result is cached
// for the lifetime of the process (a build, a server, or a test run).
let cachedRepository: DomainRepository | undefined;

export function loadDomainRepository(): DomainRepository {
  cachedRepository ??= buildDomainRepository();
  return cachedRepository;
}

export function resetDomainRepositoryCache(): void {
  cachedRepository = undefined;
}
