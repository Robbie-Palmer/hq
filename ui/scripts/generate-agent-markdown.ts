#!/usr/bin/env tsx

/**
 * Generates agent-friendly Markdown twins of the site's HTML pages into the
 * static export directory (out/), following the convention popularised by
 * Neon's docs: append `.md` to a page URL to get plain Markdown, and fetch
 * /llms.txt for a structured index of everything available.
 *
 * Recipe pages additionally get schema.org Recipe JSON and Cooklang twins
 * (append `.json` or `.cook` respectively) for portable recipe export.
 */

import fs from "node:fs";
import path from "node:path";
// Import order matters: registers .wasm loading before content imports
import "./lib/register-wasm";
import { getAllPosts } from "@/lib/api/blog";
import {
  formatExperienceDateRange,
  getAllExperience,
} from "@/lib/api/experience";
import {
  getAllInitiatives,
  type InitiativeWithProjects,
} from "@/lib/api/initiatives";
import {
  getAllIdeas,
  getIdea,
  getIdeasForADR,
  getIdeasForBlog,
  getIdeasForProject,
} from "@/lib/api/ideas";
import {
  getAllProjectAliases,
  getAllProjectAliasADRPaths,
  getAllProjects,
  getBuildingPhilosophy,
  getProjectADR,
  type ProjectWithADRs,
} from "@/lib/api/projects";
import type { RecipeCardView } from "@/lib/api/recipes";
import { siteConfig } from "@/lib/config/site-config";
import {
  posthogApplication,
  posthogApplicationMarkdown,
} from "@/content/posthog";
import {
  markdownUrl,
  mdxToAgentMarkdown,
  renderPage,
} from "@/lib/content/agent-markdown";
import {
  compareUtcInstants,
  isEffectiveAt,
  loadDomainRepository,
} from "@/lib/domain";
import {
  countPitchSlides,
  pitchDeckToAgentMarkdown,
} from "@/lib/domain/project/pitchDeck";
import {
  getAllTechnologySlugs,
  getRelatedContentForTechnology,
  getTechnologyDetail,
} from "@/lib/domain/technology";
import { getImageUrl } from "@/lib/integrations/cloudflare-images";

const OUT_DIR = path.join(process.cwd(), "out");
const BASE_HEADERS_PATH = path.join(process.cwd(), "public", "_headers");

const hasImagesAccountHash = Boolean(
  process.env.NEXT_PUBLIC_CF_IMAGES_ACCOUNT_HASH,
);

function resolveImageUrl(src: string): string | null {
  // Site-relative assets (e.g. /company-logos/foo.png) are not Cloudflare
  // Images IDs; point them at the deployed site instead
  if (src.startsWith("/")) return `${siteConfig.url}${src}`;
  if (!hasImagesAccountHash) return null;
  return getImageUrl(src, null, { width: 1200, format: "auto" });
}

const convert = (mdx: string) => mdxToAgentMarkdown(mdx, { resolveImageUrl });
const routePath = (...segments: string[]) => `/${segments.join("/")}`;

interface GeneratedPage {
  /** HTML route the markdown twin belongs to, e.g. "/projects" */
  htmlPath: string;
  /** File path relative to out/, e.g. "projects.md" */
  filePath: string;
  title: string;
  description: string;
  content: string;
  facts?: [string, string][];
}

function projectFacts(project: ProjectWithADRs): [string, string][] {
  const facts: [string, string][] = [
    ["Status", project.status],
    ["Started", project.date],
  ];
  if (project.updated) facts.push(["Updated", project.updated]);
  if (project.repoUrl) facts.push(["Source code", project.repoUrl]);
  if (project.demoUrl) facts.push(["Live demo", project.demoUrl]);
  if (project.productUrl) facts.push(["Product", project.productUrl]);
  if (project.paperUrl) facts.push(["Research paper", project.paperUrl]);
  if (project.technologies.length > 0) {
    facts.push([
      "Technologies",
      project.technologies.map((tech) => tech.name).join(", "),
    ]);
  }
  if ((project.builtOn?.length ?? 0) > 0) {
    facts.push(
      [
        "Built on",
        project.builtOn?.map((layer) => layer.title).join(", ") ?? "",
      ],
      [
        "Platform technologies",
        (project.platformTechnologies ?? [])
          .map((technology) => technology.name)
          .join(", "),
      ],
      [
        "Platform policies",
        (project.platformPolicies ?? [])
          .map((policy) => policy.value)
          .join(", "),
      ],
    );
  }
  const ideas = getIdeasForProject(project.slug);
  if (ideas.length > 0) {
    facts.push([
      "Ideas",
      ideas
        .map((idea) => `${idea.title} (${markdownUrl(routePath("ideas", idea.slug))})`)
        .join(", "),
    ]);
  }
  return facts;
}

function buildProjectsIndexPage(
  projects: ProjectWithADRs[],
  initiatives: InitiativeWithProjects[],
  philosophyMdx: string,
): GeneratedPage {
  const sections = [
    "## Initiatives",
    "",
    ...initiatives.flatMap((initiative) => [
      `### [${initiative.title}](${markdownUrl(routePath("initiatives", initiative.slug))})`,
      "",
      `${initiative.description} ${initiative.projects.length} projects contribute to this initiative.`,
      "",
    ]),
    "## Projects",
    "",
    ...projects.flatMap((project) => {
      const adrNote =
        project.adrs.length > 0
          ? ` ${project.adrs.length} architecture decision records (ADRs) are listed on the project page.`
          : "";
      return [
        `### [${project.title}](${markdownUrl(routePath("projects", project.slug))})`,
        "",
        `${project.description} (status: ${project.status}).${adrNote}`,
        "",
      ];
    }),
    convert(philosophyMdx).trim(),
  ];
  return {
    htmlPath: "/projects",
    filePath: "projects.md",
    title: "Projects",
    description:
      "Technical projects with architecture decision records (ADRs), plus the building philosophy that guides them. The building philosophy is included in full at the end of this page.",
    content: sections.join("\n"),
  };
}

function getInitiativesForProject(
  projectSlug: string,
  initiatives: InitiativeWithProjects[],
): InitiativeWithProjects[] {
  return initiatives.filter((initiative) =>
    initiative.projects.some((project) => project.slug === projectSlug),
  );
}

function buildInitiativePages(
  initiatives: InitiativeWithProjects[],
): GeneratedPage[] {
  return initiatives.map((initiative) => ({
    htmlPath: `/initiatives/${initiative.slug}`,
    filePath: `initiatives/${initiative.slug}.md`,
    title: initiative.title,
    description: initiative.description,
    facts: [["Projects", String(initiative.projects.length)]],
    content: [
      convert(initiative.content).trim(),
      "",
      "## Projects advancing this goal",
      "",
      ...initiative.projects.map((project) => {
        const contribution = project.contribution ?? project.description;
        return `- [${project.title}](${markdownUrl(routePath("projects", project.slug))}): ${contribution}`;
      }),
    ].join("\n"),
  }));
}

function buildProjectPage(
  project: ProjectWithADRs,
  initiatives: InitiativeWithProjects[],
): GeneratedPage {
  const relatedInitiatives = getInitiativesForProject(
    project.slug,
    initiatives,
  );
  const initiativeSection =
    relatedInitiatives.length > 0
      ? [
          "",
          "## Initiatives",
          "",
          ...relatedInitiatives.map((initiative) => {
            const contribution =
              initiative.projectContributions[project.slug] ??
              initiative.description;
            return `- [${initiative.title}](${markdownUrl(routePath("initiatives", initiative.slug))}): ${contribution}`;
          }),
        ]
      : [];
  const pitchDeckUrl = markdownUrl(
    routePath("projects", project.slug, "deck"),
  );
  const pitchSection = project.pitch
    ? [
        `Read the shorter [project pitch deck](${pitchDeckUrl}).`,
        "",
      ]
    : [];
  const adrSection =
    project.adrs.length > 0
      ? [
          "",
          "## Architecture Decision Records",
          "",
          ...project.adrs.map((adr) => {
            const url = markdownUrl(
              `/projects/${project.slug}/adrs/${adr.slug}`,
            );
            const inherited = adr.isInherited
              ? ` (inherited from ${adr.originProjectSlug})`
              : "";
            return `- [${adr.title}](${url}) — ${adr.status}, ${adr.date}${inherited}`;
          }),
        ]
      : [];
  const platformSection = buildPlatformManifestSection(project);
  return {
    htmlPath: `/projects/${project.slug}`,
    filePath: `projects/${project.slug}.md`,
    title: project.title,
    description: project.description,
    content: [
      ...pitchSection,
      convert(project.content).trim(),
      ...platformSection,
      ...initiativeSection,
      ...adrSection,
    ].join("\n"),
    facts: projectFacts(project),
  };
}

function buildPlatformManifestSection(project: ProjectWithADRs): string[] {
  const manifest = project.platformManifest;
  if (!manifest) return [];
  const instant = new Date().toISOString();
  const layers = manifest.layers.flatMap((layer) => {
    const policies = manifest.policies.filter(
      (policy) =>
        policy.layer === layer.slug && isEffectiveAt(policy, instant),
    );
    const activation = layer.activatedBy
      ? ` Activated when ${layer.activatedBy.slot} resolves to ${layer.activatedBy.technology}.`
      : "";
    return [
      `### ${layer.title}`,
      "",
      `${layer.description}${activation}`,
      "",
      ...policies.map((policy) => `- ${policy.slot}: ${policy.mode}`),
      ...(policies.length > 0 ? [""] : []),
    ];
  });
  const slots = manifest.slots.flatMap((slot) => [
    `### ${slot.title}`,
    "",
    slot.description,
    "",
    ...slot.selections
      .toSorted((left, right) =>
        compareUtcInstants(right.effectiveFrom, left.effectiveFrom),
      )
      .map((selection) => {
        const [projectSlug, adrSlug] = selection.decision.split(":");
        const until = selection.effectiveUntil ?? "present";
        const decisionUrl = markdownUrl(
          routePath("projects", projectSlug ?? "", "adrs", adrSlug ?? ""),
        );
        const origins =
          selection.originProjects.length > 0
            ? `; driven by ${selection.originProjects
                .map(
                  (slug) =>
                    `[${slug}](${markdownUrl(routePath("projects", slug))})`,
                )
                .join(", ")}`
            : "";
        const selectedValue =
          selection.kind === "technology"
            ? `[${selection.technology}](${markdownUrl(routePath("technologies", selection.technology))})`
            : selection.value;
        return `- ${selectedValue}: ${selection.lifecycleStatus}, ${selection.effectiveFrom} to ${until}; [decision](${decisionUrl})${origins}`;
      }),
    ...(slot.adopters.length > 0
      ? [
          `- Adopters: ${slot.adopters
            .map(
              (slug) =>
                `[${slug}](${markdownUrl(routePath("projects", slug))})`,
            )
            .join(", ")}`,
        ]
      : []),
    ...(slot.layerConsumers.length > 0
      ? [
          `- Layer consumers: ${slot.layerConsumers
            .map(
              (slug) =>
                `[${slug}](${markdownUrl(routePath("projects", slug))})`,
            )
            .join(", ")}`,
        ]
      : []),
    ...(slot.overrides.length > 0
      ? [
          `- Overrides: ${slot.overrides
            .map((ref) => {
              const [projectSlug, adrSlug] = ref.split(":");
              return `[${ref}](${markdownUrl(
                routePath(
                  "projects",
                  projectSlug ?? "",
                  "adrs",
                  adrSlug ?? "",
                ),
              )})`;
            })
            .join(", ")}`,
        ]
      : []),
    "",
  ]);
  return [
    "",
    "## Current layer manifest",
    "",
    ...layers,
    "## Default history",
    "",
    ...slots,
  ];
}

function buildPitchDeckPage(project: ProjectWithADRs): GeneratedPage | null {
  if (!project.pitch) return null;
  const transcript = pitchDeckToAgentMarkdown(project.pitch.content, convert);
  const projectUrl = markdownUrl(routePath("projects", project.slug));
  return {
    htmlPath: `/projects/${project.slug}/deck`,
    filePath: `projects/${project.slug}/deck.md`,
    title: project.pitch.title,
    description: project.pitch.description,
    content: transcript,
    facts: [
      ["Project", `${project.title} (${projectUrl})`],
      ["Slides", String(countPitchSlides(project.pitch.content))],
    ],
  };
}

function buildAdrPages(
  project: ProjectWithADRs,
  initiatives: InitiativeWithProjects[],
): GeneratedPage[] {
  const relatedInitiatives = getInitiativesForProject(
    project.slug,
    initiatives,
  );
  return project.adrs.map((adrCard) => {
    const adr = getProjectADR(project.slug, adrCard.slug);
    const facts: [string, string][] = [
      ["Project", `${project.title} (${markdownUrl(routePath("projects", project.slug))})`],
      ["Status", adr.status],
      ["Date", adr.date],
    ];
    if (adr.supersedes) facts.push(["Supersedes", adr.supersedes]);
    const ideas = getIdeasForADR(adr.adrRef);
    if (ideas.length > 0) {
      facts.push([
        "Ideas",
        ideas
          .map((idea) => `${idea.title} (${markdownUrl(routePath("ideas", idea.slug))})`)
          .join(", "),
      ]);
    }
    if (relatedInitiatives.length > 0) {
      facts.push([
        "Initiatives",
        relatedInitiatives
          .map(
            (initiative) =>
              `${initiative.title} (${markdownUrl(routePath("initiatives", initiative.slug))})`,
          )
          .join(", "),
      ]);
    }
    if (adr.isInherited) {
      facts.push([
        "Inherited from project",
        `${adr.originProjectSlug} (${markdownUrl(routePath("projects", adr.originProjectSlug, "adrs", adr.originAdrSlug))})`,
      ]);
    }
    const content = adr.isInherited
      ? [
          adr.inheritedSourceSummary
            ? `## Source summary\n\n${adr.inheritedSourceSummary}`
            : "",
          adr.inheritedProjectNotes
            ? `## Notes for ${project.title}\n\n${convert(adr.inheritedProjectNotes).trim()}`
            : "_No project-specific notes have been added._",
        ]
          .filter(Boolean)
          .join("\n\n")
      : convert(adr.content).trim();
    return {
      htmlPath: `/projects/${project.slug}/adrs/${adr.slug}`,
      filePath: `projects/${project.slug}/adrs/${adr.slug}.md`,
      title: adr.title,
      description: "",
      content,
      facts,
    };
  });
}

function buildProjectAliasPages(
  projects: ProjectWithADRs[],
): GeneratedPage[] {
  return getAllProjectAliases().flatMap(({ alias, target }) => {
    const project = projects.find(({ slug }) => slug === target);
    if (!project) {
      throw new Error(
        `Project alias '${alias}' references missing project '${target}'`,
      );
    }
    const canonicalProjectUrl = markdownUrl(
      routePath("projects", project.slug),
    );
    const projectPage: GeneratedPage = {
      htmlPath: `/projects/${alias}`,
      filePath: `projects/${alias}.md`,
      title: `${project.title} moved`,
      description: project.description,
      content: `This project is now called [${project.title}](${canonicalProjectUrl}).`,
      facts: [["Canonical project", canonicalProjectUrl]],
    };
    const adrPages = getAllProjectAliasADRPaths()
      .filter((path) => path.alias === alias)
      .map(({ adrSlug }) => {
        const adr = getProjectADR(target, adrSlug);
        const canonicalAdrUrl = markdownUrl(
          routePath("projects", project.slug, "adrs", adr.slug),
        );
        return {
          htmlPath: `/projects/${alias}/adrs/${adr.slug}`,
          filePath: `projects/${alias}/adrs/${adr.slug}.md`,
          title: `${adr.title} moved`,
          description: "",
          content: `This ADR now belongs to [${project.title}](${canonicalAdrUrl}).`,
          facts: [["Canonical ADR", canonicalAdrUrl]],
        } satisfies GeneratedPage;
      });
    return [projectPage, ...adrPages];
  });
}

function buildBlogIndexPage(
  posts: ReturnType<typeof getAllPosts>,
): GeneratedPage {
  return {
    htmlPath: "/blog",
    filePath: "blog.md",
    title: siteConfig.blog.title,
    description: siteConfig.blog.description,
    content: posts
      .flatMap((post) => {
        const tagSuffix =
          post.tags.length > 0 ? ` · ${post.tags.join(", ")}` : "";
        return [
          `### [${post.title}](${markdownUrl(routePath("blog", post.slug))})`,
          "",
          `${post.date} · ${post.readingTime}${tagSuffix}`,
          "",
          post.description,
          "",
        ];
      })
      .join("\n"),
  };
}

function buildBlogPostPages(
  posts: ReturnType<typeof getAllPosts>,
): GeneratedPage[] {
  return posts.map((post) => {
    const facts: [string, string][] = [
      ["Published", post.date],
      ["Reading time", post.readingTime],
    ];
    if (post.updated) facts.push(["Updated", post.updated]);
    if (post.tags.length > 0) facts.push(["Tags", post.tags.join(", ")]);
    if (post.canonicalUrl) facts.push(["Canonical URL", post.canonicalUrl]);
    const ideas = getIdeasForBlog(post.slug);
    if (ideas.length > 0) {
      facts.push([
        "Ideas",
        ideas
          .map((idea) => `${idea.title} (${markdownUrl(routePath("ideas", idea.slug))})`)
          .join(", "),
      ]);
    }
    return {
      htmlPath: `/blog/${post.slug}`,
      filePath: `blog/${post.slug}.md`,
      title: post.title,
      description: post.description,
      content: convert(post.content).trim(),
      facts,
    };
  });
}

function buildExperiencePage(): GeneratedPage {
  const sections = getAllExperience().flatMap((experience) => {
    const titles = [
      { title: experience.title, dates: formatExperienceDateRange(
        experience.previousTitles?.at(-1)?.endDate ?? experience.startDate,
        experience.endDate,
      ) },
      ...(experience.previousTitles ?? []).map((previous) => ({
        title: previous.title,
        dates: formatExperienceDateRange(previous.startDate, previous.endDate),
      })),
    ];
    return [
      `## ${experience.title} at [${experience.company}](${experience.companyUrl})`,
      "",
      `${formatExperienceDateRange(experience.startDate, experience.endDate)} · ${experience.location}`,
      "",
      ...(experience.previousTitles?.length
        ? [
            "Titles held:",
            "",
            ...titles.map((entry) => `- ${entry.title} (${entry.dates})`),
            "",
          ]
        : []),
      experience.description,
      "",
      ...experience.responsibilities.map((item) => `- ${item}`),
      "",
      experience.technologies.length > 0
        ? `Technologies: ${experience.technologies.join(", ")}\n`
        : "",
    ];
  });
  return {
    htmlPath: "/experience",
    filePath: "experience.md",
    title: "Experience",
    description: `Professional experience of ${siteConfig.name} — ${siteConfig.description}`,
    content: sections.join("\n"),
  };
}

function buildRecipesIndexPage(
  recipes: RecipeCardView[],
): GeneratedPage {
  return {
    htmlPath: "/recipes",
    filePath: "recipes.md",
    title: "Recipes",
    description:
      "A digital recipe book with search, filtering, and kitchen-friendly features",
    content: recipes
      .flatMap((recipe) => {
        const time = recipe.totalTime ? ` · ${recipe.totalTime} min` : "";
        const cuisine =
          recipe.cuisine.length > 0 ? ` · ${recipe.cuisine.join(", ")}` : "";
        return [
          `### [${recipe.title}](${markdownUrl(routePath("recipes", recipe.slug))})`,
          "",
          `Serves ${recipe.servings}${time}${cuisine}`,
          "",
          recipe.description,
          "",
        ];
      })
      .join("\n"),
  };
}

function buildSatelliteSwarmPage(): GeneratedPage {
  return {
    htmlPath: "/satellite-swarm",
    filePath: "satellite-swarm.md",
    title: "Autonomic Satellite Swarm",
    description:
      "A deterministic three-node satellite-swarm mission rendered on a CesiumJS globe",
    facts: [
      ["Project", markdownUrl("/projects/autonomic-satellite-swarm")],
      [
        "Source code",
        "https://github.com/Robbie-Palmer/hq/tree/main/cpp/autonomic-satellite-swarm",
      ],
    ],
    content: [
      "## C++ mission simulation",
      "",
      "Choose a geographic objective and run the portable C++ coordination code as WebAssembly in a module worker. The C++ simulation propagates each node's fixed TLE with SGP4, while CesiumJS draws the satellites, the selected node's orbit, and the objective.",
      "",
      "Fixed TLEs and simulation time keep the propagated positions deterministic. The historical candidacy score is not validated astrodynamics, and the safe-disabled state is software state rather than physical deorbiting.",
      "",
      "## Execution boundary",
      "",
      "Emscripten builds the same controller and deterministic trace runner exercised by native tests. A byte-for-byte parity check protects the default result, and the worker keeps C++ execution off the browser's main thread.",
    ].join("\n"),
  };
}

function buildPostHogApplicationPage(): GeneratedPage {
  return {
    htmlPath: "/posthog",
    filePath: "posthog.md",
    title: posthogApplication.title,
    description: posthogApplication.description,
    content: posthogApplicationMarkdown(),
    facts: [["Location", "Belfast, UK"]],
  };
}

function buildTechnologyPages(projects: ProjectWithADRs[]): GeneratedPage[] {
  const repository = loadDomainRepository();
  // ADR slugs are only unique within a project, so collect ADRs per
  // technology from the project cards, which carry their origin project.
  // Inherited ADRs are skipped so each decision appears once, linked to
  // the project where it was made.
  const adrsByTechnology = new Map<
    string,
    { title: string; projectSlug: string; adrSlug: string }[]
  >();
  for (const project of projects) {
    for (const adr of project.adrs) {
      if (adr.isInherited) continue;
      for (const badge of adr.technologies) {
        const entries = adrsByTechnology.get(badge.slug) ?? [];
        entries.push({
          title: adr.title,
          projectSlug: project.slug,
          adrSlug: adr.slug,
        });
        adrsByTechnology.set(badge.slug, entries);
      }
    }
  }

  return getAllTechnologySlugs(repository).flatMap((slug) => {
    const tech = getTechnologyDetail(repository, slug);
    if (!tech) return [];
    const related = getRelatedContentForTechnology(repository, slug);

    const sections: string[] = tech.overview
      ? [convert(tech.overview).trim(), ""]
      : [];
    if (related.ideas.length > 0) {
      sections.push(
        "## Ideas this technology builds on or exposes",
        "",
        ...related.ideas.map(
          (idea) =>
            `- [${idea.title}](${markdownUrl(routePath("ideas", idea.slug))}): ${idea.description}`,
        ),
        "",
      );
    }
    if (related.projects.length > 0) {
      sections.push(
        "## Projects using this technology",
        "",
        ...related.projects.map(
          (project) =>
            `- [${project.title}](${markdownUrl(routePath("projects", project.slug))})`,
        ),
        "",
      );
    }
    const adrs = adrsByTechnology.get(slug) ?? [];
    if (adrs.length > 0) {
      sections.push(
        "## Architecture decision records",
        "",
        ...adrs.map(
          (adr) =>
            `- [${adr.title}](${markdownUrl(routePath("projects", adr.projectSlug, "adrs", adr.adrSlug))})`,
        ),
        "",
      );
    }
    if (related.blogs.length > 0) {
      sections.push(
        "## Blog posts",
        "",
        ...related.blogs.map(
          (post) =>
            `- [${post.title}](${markdownUrl(routePath("blog", post.slug))}) — ${post.date}`,
        ),
        "",
      );
    }
    if (related.roles.length > 0) {
      sections.push(
        "## Used professionally at",
        "",
        ...related.roles.map((role) => `- ${role.company} — ${role.title}`),
        "",
      );
    }

    const facts: [string, string][] = [["Website", tech.website]];
    return [
      {
        htmlPath: `/technologies/${tech.slug}`,
        filePath: `technologies/${tech.slug}.md`,
        title: tech.name,
        description: tech.description ?? "",
        content: sections.join("\n").trim() || "_No related content yet._",
        facts,
      },
    ];
  });
}

function buildIdeasIndexPage(
  ideas: ReturnType<typeof getAllIdeas>,
): GeneratedPage {
  return {
    htmlPath: "/ideas",
    filePath: "ideas.md",
    title: "Ideas",
    description:
      "Laws, methods, and mental models that recur across my projects, decisions, and writing.",
    content: ideas
      .flatMap((idea) => [
        `### [${idea.title}](${markdownUrl(routePath("ideas", idea.slug))})`,
        "",
        idea.description,
        "",
      ])
      .join("\n"),
  };
}

function buildIdeaPages(
  ideas: ReturnType<typeof getAllIdeas>,
): GeneratedPage[] {
  return ideas.map((idea) => {
    const detail = getIdea(idea.slug);
    if (!detail) throw new Error(`Idea not found: ${idea.slug}`);
    const sections: string[] = [convert(detail.content).trim()];
    if (detail.relatedIdeas.length > 0) {
      sections.push(
        "",
        "## Related ideas",
        "",
        ...detail.relatedIdeas.map(
          (related) =>
            `- [${related.title}](${markdownUrl(routePath("ideas", related.slug))}): ${related.description}`,
        ),
      );
    }
    const references = detail.relatedContent;
    if (
      references.technologies.length > 0 ||
      references.projects.length > 0 ||
      references.blogs.length > 0 ||
      references.adrs.length > 0
    ) {
      sections.push(
        "",
        "## Where it appears",
        "",
        ...references.technologies.map(
          (technology) =>
            `- Technology: [${technology.name}](${markdownUrl(routePath("technologies", technology.slug))})`,
        ),
        ...references.projects.map(
          (project) =>
            `- Project: [${project.title}](${markdownUrl(routePath("projects", project.slug))})`,
        ),
        ...references.blogs.map(
          (post) =>
            `- Blog post: [${post.title}](${markdownUrl(routePath("blog", post.slug))})`,
        ),
        ...references.adrs.map(
          (adr) =>
            `- ADR: [${adr.title}](${markdownUrl(routePath("projects", adr.projectSlug, "adrs", adr.slug))})`,
        ),
      );
    }
    return {
      htmlPath: `/ideas/${idea.slug}`,
      filePath: `ideas/${idea.slug}.md`,
      title: idea.title,
      description: idea.description,
      content: sections.join("\n"),
      facts: detail.sourceUrl ? [["Source", detail.sourceUrl]] : undefined,
    };
  });
}

function buildHomePage(): GeneratedPage {
  return {
    htmlPath: "/",
    filePath: "index.md",
    title: siteConfig.name,
    description: siteConfig.description,
    content: [
      `Personal site of ${siteConfig.name}. Every major page has a Markdown twin: append \`.md\` to the page URL (e.g. ${markdownUrl("/projects")}). The full index is at ${siteConfig.url}/llms.txt.`,
      "",
      "## Sections",
      "",
      `- [Experience](${markdownUrl("/experience")}): career history, roles, and technologies`,
      `- [Projects](${markdownUrl("/projects")}): projects, ADRs, and building philosophy`,
      `- [Ideas](${markdownUrl("/ideas")}): recurring laws, methods, and mental models`,
      `- [Blog](${markdownUrl("/blog")}): ${siteConfig.blog.description}`,
      `- [Recipes](${markdownUrl("/recipes")}): a digital recipe book`,
      `- [Satellite swarm](${markdownUrl("/satellite-swarm")}): a deterministic mission replay on a 3D globe`,
      `- [PostHog application](${markdownUrl("/posthog")}): a speculative application backed by working systems and shipped code`,
      "",
      "## Links",
      "",
      `- GitHub: ${siteConfig.author.github}`,
      `- LinkedIn: ${siteConfig.author.linkedin}`,
      `- Site source code: ${siteConfig.author.sourceRepo}`,
    ].join("\n"),
  };
}

function buildLlmsTxt(
  projects: ProjectWithADRs[],
  initiatives: InitiativeWithProjects[],
  posts: ReturnType<typeof getAllPosts>,
  recipes: RecipeCardView[],
  technologyPages: GeneratedPage[],
  ideaPages: GeneratedPage[],
): string {
  const lines = [
    `# ${siteConfig.name}`,
    "",
    `> ${siteConfig.description}. Personal site: projects with architecture decision records (ADRs), a building philosophy, career history, and a blog.`,
    "",
    `Every page listed below is plain Markdown. The same content is available as HTML by removing the \`.md\` suffix. All pages concatenated: ${siteConfig.url}/llms-full.txt`,
    "",
    "## Overview",
    "",
    `- [About](${markdownUrl("/")}): site overview and contact links`,
    `- [Experience](${markdownUrl("/experience")}): career history, roles, responsibilities, and technologies`,
    `- [Projects](${markdownUrl("/projects")}): all projects plus the building philosophy that guides them`,
    `- [Ideas](${markdownUrl("/ideas")}): recurring laws, methods, and mental models`,
    `- [Satellite swarm](${markdownUrl("/satellite-swarm")}): a deterministic C++ WebAssembly mission on a CesiumJS globe`,
    `- [PostHog application](${markdownUrl("/posthog")}): a speculative application backed by working systems and shipped code`,
    "",
    "## Initiatives",
    "",
    ...initiatives.map(
      (initiative) =>
        `- [${initiative.title}](${markdownUrl(routePath("initiatives", initiative.slug))}): ${initiative.description}`,
    ),
    "",
    "## Projects",
    "",
    ...projects.map(
      (project) =>
        `- [${project.title}](${markdownUrl(routePath("projects", project.slug))}): ${project.description}`,
    ),
    ...projects.flatMap((project) =>
      project.pitch
        ? [
            `- [${project.pitch.title}](${markdownUrl(routePath("projects", project.slug, "deck"))}): ${project.pitch.description}`,
          ]
        : [],
    ),
    "",
    "## Architecture Decision Records",
    "",
    ...projects.flatMap((project) =>
      project.adrs
        .filter((adr) => !adr.isInherited)
        .map(
          (adr) =>
            `- [${project.title} — ${adr.title}](${markdownUrl(routePath("projects", project.slug, "adrs", adr.slug))})`,
        ),
    ),
    "",
    "## Blog",
    "",
    `- [Blog index](${markdownUrl("/blog")}): all posts with summaries`,
    ...posts.map(
      (post) =>
        `- [${post.title}](${markdownUrl(routePath("blog", post.slug))}): ${post.description}`,
    ),
    "",
    "## Technologies",
    "",
    "Each page lists the ideas the technology builds on or exposes, plus the projects, ADRs, blog posts, and roles using it.",
    "",
    ...technologyPages.map((page) => {
      const descriptionSuffix = page.description ? `: ${page.description}` : "";
      return `- [${page.title}](${markdownUrl(page.htmlPath)})${descriptionSuffix}`;
    }),
    "",
    "## Ideas",
    "",
    "Each page defines an idea and links to related ideas, technologies, projects, ADRs, and posts.",
    "",
    ...ideaPages.map(
      (page) => `- [${page.title}](${markdownUrl(page.htmlPath)}): ${page.description}`,
    ),
    "",
    "## Recipes",
    "",
    `Each recipe is also available as schema.org Recipe JSON (importable into most recipe apps): append \`.json\` to the recipe URL instead of \`.md\`.`,
    "",
    `- [Recipe index](${markdownUrl("/recipes")}): a digital recipe book`,
    ...recipes.map(
      (recipe) =>
        `- [${recipe.title}](${markdownUrl(routePath("recipes", recipe.slug))}): ${recipe.description}`,
    ),
    "",
  ];
  return lines.join("\n");
}

/**
 * Restricts Pages Function invocations to page routes, so static assets
 * are served straight from the CDN.
 */
function buildRoutesJson(): string {
  return `${JSON.stringify(
    {
      version: 1,
      include: [
        "/.well-known/agent-configuration",
        "/api/auth/*",
        "/api/profile/*",
        "/api/households",
        "/api/households/*",
        "/api/notifications",
        "/api/notifications/*",
        "/api/pantry",
        "/api/pantry/*",
        "/api/shopping-lists",
        "/api/shopping-lists/*",
        "/api/recipes",
        "/api/recipes/*",
        "/api/recipe-imports",
        "/api/recipe-imports/*",
        "/ingest/*",
        "/llms.txt",
        "/llms-full.txt",
        "/sitemap.xml",
        "/",
        "/experience",
        "/initiatives/*",
        "/projects",
        "/projects/*",
        "/blog",
        "/blog/*",
        "/recipes",
        "/recipes/*",
        "/satellite-swarm",
        "/posthog",
        "/technologies/*",
        "/ideas",
        "/ideas/*",
      ],
      exclude: ["/_next/*", "/company-logos/*", "/tech-icons/*"],
    },
    null,
    2,
  )}\n`;
}

/**
 * Cloudflare Pages caps _headers at 100 rules and doesn't support
 * placeholders in header values, so only the entry pages advertise their
 * Markdown twin via a Link header.
 */
function buildHeadersFile(pages: GeneratedPage[]): string {
  const entryPages = pages.filter(
    (page) => page.htmlPath.split("/").filter(Boolean).length <= 1,
  );
  let headers = fs.readFileSync(BASE_HEADERS_PATH, "utf8").trimEnd();

  for (const page of entryPages) {
    const linkHeader = `  Link: <${markdownUrl(page.htmlPath)}>; rel="alternate"; type="text/markdown"`;
    const lines = headers.split("\n");
    const existingRuleIndex = lines.indexOf(page.htmlPath);

    if (existingRuleIndex === -1) {
      headers = `${headers}\n\n${page.htmlPath}\n${linkHeader}`;
      continue;
    }

    const nextBlankLine = lines.findIndex(
      (line, index) => index > existingRuleIndex && line === "",
    );
    const insertAt = nextBlankLine === -1 ? lines.length : nextBlankLine;
    lines.splice(insertAt, 0, linkHeader);
    headers = lines.join("\n");
  }

  return `${headers}\n`;
}

function writeFile(relativePath: string, content: string): void {
  const filePath = path.join(OUT_DIR, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function main(): void {
  if (!fs.existsSync(OUT_DIR)) {
    console.error(
      "out/ directory not found. Run `next build` first (this script runs as part of `pnpm build`).",
    );
    process.exit(1);
  }
  if (!hasImagesAccountHash) {
    console.warn(
      "NEXT_PUBLIC_CF_IMAGES_ACCOUNT_HASH not set — images will be omitted from generated Markdown.",
    );
  }

  const projects = getAllProjects();
  const ideas = getAllIdeas();
  const initiatives = getAllInitiatives();
  const posts = getAllPosts();
  const philosophy = getBuildingPhilosophy();
  // Recipes are database-backed and served dynamically by the Pages Function.
  const recipes: RecipeCardView[] = [];
  const technologyPages = buildTechnologyPages(projects);
  const ideaPages = buildIdeaPages(ideas);
  const pitchDeckPages = projects
    .map(buildPitchDeckPage)
    .filter((page): page is GeneratedPage => page !== null);
  const projectAliasPages = buildProjectAliasPages(projects);

  const pages: GeneratedPage[] = [
    buildHomePage(),
    buildExperiencePage(),
    buildProjectsIndexPage(projects, initiatives, philosophy),
    buildIdeasIndexPage(ideas),
    ...ideaPages,
    ...buildInitiativePages(initiatives),
    ...projects.map((project) => buildProjectPage(project, initiatives)),
    ...pitchDeckPages,
    ...projects.flatMap((project) => buildAdrPages(project, initiatives)),
    buildBlogIndexPage(posts),
    ...buildBlogPostPages(posts),
    buildRecipesIndexPage(recipes),
    buildSatelliteSwarmPage(),
    buildPostHogApplicationPage(),
    ...technologyPages,
  ];

  for (const page of pages) {
    writeFile(
      page.filePath,
      renderPage(
        {
          title: page.title,
          htmlPath: page.htmlPath,
          description: page.description || undefined,
          facts: page.facts,
        },
        page.content,
      ),
    );
  }

  for (const page of projectAliasPages) {
    writeFile(
      page.filePath,
      renderPage(
        {
          title: page.title,
          htmlPath: page.htmlPath,
          description: page.description || undefined,
          facts: page.facts,
        },
        page.content,
      ),
    );
  }

  writeFile(
    "llms.txt",
    buildLlmsTxt(
      projects,
      initiatives,
      posts,
      recipes,
      technologyPages,
      ideaPages,
    ),
  );

  // The llms.txt index is deliberately not prepended: its navigation links
  // are redundant when every page is inline
  const llmsFull = pages
    .map((page) => fs.readFileSync(path.join(OUT_DIR, page.filePath), "utf-8"))
    .join("\n\n");
  writeFile("llms-full.txt", llmsFull);

  writeFile("_headers", buildHeadersFile(pages));
  writeFile("_routes.json", buildRoutesJson());

  console.log(
    `Generated ${pages.length} Markdown pages and ${projectAliasPages.length} legacy project aliases, llms.txt, llms-full.txt, _headers, and _routes.json in out/`,
  );
}

main();
