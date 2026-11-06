import { describe, expect, it, vi } from "vitest";
import {
  operationInvocation,
  recordPlanDigest,
  requestFromEnvironment,
  validateRequest,
} from "./project-stateful-operation.mjs";

const digest = "a".repeat(64);

function request(
  action: string,
  overrides: Record<string, string> = {},
) {
  return {
    action,
    operationsRoot: "infra/example",
    githubEnvironment: "example-production",
    secretConfigReference: "doppler://example/prd_apply",
    subject: "",
    expectedPlanSha256: "",
    ...overrides,
  };
}

describe("project stateful operation workflow driver", () => {
  it.each([
    request("preview-up", { subject: "42" }),
    request("preview-cleanup", { subject: "42" }),
    request("production-plan"),
    request("production-apply", { expectedPlanSha256: digest }),
    request("production-rollback", { subject: "b".repeat(40) }),
    request("backup"),
    request("restore", { subject: "restore-drill-1" }),
    request("alert-smoke"),
  ])("accepts $action inputs", (candidate) => {
    expect(validateRequest(candidate)).toEqual(candidate);
  });

  it.each([
    [request("preview-up"), "pull-request number"],
    [request("production-plan", { subject: "42" }), "does not accept a subject"],
    [request("production-apply"), "SHA-256 plan digest"],
    [request("production-rollback", { subject: "main" }), "full Git revision"],
    [request("restore", { subject: "Restore Drill" }), "restore drill ID"],
    [request("unknown"), "Unsupported stateful operation"],
    [request("backup", { operationsRoot: "../infra/example" }), "normalized repository-relative"],
    [request("backup", { operationsRoot: "/infra/example" }), "normalized repository-relative"],
    [request("backup", { secretConfigReference: "plaintext-secret" }), "redacted doppler"],
  ])("rejects invalid inputs", (candidate, message) => {
    expect(() => validateRequest(candidate)).toThrow(message);
  });

  it("loads required workflow values from the environment", () => {
    expect(
      requestFromEnvironment({
        ACTION: "preview-up",
        OPERATIONS_ROOT: "infra/example",
        OPERATIONS_GITHUB_ENVIRONMENT: "example-preview",
        OPERATIONS_SECRET_CONFIG_REF: "doppler://example/prv_ci",
        SUBJECT: "42",
      }),
    ).toEqual({
      action: "preview-up",
      operationsRoot: "infra/example",
      githubEnvironment: "example-preview",
      secretConfigReference: "doppler://example/prv_ci",
      subject: "42",
      expectedPlanSha256: "",
    });
  });

  it.each([
    ["preview-up", { subject: "42" }, "preview:42"],
    ["preview-cleanup", { subject: "42" }, "preview-cleanup:42"],
    ["production-apply", { expectedPlanSha256: digest }, `production:${digest}`],
    ["production-rollback", { subject: "b".repeat(40) }, `rollback:${"b".repeat(40)}`],
    ["backup", {}, "backup"],
    ["restore", { subject: "restore-1" }, "restore:restore-1"],
    ["alert-smoke", {}, "alert-smoke"],
    ["production-plan", {}, ""],
  ])("builds the $action invocation", (action, overrides, mutationToken) => {
    const invocation = operationInvocation(request(action, overrides));

    expect(invocation.command).toBe("doppler");
    expect(invocation.arguments.slice(0, 5)).toEqual([
      "run",
      "--",
      "bash",
      "infra/example/operations/operate.sh",
      action,
    ]);
    expect(invocation.environment.OPERATIONS_MUTATION_TOKEN).toBe(
      mutationToken,
    );
    if (
      action === "preview-up" ||
      action === "preview-cleanup" ||
      action === "production-rollback" ||
      action === "restore"
    ) {
      expect(invocation.arguments.at(-1)).toBe(request(action, overrides).subject);
    }
  });

  it("records the reviewed plaintext plan digest as a step output", async () => {
    const read = vi.fn().mockResolvedValue(`${digest}  production.tfplan\n`);
    const append = vi.fn().mockResolvedValue(undefined);

    await expect(
      recordPlanDigest(
        request("production-plan"),
        "/tmp/github-output",
        read,
        append,
      ),
    ).resolves.toBe(digest);
    expect(read).toHaveBeenCalledWith(
      "infra/example/operations/evidence/production.tfplan.sha256",
      "utf8",
    );
    expect(append).toHaveBeenCalledWith(
      "/tmp/github-output",
      `plan_sha256=${digest}\n`,
      "utf8",
    );
  });

  it("rejects a malformed saved-plan checksum", async () => {
    await expect(
      recordPlanDigest(
        request("production-plan"),
        "/tmp/github-output",
        vi.fn().mockResolvedValue("not-a-digest  production.tfplan\n"),
        vi.fn(),
      ),
    ).rejects.toThrow("not a SHA-256 digest");
  });
});
