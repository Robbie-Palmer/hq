import { describe, expect, it, vi } from "vitest";
import { EXIT_CODES } from "../src/errors.js";
import { findRepositoryRoot, updateFromCheckout } from "../src/self-update.js";

describe("Given a Work Graph CLI source checkout", () => {
  const repositoryFiles = new Set([
    "/workspace/hq/.mise.toml",
    "/workspace/hq/packages/work-graph-cli/package.json",
    "/workspace/hq/packages/work-graph-cli/mise.toml",
  ]);
  const pathExists = (path: string) => repositoryFiles.has(path);

  it("finds the repository root from a nested directory", () => {
    expect(
      findRepositoryRoot("/workspace/hq/packages/work-graph-cli", pathExists),
    ).toBe("/workspace/hq");
  });

  it("rejects a directory outside the repository", () => {
    expect(findRepositoryRoot("/workspace/other", () => false)).toBeUndefined();
  });

  it("runs the managed global-install task at the repository root", () => {
    const runInstaller = vi.fn(() => ({ status: 0, stderr: "" }));

    expect(
      updateFromCheckout("/workspace/hq/packages/work-graph-cli", {
        pathExists,
        runInstaller,
      }),
    ).toEqual({ sourceDirectory: "/workspace/hq", status: "updated" });
    expect(runInstaller).toHaveBeenCalledWith("/workspace/hq");
  });

  it("reports an invalid source directory as a usage error", () => {
    try {
      updateFromCheckout("/workspace/other", { pathExists: () => false });
      throw new Error("Expected updateFromCheckout to fail");
    } catch (error) {
      expect(error).toMatchObject({
        code: "CLI_USAGE",
        exitCode: EXIT_CODES.usage,
      });
    }
  });

  it("reports installer failures as transport errors", () => {
    try {
      updateFromCheckout("/workspace/hq", {
        pathExists,
        runInstaller: () => ({
          status: 1,
          stderr: "npm could not replace the package",
        }),
      });
      throw new Error("Expected updateFromCheckout to fail");
    } catch (error) {
      expect(error).toMatchObject({
        code: "SELF_UPDATE_FAILED",
        exitCode: EXIT_CODES.transport,
        message: expect.stringContaining("npm could not replace the package"),
      });
    }
  });
});
