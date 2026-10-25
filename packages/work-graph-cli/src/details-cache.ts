import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { WorkItemDetails } from "./generated/client/types.gen.js";
import { zWorkItemDetails } from "./generated/client/zod.gen.js";

const CACHE_SCHEMA_VERSION = 1;

const cacheEntrySchema = z.object({
  schemaVersion: z.literal(CACHE_SCHEMA_VERSION),
  apiUrl: z.string(),
  workItemId: z.string(),
  details: zWorkItemDetails,
});

export interface WorkItemDetailsCache {
  read(apiUrl: string, workItemId: string): Promise<WorkItemDetails | undefined>;
  remove(apiUrl: string, workItemId: string): Promise<void>;
  write(
    apiUrl: string,
    workItemId: string,
    details: WorkItemDetails,
  ): Promise<void>;
}

const isTerminal = (details: WorkItemDetails): boolean =>
  details.lifecycle === "released" || details.lifecycle === "cancelled";

const cacheKey = (apiUrl: string, workItemId: string): string =>
  createHash("sha256")
    .update(apiUrl)
    .update("\0")
    .update(workItemId)
    .digest("hex");

export class FileWorkItemDetailsCache implements WorkItemDetailsCache {
  readonly #directory: string;

  constructor(directory: string) {
    this.#directory = directory;
  }

  #path(apiUrl: string, workItemId: string): string {
    return join(this.#directory, `${cacheKey(apiUrl, workItemId)}.json`);
  }

  async read(
    apiUrl: string,
    workItemId: string,
  ): Promise<WorkItemDetails | undefined> {
    const path = this.#path(apiUrl, workItemId);
    try {
      const parsed = cacheEntrySchema.safeParse(
        JSON.parse(await readFile(path, "utf8")),
      );
      if (
        !parsed.success ||
        parsed.data.apiUrl !== apiUrl ||
        parsed.data.workItemId !== workItemId ||
        !isTerminal(parsed.data.details)
      ) {
        await rm(path, { force: true });
        return undefined;
      }
      return parsed.data.details;
    } catch {
      await rm(path, { force: true }).catch(() => undefined);
      return undefined;
    }
  }

  async remove(apiUrl: string, workItemId: string): Promise<void> {
    try {
      await rm(this.#path(apiUrl, workItemId), { force: true });
    } catch {
      return;
    }
  }

  async write(
    apiUrl: string,
    workItemId: string,
    details: WorkItemDetails,
  ): Promise<void> {
    if (!isTerminal(details)) return;

    const path = this.#path(apiUrl, workItemId);
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    try {
      await mkdir(this.#directory, { mode: 0o700, recursive: true });
      await writeFile(
        temporaryPath,
        `${JSON.stringify({
          schemaVersion: CACHE_SCHEMA_VERSION,
          apiUrl,
          workItemId,
          details,
        })}\n`,
        { encoding: "utf8", flag: "wx", mode: 0o600 },
      );
      await rename(temporaryPath, path);
    } catch {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}

const disabledCache: WorkItemDetailsCache = {
  read: () => Promise.resolve(undefined),
  remove: () => Promise.resolve(),
  write: () => Promise.resolve(),
};

export const createWorkItemDetailsCache = (
  environment: NodeJS.ProcessEnv,
): WorkItemDetailsCache => {
  const configuredDirectory = environment.WORK_GRAPH_CACHE_DIR?.trim();
  if (environment.WORK_GRAPH_CACHE_DIR !== undefined && !configuredDirectory) {
    return disabledCache;
  }

  const cacheRoot = environment.XDG_CACHE_HOME?.trim();
  const home = environment.HOME?.trim();
  const directory =
    configuredDirectory ||
    (cacheRoot ? join(cacheRoot, "work-graph") : undefined) ||
    (home ? join(home, ".cache", "work-graph") : undefined);

  return directory ? new FileWorkItemDetailsCache(directory) : disabledCache;
};
