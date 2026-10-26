import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.js";
import {
  executeSecretBootstrap,
  parseSecretBootstrapPlan,
  planSecretBootstrap,
  runBootstrapCommand,
  secretBootstrapPlanDigest,
  secretBootstrapPlanSchema,
  type BootstrapCommand,
  type SecretBootstrapPlan,
  type SecretBootstrapState,
} from "../src/secret-bootstrap.js";

function plan(overrides: Record<string, unknown> = {}): SecretBootstrapPlan {
  return secretBootstrapPlanSchema.parse({
    schema_version: 1,
    project_id: "sample-service",
    provider_origins: {
      doppler: "https://api.doppler.com",
      github: "https://api.github.com",
      cloudflare: "https://api.cloudflare.com",
    },
    identities: {
      doppler: {
        token_env: "DOPPLER_BOOTSTRAP_TOKEN",
        project: "sample-service",
        configs: ["prd"],
      },
      github: {
        token_env: "GH_BOOTSTRAP_TOKEN",
        repository: "example/sample-service",
        environments: ["production-sample-service"],
      },
      cloudflare: {
        token_env: "CLOUDFLARE_BOOTSTRAP_TOKEN",
        account_id_env: "CLOUDFLARE_ACCOUNT_ID",
        workers: ["sample-service"],
      },
    },
    checkpoints: [
      {
        id: "create-cloudflare-token",
        provider: "cloudflare",
        instructions: "Create a Worker Scripts Edit token scoped to sample-service.",
      },
    ],
    secrets: [
      {
        id: "cloudflare-api-token",
        name: "CLOUDFLARE_API_TOKEN",
        sensitive: true,
        system_of_record: {
          kind: "doppler",
          config: "prd",
          name: "CLOUDFLARE_API_TOKEN",
        },
        consumers: [
          {
            kind: "github-environment",
            environment: "production-sample-service",
            name: "CLOUDFLARE_API_TOKEN",
          },
          {
            kind: "cloudflare-worker",
            worker: "sample-service",
            name: "UPSTREAM_TOKEN",
          },
        ],
        rotation_owner: "platform-operations",
        creation: {
          mode: "manual",
          value_env: "NEW_CLOUDFLARE_API_TOKEN",
          checkpoint: "create-cloudflare-token",
        },
      },
    ],
    ...overrides,
  });
}

function environment() {
  return {
    DOPPLER_BOOTSTRAP_TOKEN: "doppler-credential",
    GH_BOOTSTRAP_TOKEN: "github-credential",
    CLOUDFLARE_BOOTSTRAP_TOKEN: "cloudflare-credential",
    CLOUDFLARE_ACCOUNT_ID: "account-id",
    NEW_CLOUDFLARE_API_TOKEN: "secret-value",
  };
}

describe("secret bootstrap contract", () => {
  it("parses a versioned plan and emits only redacted operational detail", () => {
    const parsed = parseSecretBootstrapPlan(stringify(plan()));
    const result = planSecretBootstrap({ plan: parsed });

    expect(result.checkpoints).toEqual([
      expect.objectContaining({
        id: "create-cloudflare-token",
        status: "waiting",
      }),
    ]);
    expect(result.secrets).toEqual([
      {
        id: "cloudflare-api-token",
        name: "CLOUDFLARE_API_TOKEN",
        sensitive: true,
        systemOfRecord:
          "doppler:sample-service/prd/CLOUDFLARE_API_TOKEN",
        consumers: [
          "github:production-sample-service/CLOUDFLARE_API_TOKEN",
          "cloudflare-worker:sample-service/UPSTREAM_TOKEN",
        ],
        rotationOwner: "platform-operations",
        creation: "manual",
        status: "waiting",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("secret-value");
  });

  it.each([
    [
      { provider_origins: { doppler: "https://api.doppler.com/v3", github: "https://api.github.com" } },
      /must be an origin/,
    ],
    [
      {
        secrets: [
          {
            ...plan().secrets[0],
            system_of_record: { kind: "doppler", config: "other", name: "TOKEN" },
          },
        ],
      },
      /allowed by the Doppler identity/,
    ],
    [
      {
        secrets: [
          {
            ...plan().secrets[0],
            consumers: [
              { kind: "github-environment", environment: "other", name: "TOKEN" },
            ],
          },
        ],
      },
      /allowed by the GitHub identity/,
    ],
    [
      {
        secrets: [
          {
            ...plan().secrets[0],
            consumers: [
              { kind: "cloudflare-worker", worker: "other", name: "TOKEN" },
            ],
          },
        ],
      },
      /allowed by the Cloudflare identity/,
    ],
    [
      {
        secrets: [
          {
            ...plan().secrets[0],
            creation: {
              mode: "manual",
              value_env: "TOKEN",
              checkpoint: "missing",
            },
          },
        ],
      },
      /declared manual checkpoint/,
    ],
  ])("rejects an unsafe or out-of-scope contract", (replacement, expected) => {
    expect(() => plan(replacement)).toThrow(expected);
  });

  it("rejects duplicate scopes and identifiers", () => {
    expect(() =>
      plan({
        identities: {
          ...plan().identities,
          doppler: {
            ...plan().identities.doppler,
            configs: ["prd", "prd"],
          },
        },
      }),
    ).toThrow(/duplicate Doppler configs/);
    expect(() =>
      plan({ checkpoints: [plan().checkpoints[0], plan().checkpoints[0]] }),
    ).toThrow(/duplicate checkpoint ids/);
    expect(() =>
      plan({ secrets: [plan().secrets[0], plan().secrets[0]] }),
    ).toThrow(/duplicate secret ids/);
    const original = plan().secrets[0];
    expect(() =>
      plan({
        secrets: [
          original,
          {
            ...original,
            id: "duplicate-destination",
          },
        ],
      }),
    ).toThrow(/duplicate Doppler secret destinations/);
    expect(() =>
      plan({
        secrets: [
          {
            ...original,
            consumers: [original?.consumers[0], original?.consumers[0]],
          },
        ],
      }),
    ).toThrow(/duplicate consumers/);
  });

  it("refuses every non-canonical credential origin before executing a provider", async () => {
    const unsafe = {
      ...plan(),
      provider_origins: {
        ...plan().provider_origins,
        cloudflare: "https://credentials.example.invalid",
      },
    };
    const runCommand = vi.fn();
    const fetchCredential = vi.fn();

    expect(() => planSecretBootstrap({ plan: unsafe })).toThrow(
      /unapproved origin/,
    );
    await expect(
      executeSecretBootstrap({
        plan: unsafe,
        acknowledge: ["create-cloudflare-token"],
        environment: environment(),
        persist: vi.fn(),
        runCommand,
        fetch: fetchCredential,
      }),
    ).rejects.toThrow(/unapproved origin/);
    expect(runCommand).not.toHaveBeenCalled();
    expect(fetchCredential).not.toHaveBeenCalled();
  });
});

describe("resumable secret bootstrap execution", () => {
  it("persists a safe waiting state without reading or sending a manual value", async () => {
    const persisted: SecretBootstrapState[] = [];
    const runCommand = vi.fn();
    const result = await executeSecretBootstrap({
      plan: plan(),
      environment: {},
      persist: async (state) => {
        persisted.push(state);
      },
      runCommand,
      fetch: vi.fn(),
    });

    expect(result.plan.secrets[0]?.status).toBe("waiting");
    expect(result.state.completed_secrets).toEqual([]);
    expect(persisted).toHaveLength(1);
    expect(JSON.stringify(persisted)).not.toContain("secret-value");
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("distributes a manual value through scoped adapters and records only completion ids", async () => {
    const commands: BootstrapCommand[] = [];
    const persisted: SecretBootstrapState[] = [];
    const requests: { url: URL; init: RequestInit }[] = [];
    const fetchCredential = async (url: URL, init: RequestInit) => {
      requests.push({ url, init });
      return { ok: true, status: 200 };
    };
    const result = await executeSecretBootstrap({
      plan: plan(),
      acknowledge: ["create-cloudflare-token"],
      environment: environment(),
      persist: async (state) => {
        persisted.push(state);
      },
      runCommand: async (command) => {
        commands.push(command);
      },
      fetch: fetchCredential,
    });

    expect(commands.map(({ command }) => command)).toEqual(["doppler", "gh"]);
    expect(commands[0]).toMatchObject({
      args: expect.arrayContaining([
        "--project",
        "sample-service",
        "--config",
        "prd",
        "--api-host",
        "https://api.doppler.com",
      ]),
      stdin: "secret-value",
      environment: { DOPPLER_TOKEN: "doppler-credential" },
    });
    expect(commands[1]).toMatchObject({
      args: expect.arrayContaining([
        "--env",
        "production-sample-service",
        "--repo",
        "github.com/example/sample-service",
      ]),
      stdin: "secret-value",
      environment: {
        GH_TOKEN: "github-credential",
        GH_HOST: "github.com",
      },
    });
    expect(commands.flatMap(({ args }) => args)).not.toContain("secret-value");
    const request = requests[0];
    expect(request?.url.origin).toBe("https://api.cloudflare.com");
    expect(request?.url.pathname).toContain(
      "/accounts/account-id/workers/scripts/sample-service/secrets",
    );
    expect(request?.init.headers).toMatchObject({
      Authorization: "Bearer cloudflare-credential",
    });
    expect(JSON.parse(String(request?.init.body))).toEqual({
      name: "UPSTREAM_TOKEN",
      text: "secret-value",
      type: "secret_text",
    });
    expect(result.plan.secrets[0]?.status).toBe("complete");
    expect(result.state).toMatchObject({
      acknowledged_checkpoints: ["create-cloudflare-token"],
      completed_secrets: ["cloudflare-api-token"],
    });
    expect(JSON.stringify(persisted)).not.toContain("secret-value");
  });

  it("skips completed secrets and rejects stale state", async () => {
    const currentPlan = plan();
    const state: SecretBootstrapState = {
      schema_version: 1,
      project_id: currentPlan.project_id,
      plan_digest: secretBootstrapPlanDigest(currentPlan),
      acknowledged_checkpoints: ["create-cloudflare-token"],
      completed_secrets: ["cloudflare-api-token"],
    };
    const runCommand = vi.fn();
    const result = await executeSecretBootstrap({
      plan: currentPlan,
      state,
      environment: {},
      persist: vi.fn(),
      runCommand,
      fetch: vi.fn(),
    });
    expect(result.plan.secrets[0]?.status).toBe("complete");
    expect(runCommand).not.toHaveBeenCalled();

    expect(() =>
      planSecretBootstrap({
        plan: currentPlan,
        state: { ...state, project_id: "other" },
      }),
    ).toThrow(/not 'sample-service'/);
    expect(() =>
      planSecretBootstrap({
        plan: currentPlan,
        state: { ...state, plan_digest: "0".repeat(64) },
      }),
    ).toThrow(/plan changed/);
    expect(() =>
      planSecretBootstrap({
        plan: currentPlan,
        state: {
          ...state,
          acknowledged_checkpoints: ["create-cloudflare-token", "forged"],
        },
      }),
    ).toThrow(/unknown or duplicate completion id/);
    expect(() =>
      planSecretBootstrap({ plan: currentPlan, acknowledge: ["unknown"] }),
    ).toThrow(/Unknown bootstrap checkpoint/);
  });

  it("supports generated values and optional source extensions without changing the contract", async () => {
    const base = plan();
    const sourcePlan = plan({
      checkpoints: [],
      secrets: [
        {
          ...base.secrets[0],
          id: "generated-secret",
          consumers: [base.secrets[0]?.consumers[0]],
          creation: { mode: "generated", bytes: 24 },
        },
        {
          ...base.secrets[0],
          id: "extension-secret",
          name: "EXTENSION_TOKEN",
          system_of_record: {
            kind: "doppler",
            config: "prd",
            name: "EXTENSION_TOKEN",
          },
          consumers: [
            {
              kind: "github-environment",
              environment: "production-sample-service",
              name: "EXTENSION_TOKEN",
            },
          ],
          creation: {
            mode: "extension",
            extension: "cloudflare-token-provisioner",
          },
        },
      ],
    });
    const commands: BootstrapCommand[] = [];
    const extension = vi.fn(async () => "extension-value");
    const result = await executeSecretBootstrap({
      plan: sourcePlan,
      environment: environment(),
      persist: vi.fn(),
      runCommand: async (command) => {
        commands.push(command);
      },
      extensions: { "cloudflare-token-provisioner": extension },
    });

    expect(commands).toHaveLength(4);
    expect(commands[0]?.stdin).toHaveLength(32);
    expect(commands[2]?.stdin).toBe("extension-value");
    expect(extension).toHaveBeenCalledOnce();
    expect(result.state.completed_secrets).toEqual([
      "extension-secret",
      "generated-secret",
    ]);

    await expect(
      executeSecretBootstrap({
        plan: sourcePlan,
        state: {
          ...result.state,
          completed_secrets: ["generated-secret"],
        },
        environment: environment(),
        persist: vi.fn(),
        runCommand: vi.fn(),
      }),
    ).rejects.toThrow(/unavailable source extension/);
  });

  it("does not mark a secret complete after a partial provider failure", async () => {
    const persisted: SecretBootstrapState[] = [];
    let call = 0;
    await expect(
      executeSecretBootstrap({
        plan: plan(),
        acknowledge: ["create-cloudflare-token"],
        environment: environment(),
        persist: async (state) => {
          persisted.push(state);
        },
        runCommand: async () => {
          call += 1;
          if (call === 2) throw new Error("provider failed");
        },
        fetch: vi.fn(),
      }),
    ).rejects.toThrow("provider failed");
    expect(persisted.at(-1)?.completed_secrets).toEqual([]);
  });
});

describe("provider command boundary", () => {
  it("passes stdin without exposing it in output and reports only a safe failure", async () => {
    await expect(
      runBootstrapCommand({
        command: process.execPath,
        args: [
          "-e",
          "const fs = require('node:fs'); const directory = process.env.TMPDIR; if (!directory || (fs.statSync(directory).mode & 0o077) !== 0) process.exit(9); process.stdin.resume(); process.stdin.on('end', () => process.exit(0));",
        ],
        stdin: "sensitive",
        environment: { PATH: process.env.PATH ?? "" },
      }),
    ).resolves.toBeUndefined();
    await expect(
      runBootstrapCommand({
        command: process.execPath,
        args: ["-e", "process.exit(7)"],
        stdin: "sensitive",
        environment: { PATH: process.env.PATH ?? "" },
      }),
    ).rejects.toThrow(/exit code 7/);
    await expect(
      runBootstrapCommand({
        command: "/missing/bootstrap-command",
        args: [],
        stdin: "sensitive",
        environment: { PATH: process.env.PATH ?? "" },
      }),
    ).rejects.toThrow("Failed to start");
  });
});

describe("secret bootstrap CLI", () => {
  it("writes a private value-free resume file and plans without changing it", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "secret-bootstrap-cli-"));
    const waitingPlan = plan();
    const planPath = path.join(root, "plan.yaml");
    await writeFile(planPath, stringify(waitingPlan), "utf8");
    const stdout: string[] = [];
    const stderr: string[] = [];
    try {
      expect(
        await runCli(["secret-bootstrap-apply", planPath], {
          workingDirectory: root,
          stdout: (text) => stdout.push(text),
          stderr: (text) => stderr.push(text),
        }),
      ).toBe(0);
      const statePath = path.join(
        root,
        ".project-bootstrap/sample-service.json",
      );
      const source = await readFile(statePath, "utf8");
      expect(JSON.parse(source)).toMatchObject({
        project_id: "sample-service",
        acknowledged_checkpoints: [],
        completed_secrets: [],
      });
      expect(source).not.toContain("secret-value");
      expect((await stat(statePath)).mode & 0o777).toBe(0o600);
      const before = source;

      expect(
        await runCli(["secret-bootstrap-plan", planPath], {
          workingDirectory: root,
          stdout: (text) => stdout.push(text),
          stderr: (text) => stderr.push(text),
        }),
      ).toBe(0);
      expect(await readFile(statePath, "utf8")).toBe(before);
      expect(stderr).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
