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

// Collection indexes are composed in their route modules instead of a single
// content document, so each index names that module as its source target.
const generatedIndexSources = {
  "/": "ui/app/(site)/page.tsx",
  "/blog": "ui/app/(site)/blog/page.tsx",
  "/ideas": "ui/app/(site)/ideas/page.tsx",
  "/initiatives": "ui/app/(site)/initiatives/page.tsx",
  "/product-decisions": "ui/app/(site)/product-decisions/page.tsx",
  "/projects": "ui/app/(site)/projects/page.tsx",
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
  ["/resume", "ui/app/(site)/resume"],
] as const satisfies ReadonlyArray<readonly [string, RepositoryPath]>;

function normalizePathname(pathname: string | null): string {
  if (!pathname || pathname === "/") return "/";
  return pathname.replace(/\/+$/, "");
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
