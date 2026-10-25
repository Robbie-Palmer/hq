import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const resourceBoundsSchema = z.object({
  requests: z.object({ cpu: z.string(), memory: z.string() }),
  limits: z.object({ cpu: z.string(), memory: z.string() }),
});

const httpProbeSchema = z.object({
  http: z.object({ path: z.string(), port: z.string() }),
});

const portableFixtureSchema = z.object({
  schema_version: z.literal(0),
  workload: z.object({
    id: z.string(),
    runtime: z.object({
      kind: z.literal("container"),
      image: z.string(),
      command: z.array(z.string()),
    }),
    ports: z.array(
      z.object({
        name: z.string(),
        container_port: z.number().int().positive(),
        protocol: z.literal("http"),
      }),
    ),
    health: z.object({
      liveness: httpProbeSchema,
      readiness: httpProbeSchema,
    }),
    resources: resourceBoundsSchema,
    configuration: z.record(z.string(), z.unknown()),
    secrets: z.array(
      z.object({
        dependency: z.string(),
        output: z.string(),
        usage: z.string(),
      }),
    ),
    dependencies: z.record(
      z.string(),
      z.object({ kind: z.string(), version: z.string() }),
    ),
    ingress: z.object({ port: z.string(), path: z.string() }),
    telemetry: z.object({
      contract_version: z.number().int().positive(),
      transport: z.string(),
    }),
    migrations: z.object({
      image: z.string(),
      command: z.array(z.string()),
      dependency: z.string(),
    }),
  }),
  deployment_targets: z.array(z.object({ kind: z.string() })),
});

const scoreFixtureSchema = z.object({
  apiVersion: z.literal("score.dev/v1b1"),
  metadata: z.object({ name: z.string() }),
  containers: z.object({
    migrations: z.object({
      image: z.string(),
      before: z.object({
        api: z.object({ ready: z.literal("complete") }),
      }),
    }),
    api: z.object({
      image: z.string(),
      command: z.array(z.string()),
      variables: z.record(z.string(), z.string()),
      resources: resourceBoundsSchema,
      livenessProbe: z.object({
        httpGet: z.object({ path: z.string(), port: z.number() }),
      }),
      readinessProbe: z.object({
        httpGet: z.object({ path: z.string(), port: z.number() }),
      }),
    }),
  }),
  service: z.object({
    ports: z.record(
      z.string(),
      z.object({ port: z.number(), targetPort: z.number() }),
    ),
  }),
  resources: z.object({
    database: z.object({ type: z.literal("postgres") }),
    hostname: z.object({ type: z.literal("dns") }),
    ingress: z.object({ type: z.literal("route") }),
  }),
});

const fixtureRoot = new URL("./fixtures/workload/", import.meta.url);

async function loadFixture(name: string): Promise<unknown> {
  return parse(await readFile(new URL(name, fixtureRoot), "utf8"));
}

describe("portable workload evidence fixture", () => {
  it("retains the representative workload fields selected by ADR 043", async () => {
    const fixture = portableFixtureSchema.parse(
      await loadFixture("portable-workload-v0.yaml"),
    );

    expect(fixture.deployment_targets.map(({ kind }) => kind)).toEqual([
      "docker-compose",
      "kubernetes",
    ]);
    expect(fixture.workload).toMatchObject({
      health: {
        liveness: { http: { path: "/", port: "http" } },
        readiness: { http: { path: "/", port: "http" } },
      },
      ingress: { path: "/", port: "http" },
      telemetry: { contract_version: 1, transport: "otlp-http-protobuf" },
    });
    expect(fixture.workload.dependencies.database).toEqual({
      kind: "postgres",
      version: "17",
    });
  });

  it("keeps the Score projection aligned with the portable scenario", async () => {
    const [portable, score] = await Promise.all([
      loadFixture("portable-workload-v0.yaml").then((value) =>
        portableFixtureSchema.parse(value),
      ),
      loadFixture("score-v1b1.yaml").then((value) =>
        scoreFixtureSchema.parse(value),
      ),
    ]);
    const httpPort = portable.workload.ports[0];

    expect(score.metadata.name).toBe(portable.workload.id);
    expect(score.containers.api.image).toBe(portable.workload.runtime.image);
    expect(score.containers.api.command).toEqual(
      portable.workload.runtime.command,
    );
    expect(score.containers.api.resources).toEqual(portable.workload.resources);
    expect(score.service.ports.http).toEqual({
      port: httpPort?.container_port,
      targetPort: httpPort?.container_port,
    });
    expect(score.containers.migrations.before.api.ready).toBe("complete");
    expect(score.containers.api.variables).toMatchObject({
      APP_ENV: "prototype",
      OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
      OTEL_SERVICE_NAME: portable.workload.id,
    });
  });
});
