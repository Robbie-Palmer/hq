import { appendFile, glob, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseProjectProfile } from "../packages/project-generator/src/profile.js";

const PROJECTS_DIRECTORY = "ui/content/projects";
const PROFILE_FILENAME = "project-profile.yaml";

export interface ProjectPreviewLink {
  readonly name: string;
  readonly path: string;
}

interface TextOutput {
  write(value: string): unknown;
}

export function projectPreviewLinksFromProfiles(
  profiles: readonly ReturnType<typeof parseProjectProfile>[],
): ProjectPreviewLink[] {
  const links = profiles.flatMap((profile) => [
    ...profile.preview_links.map(({ name, mount_path: mountPath }) => ({
      name,
      path: mountPath,
    })),
    ...profile.components.flatMap((component) => {
      if (component.kind !== "project-ui") return [];
      const mountPath = component.mount_path;
      if (!mountPath) {
        throw new Error(
          `Project UI component '${component.id}' is missing a mount path`,
        );
      }
      return [{ name: component.name, path: mountPath }];
    }),
  ]);

  const duplicatePath = links.find(
    (candidate, index) =>
      links.findIndex(({ path: mountPath }) => mountPath === candidate.path) !==
      index,
  );
  if (duplicatePath) {
    throw new Error(
      `Project profiles define duplicate preview path '${duplicatePath.path}'`,
    );
  }

  return links.toSorted((left, right) =>
    left.name.localeCompare(right.name, "en"),
  );
}

export function renderProjectPreviewLinks(
  previewSiteUrl: string,
  links: readonly ProjectPreviewLink[],
): string[] {
  return links.map(
    ({ name, path: mountPath }) =>
      `**${name}:** ${previewSiteUrl}${mountPath}`,
  );
}

export async function loadProjectPreviewLinks(
  repositoryRoot: string,
): Promise<ProjectPreviewLink[]> {
  const profilePaths: string[] = [];
  for await (const profilePath of glob(
    `${PROJECTS_DIRECTORY}/*/${PROFILE_FILENAME}`,
    { cwd: repositoryRoot },
  )) {
    profilePaths.push(profilePath);
  }
  const profiles = await Promise.all(
    profilePaths.map(async (profilePath) =>
      parseProjectProfile(
        await readFile(path.join(repositoryRoot, profilePath), "utf8"),
      ),
    ),
  );

  return projectPreviewLinksFromProfiles(profiles);
}

export async function writeProjectPreviewLinks(
  repositoryRoot: string,
  githubOutput: string | undefined,
  previewSiteUrl: string | undefined,
  output: TextOutput,
): Promise<void> {
  const links = await loadProjectPreviewLinks(repositoryRoot);
  const serializedLinks = JSON.stringify(links);
  if (githubOutput) {
    if (!previewSiteUrl) {
      throw new Error("PREVIEW_SITE_URL is required for GitHub Actions output");
    }
    const markdownLines = JSON.stringify(
      renderProjectPreviewLinks(previewSiteUrl, links),
    );
    await appendFile(
      githubOutput,
      `links=${serializedLinks}\nmarkdown_lines=${markdownLines}\n`,
      "utf8",
    );
    return;
  }
  output.write(`${serializedLinks}\n`);
}

/* v8 ignore next 7 -- exercised through writeProjectPreviewLinks */
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await writeProjectPreviewLinks(
    process.cwd(),
    process.env.GITHUB_OUTPUT,
    process.env.PREVIEW_SITE_URL,
    process.stdout,
  );
}
