import { siteConfig } from "@/lib/config/site-config";
import { markdownUrl } from "@/lib/content/agent-markdown";

export type PageSourceKind =
  | "canonical-markdown"
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
} as const satisfies Record<string, RepositoryPath>;

const markdownTwinPatterns = [
  /^\/blog\/[^/]+$/,
  /^\/ideas\/[^/]+$/,
  /^\/initiatives\/[^/]+$/,
  /^\/projects\/[^/]+$/,
  /^\/projects\/[^/]+\/adrs\/[^/]+$/,
  /^\/projects\/[^/]+\/pdrs\/[^/]+$/,
  /^\/technologies\/[^/]+$/,
] as const;

const markdownTwinPaths = new Set(["/recipes", "/satellite-swarm"]);

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

export function resolvePageSource(pathname: string | null): PageSource {
  const normalizedPath = normalizePathname(pathname);
  const generatedSource =
    generatedIndexSources[normalizedPath as keyof typeof generatedIndexSources];
  if (generatedSource) return repositoryFileSource(generatedSource);

  const authoredSource =
    authoredPageSources[normalizedPath as keyof typeof authoredPageSources];
  if (authoredSource) return repositoryFileSource(authoredSource);

  if (
    markdownTwinPaths.has(normalizedPath) ||
    markdownTwinPatterns.some((pattern) => pattern.test(normalizedPath))
  ) {
    return { kind: "canonical-markdown", url: markdownUrl(normalizedPath) };
  }

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
