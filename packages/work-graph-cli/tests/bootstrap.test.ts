import { describe, expect, it } from "vitest";
import {
  DOPPLER_BOOTSTRAP_MARKER,
  DOPPLER_EXECUTABLE_ENV,
  dopplerSpawnExitCode,
  dopplerBootstrapArgs,
  resolveDopplerExecutable,
} from "../src/bootstrap.js";
import { EXIT_CODES } from "../src/errors.js";

describe("Given Work Graph CLI startup", () => {
  it("wraps API commands with the fixed production Doppler config", () => {
    expect(
      dopplerBootstrapArgs(["ready", "--limit", "5"], {}, "/node", "/cli.js"),
    ).toEqual([
      "run",
      "--project",
      "work-graph",
      "--config",
      "prd_work_graph",
      "--",
      "/node",
      "/cli.js",
      "ready",
      "--limit",
      "5",
    ]);
  });

  it.each([
    ["offline help", ["--help"], {}],
    ["offline prime", ["prime"], {}],
    ["offline self-update", ["self-update"], {}],
    [
      "configured environment",
      ["ready"],
      { WORK_GRAPH_API_URL: "https://work.test" },
    ],
    ["explicit API URL", ["--api-url", "http://localhost:8787", "ready"], {}],
    ["recursive child", ["ready"], { [DOPPLER_BOOTSTRAP_MARKER]: "1" }],
  ])("does not bootstrap %s", (_label, args, environment) => {
    expect(
      dopplerBootstrapArgs(args, environment, "/node", "/cli.js"),
    ).toBeUndefined();
  });
});

describe("Given Doppler executable discovery", () => {
  it("uses a configured absolute executable path", () => {
    const exists = (path: string) => path === "/tools/doppler";

    expect(
      resolveDopplerExecutable(
        { [DOPPLER_EXECUTABLE_ENV]: "/tools/doppler" },
        exists,
      ),
    ).toBe("/tools/doppler");
  });

  it("rejects configured relative executable paths", () => {
    expect(
      resolveDopplerExecutable(
        { [DOPPLER_EXECUTABLE_ENV]: "bin/doppler" },
        () => true,
      ),
    ).toBeUndefined();
  });

  it("finds Doppler in a fixed installation directory", () => {
    const exists = (path: string) => path === "/usr/local/bin/doppler";

    expect(resolveDopplerExecutable({}, exists)).toBe(
      "/usr/local/bin/doppler",
    );
  });

  it("reports spawn failures as structured transport errors", () => {
    const stderr: string[] = [];

    expect(
      dopplerSpawnExitCode(
        { error: new Error("permission denied"), status: null },
        (text) => stderr.push(text),
      ),
    ).toBe(EXIT_CODES.transport);
    expect(JSON.parse(stderr[0] ?? "null")).toEqual({
      error: {
        code: "DOPPLER_SPAWN_FAILED",
        message: "Failed to start Doppler: permission denied",
      },
    });
  });

  it("preserves the Doppler process exit status", () => {
    expect(dopplerSpawnExitCode({ status: 42 }, () => undefined)).toBe(42);
  });
});
