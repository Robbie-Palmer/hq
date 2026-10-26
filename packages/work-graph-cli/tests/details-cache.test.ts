import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createWorkItemDetailsCache,
  FileWorkItemDetailsCache,
} from "../src/details-cache.js";
import type { WorkItemDetails } from "../src/generated/client/types.gen.js";

const API_URL = "https://work.example.test/root/";

const details = (
  lifecycle: WorkItemDetails["lifecycle"] = "released",
): WorkItemDetails => ({
  id: "ticket",
  title: "Cached ticket",
  lifecycle,
  parentId: null,
  rank: null,
  priorityRank: 1,
  schedulingInitiativeId: null,
  schedulingProjectId: null,
  expedited: false,
  expediteReason: null,
  priority: {
    initiativeRank: 1,
    projectRank: 1,
    ticketRank: 1,
    expedited: false,
    effectiveExpedited: false,
    donatedFromWorkItemId: null,
  },
  stage: lifecycle === "open" ? "ready" : lifecycle,
  currentLease: null,
  deliveryEvidence: { items: [], nextCursor: null },
  completionCandidate: null,
});

const temporaryDirectories: string[] = [];

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "work-graph-cache-test-"));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("Given the terminal work-item details cache", () => {
  it("stores a private terminal response and reads it by API and ticket", async () => {
    const directory = await temporaryDirectory();
    const cache = new FileWorkItemDetailsCache(directory);

    await cache.write(API_URL, "ticket", details());

    expect(await cache.read(API_URL, "ticket")).toEqual(details());
    expect(await cache.read(`${API_URL}other/`, "ticket")).toBeUndefined();
    expect(await cache.read(API_URL, "other-ticket")).toBeUndefined();
    const files = await readdir(directory);
    expect(files).toHaveLength(1);
    expect((await stat(join(directory, files[0] ?? ""))).mode & 0o777).toBe(
      0o600,
    );
  });

  it("does not store open work-item details", async () => {
    const directory = await temporaryDirectory();
    const cache = new FileWorkItemDetailsCache(directory);

    await cache.write(API_URL, "ticket", details("open"));

    expect(await readdir(directory)).toEqual([]);
  });

  it("removes corrupt and mismatched entries", async () => {
    const directory = await temporaryDirectory();
    const cache = new FileWorkItemDetailsCache(directory);
    await cache.write(API_URL, "ticket", details());
    const [file] = await readdir(directory);
    const path = join(directory, file ?? "");
    const entry = JSON.parse(await readFile(path, "utf8")) as Record<
      string,
      unknown
    >;
    entry.workItemId = "different-ticket";
    await writeFile(path, JSON.stringify(entry));

    expect(await cache.read(API_URL, "ticket")).toBeUndefined();
    expect(await readdir(directory)).toEqual([]);

    await cache.write(API_URL, "ticket", details());
    const [replacement] = await readdir(directory);
    await writeFile(join(directory, replacement ?? ""), "not JSON");
    expect(await cache.read(API_URL, "ticket")).toBeUndefined();
    expect(await readdir(directory)).toEqual([]);
  });

  it("removes a stored response", async () => {
    const directory = await temporaryDirectory();
    const cache = new FileWorkItemDetailsCache(directory);
    await cache.write(API_URL, "ticket", details("cancelled"));

    await cache.remove(API_URL, "ticket");

    expect(await cache.read(API_URL, "ticket")).toBeUndefined();
  });

  it("fails open when its directory cannot be written or read", async () => {
    const directory = await temporaryDirectory();
    const blockedPath = join(directory, "blocked");
    await writeFile(blockedPath, "file in place of cache directory");
    await chmod(blockedPath, 0o400);
    const cache = new FileWorkItemDetailsCache(blockedPath);

    await expect(
      cache.write(API_URL, "ticket", details()),
    ).resolves.toBeUndefined();
    await expect(cache.read(API_URL, "ticket")).resolves.toBeUndefined();
    await expect(cache.remove(API_URL, "ticket")).resolves.toBeUndefined();
  });

  it("uses an explicit directory and supports disabling the cache", async () => {
    const directory = await temporaryDirectory();
    const cache = createWorkItemDetailsCache({
      WORK_GRAPH_CACHE_DIR: directory,
    });
    await cache.write(API_URL, "ticket", details());
    expect(await cache.read(API_URL, "ticket")).toEqual(details());

    const disabled = createWorkItemDetailsCache({
      HOME: directory,
      WORK_GRAPH_CACHE_DIR: " ",
    });
    await disabled.write(API_URL, "disabled", details());
    expect(await disabled.read(API_URL, "disabled")).toBeUndefined();
  });

  it("falls back to XDG_CACHE_HOME, HOME, then no cache", async () => {
    const directory = await temporaryDirectory();
    const xdgCache = createWorkItemDetailsCache({ XDG_CACHE_HOME: directory });
    await xdgCache.write(API_URL, "xdg", { ...details(), id: "xdg" });
    expect(await readdir(join(directory, "work-graph"))).toHaveLength(1);

    const homeDirectory = await temporaryDirectory();
    const homeCache = createWorkItemDetailsCache({ HOME: homeDirectory });
    await homeCache.write(API_URL, "home", { ...details(), id: "home" });
    expect(
      await readdir(join(homeDirectory, ".cache", "work-graph")),
    ).toHaveLength(1);

    const disabled = createWorkItemDetailsCache({});
    await disabled.write(API_URL, "none", details());
    expect(await disabled.read(API_URL, "none")).toBeUndefined();
    await expect(disabled.remove(API_URL, "none")).resolves.toBeUndefined();
  });
});
