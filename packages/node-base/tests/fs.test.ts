import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pathExists } from "../src/fs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("pathExists", () => {
  it("distinguishes existing and missing filesystem paths", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "node-base-fs-"));
    temporaryDirectories.push(directory);
    const file = path.join(directory, "present.txt");
    await writeFile(file, "present", "utf8");

    await expect(pathExists(directory)).resolves.toBe(true);
    await expect(pathExists(file)).resolves.toBe(true);
    await expect(pathExists(path.join(directory, "missing.txt"))).resolves.toBe(
      false,
    );
  });
});
