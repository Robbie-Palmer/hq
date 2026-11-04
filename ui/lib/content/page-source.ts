import { siteConfig } from "@/lib/config/site-config";

export type PageSourceKind =
  | "repository-file"
  | "runtime-fallback"
  | "repository-fallback";

export interface PageSource {
  kind: PageSourceKind;
  url: string;
}

type RepositoryPath = `ui/${string}`;

function siteSource<Path extends string>(path: Path): `ui/app/(site)/${Path}` {
  return `ui/app/(site)/${path}`;
}

function contentSource<Path extends string>(path: Path): `ui/content/${Path}` {
  return `ui/content/${path}`;
}

// Collection indexes are composed in their route modules instead of a single
// content document, so each index names that module as its source target.
const generatedIndexSources = {
  "/": siteSource("page.tsx"),
  "/blog": siteSource("blog/page.tsx"),
  "/ideas": siteSource("ideas/page.tsx"),
  "/initiatives": siteSource("initiatives/page.tsx"),
  "/product-decisions": siteSource("product-decisions/page.tsx"),
  "/projects": siteSource("projects/page.tsx"),
} as const satisfies Record<string, RepositoryPath>;

const authoredPageSources = {
  "/building-philosophy": "ui/content/projects/building-philosophy.mdx",
  "/experience": "ui/content/experience.ts",
  "/posthog": "ui/content/posthog.ts",
  "/recipes": "ui/app/recipes/page.tsx",
  "/satellite-swarm": "ui/app/satellite-swarm/page.tsx",
} as const satisfies Record<string, RepositoryPath>;

// Renamed URLs resolve to the same checked-in source as their canonical page.
const renamedPageSources = {
  "/projects/personal-site": contentSource(
    "projects/personal-knowledge-graph/index.mdx",
  ),
  "/projects/recipe-site/adrs/000-github-public-repo": contentSource(
    "projects/personal-knowledge-graph/adrs/000-github-public-repo.mdx",
  ),
} as const satisfies Record<string, RepositoryPath>;

const runtimeFallbacks = [
  ["/recipes", "ui/app/recipes"],
  ["/resume", siteSource("resume")],
] as const satisfies ReadonlyArray<readonly [string, RepositoryPath]>;

function normalizePathname(pathname: string | null): string {
  if (!pathname || pathname === "/") return "/";
  let end = pathname.length;
  while (end > 0 && pathname.codePointAt(end - 1) === 47) end -= 1;
  return pathname.slice(0, end);
}

function repositoryUrl(path: RepositoryPath, view: "blob" | "tree"): string {
  return `${siteConfig.author.sourceRepo}/${view}/main/${path}`;
}

function repositoryFileSource(path: RepositoryPath): PageSource {
  return { kind: "repository-file", url: repositoryUrl(path, "blob") };
}

function resolveContentSource(pathname: string): RepositoryPath | undefined {
  const [section, slug, recordType, recordSlug, extra] = pathname
    .slice(1)
    .split("/");
  if (!slug || extra) return undefined;

  if (!recordType) {
    switch (section) {
      case "blog":
      case "ideas":
      case "initiatives":
        return contentSource(`${section}/${slug}.mdx`);
      case "projects":
        return contentSource(`projects/${slug}/index.mdx`);
      case "technologies":
        return contentSource("technologies.ts");
      default:
        return undefined;
    }
  }

  if (
    section === "projects" &&
    recordSlug &&
    (recordType === "adrs" || recordType === "pdrs")
  ) {
    return contentSource(`projects/${slug}/${recordType}/${recordSlug}.mdx`);
  }

  return undefined;
}

export function resolvePageSource(pathname: string | null): PageSource {
  const normalizedPath = normalizePathname(pathname);
  const generatedSource =
    generatedIndexSources[normalizedPath as keyof typeof generatedIndexSources];
  if (generatedSource) return repositoryFileSource(generatedSource);

  const authoredSource =
    authoredPageSources[normalizedPath as keyof typeof authoredPageSources];
  if (authoredSource) return repositoryFileSource(authoredSource);

  const renamedSource =
    renamedPageSources[normalizedPath as keyof typeof renamedPageSources];
  if (renamedSource) return repositoryFileSource(renamedSource);

  const contentSourcePath = resolveContentSource(normalizedPath);
  if (contentSourcePath) return repositoryFileSource(contentSourcePath);

  const runtimeFallback = runtimeFallbacks.find(
    ([prefix]) =>
      normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`),
  );
  if (runtimeFallback) {
    return {
      kind: "runtime-fallback",
      url: repositoryUrl(runtimeFallback[1], "tree"),
    };
  }

  return {
    kind: "repository-fallback",
    url: siteConfig.author.sourceRepo,
  };
}
