import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { parseAllDocuments } from "yaml";

interface KubernetesResource {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace?: string;
  };
  [key: string]: unknown;
}

interface FluxSchemaReport {
  report: {
    summary: {
      total: number;
      valid: number;
      invalid: number;
      skipped: number;
    };
    results: Array<{
      status: string;
      reason?: string;
      violations?: Array<{ message: string; path: string }>;
    }>;
  };
}

const homelabDirectory = fileURLToPath(new URL("..", import.meta.url));
const overlays = {
  home: "k3s/overlays/home",
  remote: "k3s/overlays/remote-development",
} as const;
const renderedOverlays = new Map<string, string>();

function run(
  command: string,
  args: readonly string[],
  input?: string,
  environment?: NodeJS.ProcessEnv,
): { stdout: string; stderr: string } {
  const result = spawnSync(command, args, {
    cwd: homelabDirectory,
    encoding: "utf8",
    env: environment,
    input,
    timeout: 30_000,
  });

  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed\n${result.error?.message || result.stderr || result.stdout}`,
  );
  return { stdout: result.stdout, stderr: result.stderr };
}

test("the t3 bootstrap defaults every Codex home to Sol with high reasoning", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "t3-bootstrap-"));
  const testHome = join(temporaryDirectory, "home");
  const t3Home = join(testHome, ".t3");
  const codexHome = join(testHome, ".codex");
  const settingsPath = join(t3Home, "userdata/settings.json");
  const configPath = join(codexHome, "config.toml");
  const catalogPath = join(codexHome, "model-catalog.json");

  try {
    mkdirSync(join(t3Home, "userdata"), { recursive: true });
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(
      settingsPath,
      `${JSON.stringify({
        providerInstances: {
          "codex-personal": {
            accentColor: "#123456",
            config: { launchArgs: "--legacy" },
          },
        },
      })}\n`,
    );
    writeFileSync(
      configPath,
      '"model" = "gpt-6-astra"\n\'model_reasoning_effort\' = \'medium\'\n"custom-key" = "keep"\npersonality = "pragmatic"\n\n[features]\njs_repl = false\n',
    );
    writeFileSync(
      join(codexHome, "models_cache.json"),
      `${JSON.stringify({
        client_version: "test",
        models: [
          {
            slug: "gpt-6-astra",
            default_reasoning_level: "medium",
            priority: 0,
          },
          {
            slug: "gpt-5.6-sol",
            default_reasoning_level: "low",
            priority: 4,
          },
        ],
      })}\n`,
    );

    const environment = {
      ...process.env,
      HOME: testHome,
      T3CODE_HOME: t3Home,
    };
    const scriptPath = fileURLToPath(
      new URL("../images/t3-code/bootstrap-settings.mjs", import.meta.url),
    );
    run(process.execPath, [scriptPath], undefined, environment);
    const firstConfig = readFileSync(configPath, "utf8");
    const firstSettings = readFileSync(settingsPath, "utf8");
    const firstCatalog = readFileSync(catalogPath, "utf8");
    run(process.execPath, [scriptPath], undefined, environment);

    assert.equal(readFileSync(configPath, "utf8"), firstConfig);
    assert.equal(readFileSync(settingsPath, "utf8"), firstSettings);
    assert.equal(readFileSync(catalogPath, "utf8"), firstCatalog);
    assert.match(firstConfig, /^model = "gpt-5\.6-sol"$/m);
    assert.match(firstConfig, /^model_reasoning_effort = "high"$/m);
    assert.match(
      firstConfig,
      new RegExp(`^model_catalog_json = ${JSON.stringify(catalogPath)}$`, "m"),
    );
    assert.match(firstConfig, /^personality = "pragmatic"$/m);
    assert.match(firstConfig, /^"custom-key" = "keep"$/m);
    assert.doesNotMatch(firstConfig, /^"model"\s*=/m);
    assert.doesNotMatch(firstConfig, /^'model_reasoning_effort'\s*=/m);
    assert.match(firstConfig, /^\[features\]$/m);

    const settings = JSON.parse(firstSettings) as Record<string, unknown>;
    assert.deepEqual(settings.defaultModelSelection, {
      instanceId: "codex",
      model: "gpt-5.6-sol",
      options: [
        { id: "reasoningEffort", value: "high" },
        { id: "serviceTier", value: "default" },
      ],
    });
    const instances = settings.providerInstances as Record<
      string,
      Record<string, unknown>
    >;
    assert.ok(!("codex-personal" in instances));
    assert.equal(instances.codex2?.accentColor, "#123456");
    const codex2Config = instances.codex2?.config as Record<string, unknown>;
    assert.equal(codex2Config.homePath, codexHome);
    assert.equal(
      codex2Config.shadowHomePath,
      join(testHome, ".codex-personal"),
    );

    const catalog = JSON.parse(firstCatalog) as {
      models: Array<Record<string, unknown>>;
    };
    const sol = catalog.models.find(({ slug }) => slug === "gpt-5.6-sol");
    const astra = catalog.models.find(({ slug }) => slug === "gpt-6-astra");
    assert.equal(sol?.default_reasoning_level, "high");
    assert.equal(sol?.priority, 0);
    assert.equal(astra?.priority, 1);
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

function renderOverlay(overlay: string): string {
  const cached = renderedOverlays.get(overlay);
  if (cached !== undefined) {
    return cached;
  }

  const rendered = run("kubectl", ["kustomize", overlay]).stdout;
  renderedOverlays.set(overlay, rendered);
  return rendered;
}

function parseResources(overlay: string): KubernetesResource[] {
  return parseAllDocuments(renderOverlay(overlay)).map((document) => {
    assert.deepEqual(document.errors, [], `invalid YAML in ${overlay}`);
    const resource = document.toJS() as KubernetesResource;
    assert.equal(typeof resource.apiVersion, "string");
    assert.equal(typeof resource.kind, "string");
    assert.equal(typeof resource.metadata?.name, "string");
    return resource;
  });
}

function resource(
  resources: KubernetesResource[],
  kind: string,
  name: string,
  namespace?: string,
): KubernetesResource {
  const matches = resources.filter(
    (candidate) =>
      candidate.kind === kind &&
      candidate.metadata.name === name &&
      candidate.metadata.namespace === namespace,
  );
  assert.equal(
    matches.length,
    1,
    `expected one ${kind} ${namespace ? `${namespace}/` : ""}${name}, found ${matches.length}`,
  );
  return matches[0]!;
}

function valueAt(value: unknown, path: readonly (string | number)[]): unknown {
  let current = value;

  for (const segment of path) {
    if (typeof segment === "number") {
      assert.ok(Array.isArray(current), `expected an array before index ${segment}`);
      assert.ok(segment in current, `missing array index ${segment}`);
      current = current[segment];
      continue;
    }

    assert.ok(
      typeof current === "object" && current !== null && segment in current,
      `missing field ${path.join(".")}`,
    );
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function servicePort(
  service: KubernetesResource,
  name: string,
): Record<string, unknown> {
  const ports = valueAt(service, ["spec", "ports"]);
  assert.ok(Array.isArray(ports));
  const matches = ports.filter(
    (port): port is Record<string, unknown> =>
      typeof port === "object" && port !== null && port.name === name,
  );
  assert.equal(matches.length, 1, `expected one service port named ${name}`);
  return matches[0]!;
}

function kindCounts(resources: KubernetesResource[]): Record<string, number> {
  return Object.fromEntries(
    [...new Set(resources.map(({ kind }) => kind))]
      .sort()
      .map((kind) => [
        kind,
        resources.filter((resource) => resource.kind === kind).length,
      ]),
  );
}

const fluxSchemaArguments = [
  "validate",
  "--config",
  ".fluxschema.yml",
  "--output",
  "json",
] as const;

test("every rendered overlay passes the pinned Kubernetes and Doppler schemas", () => {
  for (const overlay of Object.values(overlays)) {
    const resources = parseResources(overlay);
    const result = run(
      "flux-schema",
      fluxSchemaArguments,
      renderOverlay(overlay),
    );
    const report = JSON.parse(result.stdout) as FluxSchemaReport;
    assert.deepEqual(report.report.summary, {
      total: resources.length,
      valid: resources.length,
      invalid: 0,
      skipped: 0,
    });
  }
});

test("Flux Schema evaluates the DopplerSecret CEL authentication rule", () => {
  const invalidDopplerSecret = `
apiVersion: secrets.doppler.com/v1alpha1
kind: DopplerSecret
metadata:
  name: invalid-authentication
spec:
  identity: 00000000-0000-0000-0000-000000000000
  tokenSecret:
    name: doppler-token
  managedSecret:
    name: t3-code-runtime
`;
  const result = spawnSync("flux-schema", fluxSchemaArguments, {
    cwd: homelabDirectory,
    encoding: "utf8",
    input: invalidDopplerSecret,
    timeout: 30_000,
  });

  assert.equal(result.status, 1, result.error?.message || result.stderr);
  const report = JSON.parse(result.stdout) as FluxSchemaReport;
  assert.deepEqual(report.report.summary, {
    total: 1,
    valid: 0,
    invalid: 1,
    skipped: 0,
  });
  assert.equal(report.report.results[0]?.reason, "cel-violation");
  assert.deepEqual(report.report.results[0]?.violations, [
    {
      path: "/spec",
      message:
        "Invalid value: Must specify either tokenSecret or identity, but not both",
    },
  ]);
});

test("the Doppler validation catalog matches the installed operator version", () => {
  const installer = readFileSync(
    new URL("../scripts/install-doppler-operator", import.meta.url),
    "utf8",
  );
  const validationConfig = readFileSync(
    new URL("../.fluxschema.yml", import.meta.url),
    "utf8",
  );
  const installedVersion = installer.match(
    /kubernetes-operator\/releases\/download\/(v\d+\.\d+\.\d+)\//,
  );
  const schemaVersion = validationConfig.match(
    /k3s\/schemas\/doppler-operator-(v\d+\.\d+\.\d+)/,
  );

  assert.ok(installedVersion, "the Doppler Operator URL must pin a version");
  assert.ok(schemaVersion, "the Doppler schema catalog must pin a version");
  assert.equal(schemaVersion[1], installedVersion[1]);
});

test("the remote overlay isolates durable data from rebuildable caches", () => {
  const resources = parseResources(overlays.remote);

  assert.deepEqual(kindCounts(resources), {
    Deployment: 1,
    DopplerSecret: 3,
    Namespace: 1,
    PersistentVolume: 2,
    PersistentVolumeClaim: 2,
    Service: 1,
    ServiceAccount: 1,
  });

  const identities = resources.map(
    ({ apiVersion, kind, metadata }) =>
      `${apiVersion}:${kind}:${metadata.namespace ?? "cluster"}:${metadata.name}`,
  );
  assert.equal(
    new Set(identities).size,
    identities.length,
    "rendered resources must have unique identities",
  );

  const operatorService = resource(resources, "Service", "t3-code", "t3-code");
  assert.deepEqual(servicePort(operatorService, "http"), {
    name: "http",
    nodePort: 30773,
    port: 3773,
    protocol: "TCP",
    targetPort: "http",
  });
  for (let offset = 0; offset < 5; offset += 1) {
    assert.deepEqual(servicePort(operatorService, `qa-${3000 + offset}`), {
      name: `qa-${3000 + offset}`,
      nodePort: 31000 + offset,
      port: 3000 + offset,
      protocol: "TCP",
      targetPort: 3000 + offset,
    });
  }
  const operatorVolume = resource(
    resources,
    "PersistentVolume",
    "t3-code-remote-development",
  );
  const cacheVolume = resource(
    resources,
    "PersistentVolume",
    "t3-code-remote-development-cache",
  );
  assert.equal(
    valueAt(operatorVolume, ["spec", "local", "path"]),
    "/srv/remote-development/t3-code",
  );
  assert.equal(valueAt(operatorVolume, ["spec", "capacity", "storage"]), "90Gi");
  assert.equal(
    valueAt(cacheVolume, ["spec", "local", "path"]),
    "/srv/remote-development/t3-code-cache",
  );
  assert.equal(valueAt(cacheVolume, ["spec", "capacity", "storage"]), "30Gi");
  for (const volume of [operatorVolume, cacheVolume]) {
    assert.deepEqual(
      valueAt(volume, [
        "spec",
        "nodeAffinity",
        "required",
        "nodeSelectorTerms",
        0,
        "matchExpressions",
      ]),
      [
        {
          key: "homelab.dev/location",
          operator: "In",
          values: ["cloud"],
        },
        {
          key: "homelab.dev/capability",
          operator: "In",
          values: ["agent-workspace"],
        },
        {
          key: "kubernetes.io/hostname",
          operator: "In",
          values: ["remote-development"],
        },
      ],
    );
  }

  const operatorClaim = resource(
    resources,
    "PersistentVolumeClaim",
    "t3-code-data",
    "t3-code",
  );
  const cacheClaim = resource(
    resources,
    "PersistentVolumeClaim",
    "t3-code-cache",
    "t3-code",
  );
  assert.equal(
    valueAt(operatorClaim, ["spec", "volumeName"]),
    "t3-code-remote-development",
  );
  assert.equal(
    valueAt(operatorClaim, ["spec", "resources", "requests", "storage"]),
    "90Gi",
  );
  assert.equal(
    valueAt(cacheClaim, ["spec", "volumeName"]),
    "t3-code-remote-development-cache",
  );
  assert.equal(
    valueAt(cacheClaim, ["spec", "resources", "requests", "storage"]),
    "30Gi",
  );

  const operatorDeployment = resource(
    resources,
    "Deployment",
    "t3-code",
    "t3-code",
  );
  const operatorNamespace = resource(resources, "Namespace", "t3-code");
  assert.equal(
    valueAt(operatorNamespace, [
      "metadata",
      "labels",
      "pod-security.kubernetes.io/enforce",
    ]),
    "privileged",
  );
  assert.equal(
    valueAt(operatorNamespace, [
      "metadata",
      "labels",
      "pod-security.kubernetes.io/audit",
    ]),
    "restricted",
  );
  assert.equal(
    valueAt(operatorNamespace, [
      "metadata",
      "labels",
      "pod-security.kubernetes.io/warn",
    ]),
    "restricted",
  );
  assert.equal(
    valueAt(operatorDeployment, [
      "spec",
      "template",
      "spec",
      "initContainers",
      0,
      "image",
    ]),
    valueAt(operatorDeployment, [
      "spec",
      "template",
      "spec",
      "containers",
      0,
      "image",
    ]),
    "operator init and main images must match",
  );
  assert.deepEqual(
    valueAt(operatorDeployment, [
      "spec",
      "template",
      "spec",
      "containers",
      0,
      "resources",
    ]),
    {
      limits: { cpu: "3", "ephemeral-storage": "12Gi", memory: "6Gi" },
      requests: { cpu: "500m", "ephemeral-storage": "1Gi", memory: "1Gi" },
    },
  );
  assert.deepEqual(
    valueAt(operatorDeployment, [
      "spec",
      "template",
      "spec",
      "containers",
      0,
      "env",
      0,
    ]),
    { name: "DOCKER_HOST", value: "tcp://127.0.0.1:2375" },
  );
  assert.deepEqual(
    valueAt(operatorDeployment, [
      "spec",
      "template",
      "spec",
      "containers",
      0,
      "envFrom",
    ]),
    [{ secretRef: { name: "t3-code-runtime", optional: true } }],
  );
  const operatorEnvironment = valueAt(operatorDeployment, [
    "spec",
    "template",
    "spec",
    "containers",
    0,
    "env",
  ]);
  assert.ok(Array.isArray(operatorEnvironment));
  for (const name of [
    "CF_ACCESS_CLIENT_ID",
    "CF_ACCESS_CLIENT_SECRET",
    "CLOUDFLARE_PAGES_HOST",
  ]) {
    assert.deepEqual(
      operatorEnvironment.find(
        (entry) =>
          typeof entry === "object" && entry !== null && entry.name === name,
      ),
      {
        name,
        valueFrom: {
          secretKeyRef: {
            key: name,
            name: "t3-code-preview-access",
            optional: false,
          },
        },
      },
    );
  }
  for (const name of [
    "WORK_GRAPH_API_URL",
    "WORK_GRAPH_CF_ACCESS_ALLOWED_ORIGINS",
    "WORK_GRAPH_CF_ACCESS_CLIENT_ID",
    "WORK_GRAPH_CF_ACCESS_CLIENT_SECRET",
  ]) {
    assert.deepEqual(
      operatorEnvironment.find(
        (entry) =>
          typeof entry === "object" && entry !== null && entry.name === name,
      ),
      {
        name,
        valueFrom: {
          secretKeyRef: {
            key: name,
            name: "t3-code-work-graph",
            optional: false,
          },
        },
      },
    );
  }
  assert.ok(
    String(
      valueAt(operatorDeployment, [
        "spec",
        "template",
        "spec",
        "initContainers",
        0,
        "command",
        3,
      ]),
    ).includes("/data/home/.t3/worktrees"),
  );

  const initContainers = valueAt(operatorDeployment, [
    "spec",
    "template",
    "spec",
    "initContainers",
  ]);
  assert.ok(Array.isArray(initContainers));
  const dockerDataInit = initContainers.find(
    (container) =>
      typeof container === "object" &&
      container !== null &&
      container.name === "prepare-docker-data",
  );
  assert.deepEqual(dockerDataInit, {
    command: [
      "/bin/sh",
      "-eu",
      "-c",
      "chown 1000:1000 /home/rootless/.local/share/docker",
    ],
    image:
      "docker:29.8.0-dind-rootless@sha256:e17fa54c2ffd511d8407c746eec77f7814e6f74fe20caf822dad1870599984c0",
    name: "prepare-docker-data",
    resources: {
      limits: { cpu: "100m", memory: "64Mi" },
      requests: { cpu: "10m", memory: "16Mi" },
    },
    securityContext: {
      allowPrivilegeEscalation: false,
      capabilities: { add: ["CHOWN"], drop: ["ALL"] },
      readOnlyRootFilesystem: true,
      runAsGroup: 0,
      runAsNonRoot: false,
      runAsUser: 0,
      seccompProfile: { type: "RuntimeDefault" },
    },
    volumeMounts: [
      {
        mountPath: "/home/rootless/.local/share/docker",
        name: "docker-data",
      },
    ],
  });

  const dockerSidecar = valueAt(operatorDeployment, [
    "spec",
    "template",
    "spec",
    "containers",
    1,
  ]);
  assert.deepEqual(dockerSidecar, {
    args: ["dockerd", "--host=tcp://0.0.0.0:2375", "--tls=false"],
    env: [
      {
        name: "DOCKERD_ROOTLESS_ROOTLESSKIT_FLAGS",
        value: "-p 127.0.0.1:2375:2375/tcp",
      },
    ],
    image:
      "docker:29.8.0-dind-rootless@sha256:e17fa54c2ffd511d8407c746eec77f7814e6f74fe20caf822dad1870599984c0",
    name: "docker",
    startupProbe: {
      exec: {
        command: [
          "docker",
          "--host=tcp://127.0.0.1:2375",
          "info",
        ],
      },
      failureThreshold: 30,
      periodSeconds: 2,
      timeoutSeconds: 2,
    },
    readinessProbe: {
      exec: {
        command: [
          "docker",
          "--host=tcp://127.0.0.1:2375",
          "info",
        ],
      },
      initialDelaySeconds: 2,
      periodSeconds: 5,
      timeoutSeconds: 3,
    },
    livenessProbe: {
      exec: {
        command: [
          "docker",
          "--host=tcp://127.0.0.1:2375",
          "info",
        ],
      },
      failureThreshold: 3,
      periodSeconds: 20,
      timeoutSeconds: 5,
    },
    resources: {
      limits: { cpu: "1", "ephemeral-storage": "16Gi", memory: "1Gi" },
      requests: { cpu: "100m", "ephemeral-storage": "2Gi", memory: "256Mi" },
    },
    securityContext: {
      privileged: true,
      readOnlyRootFilesystem: false,
      runAsGroup: 1000,
      runAsNonRoot: true,
      runAsUser: 1000,
      seccompProfile: { type: "Unconfined" },
    },
    volumeMounts: [
      {
        mountPath: "/home/rootless/.local/share/docker",
        name: "docker-data",
      },
    ],
  });
  const operatorVolumes = valueAt(operatorDeployment, [
    "spec",
    "template",
    "spec",
    "volumes",
  ]);
  assert.ok(Array.isArray(operatorVolumes));
  const dockerDataVolume = operatorVolumes.find(
    (candidate: unknown) =>
      typeof candidate === "object" &&
      candidate !== null &&
      (candidate as Record<string, unknown>).name === "docker-data",
  );
  assert.deepEqual(
    dockerDataVolume,
    { emptyDir: { sizeLimit: "10Gi" }, name: "docker-data" },
  );
  const operatorTmpVolume = operatorVolumes.find(
    (candidate: unknown) =>
      typeof candidate === "object" &&
      candidate !== null &&
      (candidate as Record<string, unknown>).name === "tmp",
  );
  assert.deepEqual(
    operatorTmpVolume,
    { emptyDir: { sizeLimit: "8Gi" }, name: "tmp" },
  );
  const operatorCacheVolume = operatorVolumes.find(
    (candidate: unknown) =>
      typeof candidate === "object" &&
      candidate !== null &&
      (candidate as Record<string, unknown>).name === "cache",
  );
  assert.deepEqual(operatorCacheVolume, {
    name: "cache",
    persistentVolumeClaim: { claimName: "t3-code-cache" },
  });
  const previewAccessSecret = resource(
    resources,
    "DopplerSecret",
    "t3-code-preview-access",
    "t3-code",
  );
  assert.equal(
    valueAt(previewAccessSecret, ["spec", "project"]),
    "personal-site",
  );
  assert.equal(valueAt(previewAccessSecret, ["spec", "config"]), "dev_agent");
  assert.equal(
    valueAt(previewAccessSecret, ["spec", "tokenSecret", "name"]),
    "doppler-agent-token",
  );
  assert.equal(
    valueAt(previewAccessSecret, ["spec", "managedSecret", "name"]),
    "t3-code-preview-access",
  );

  const workGraphSecret = resource(
    resources,
    "DopplerSecret",
    "t3-code-work-graph",
    "t3-code",
  );
  assert.equal(valueAt(workGraphSecret, ["spec", "project"]), "work-graph");
  assert.equal(
    valueAt(workGraphSecret, ["spec", "config"]),
    "prd_work_graph",
  );
  assert.equal(
    valueAt(workGraphSecret, ["spec", "tokenSecret", "name"]),
    "doppler-work-graph-token",
  );
  assert.deepEqual(valueAt(workGraphSecret, ["spec", "secrets"]), [
    "WORK_GRAPH_API_URL",
    "WORK_GRAPH_CF_ACCESS_ALLOWED_ORIGINS",
    "CF_ACCESS_CLIENT_ID",
    "CF_ACCESS_CLIENT_SECRET",
  ]);
  assert.deepEqual(valueAt(workGraphSecret, ["spec", "processors"]), {
    CF_ACCESS_CLIENT_ID: {
      asName: "WORK_GRAPH_CF_ACCESS_CLIENT_ID",
      type: "plain",
    },
    CF_ACCESS_CLIENT_SECRET: {
      asName: "WORK_GRAPH_CF_ACCESS_CLIENT_SECRET",
      type: "plain",
    },
  });
});

test("the default remote overlay contains only the operator workspace", () => {
  const resources = parseResources(overlays.remote);

  assert.deepEqual(kindCounts(resources), {
    Deployment: 1,
    DopplerSecret: 3,
    Namespace: 1,
    PersistentVolume: 2,
    PersistentVolumeClaim: 2,
    Service: 1,
    ServiceAccount: 1,
  });
  assert.ok(
    resources.every(({ metadata }) => metadata.namespace !== "t3-code-pilot"),
  );
  assert.ok(
    resources.every(({ metadata }) => !metadata.name.includes("pilot")),
  );
});

test("the NixOS host publishes, prepares, and limits workspace storage", () => {
  const hostDefinition = readFileSync(
    new URL("../hosts/remote-development/default.nix", import.meta.url),
    "utf8",
  );

  assert.ok(
    hostDefinition.includes(
      "tailscale serve --bg --https=443 http://127.0.0.1:30773",
    ),
  );
  assert.ok(hostDefinition.includes("tailscale serve reset"));
  assert.ok(!hostDefinition.includes("--https=8443"));
  for (let offset = 0; offset < 5; offset += 1) {
    assert.ok(
      hostDefinition.includes(
        `tailscale serve --bg --https=${3000 + offset} http://127.0.0.1:${31000 + offset}`,
      ),
    );
  }
  assert.ok(
    hostDefinition.includes(
      "install -d -m 2770 -o t3code -g t3code ${operatorDataPath}",
    ),
  );
  assert.ok(
    hostDefinition.includes(
      "install -d -m 2770 -o t3code -g t3code ${cacheDataPath}",
    ),
  );
  assert.ok(!hostDefinition.includes("pilotDataPath"));
  assert.ok(hostDefinition.includes('"prjquota"'));
  assert.ok(hostDefinition.includes('operatorProjectId = "2000"'));
  assert.ok(hostDefinition.includes('cacheProjectId = "2002"'));
  assert.ok(hostDefinition.includes('operatorBlockHardLimit = "55G"'));
  assert.ok(hostDefinition.includes('cacheBlockHardLimit = "30G"'));
  assert.ok(hostDefinition.includes('operatorInodeHardLimit = "3000000"'));
  assert.ok(hostDefinition.includes('cacheInodeHardLimit = "2000000"'));
  assert.ok(hostDefinition.includes('containerLogMaxFiles = 3'));
  assert.ok(hostDefinition.includes('containerLogMaxSize = "20Mi"'));
  assert.ok(hostDefinition.includes("zramSwap = {"));
  assert.ok(hostDefinition.includes("memoryPercent = 25"));
  assert.ok(hostDefinition.includes('memorySwap.swapBehavior = "NoSwap"'));
  assert.ok(hostDefinition.includes('projectQuotaLayoutVersion = "2"'));
  assert.ok(hostDefinition.includes("chattr +P ${operatorDataPath}"));
  assert.ok(hostDefinition.includes("chattr +P ${cacheDataPath}"));
  assert.ok(
    hostDefinition.includes('"remote-development-project-quotas.service"'),
  );
  assert.ok(
    hostDefinition.includes(
      "systemd.services.remote-development-k3s-state-migration",
    ),
  );
  assert.ok(hostDefinition.includes('legacy=${dataMount}/k3s'));
  assert.ok(hostDefinition.includes('test -s "$legacy/server/db/state.db"'));
  assert.ok(hostDefinition.includes("trap cleanup_staging EXIT"));
  assert.ok(hostDefinition.includes('sync -f "$staging"'));
  assert.ok(hostDefinition.includes('mv -- "$staging" "$target"'));
  assert.ok(hostDefinition.includes('test -s "$target/server/db/state.db"'));

  const volumePreparation = readFileSync(
    new URL("../scripts/prepare-remote-development-volume", import.meta.url),
    "utf8",
  );
  assert.ok(volumePreparation.includes("-O project,quota"));
  assert.ok(volumePreparation.includes("-E quotatype=prjquota"));

  const healthCheck = readFileSync(
    new URL("../scripts/remote-development-health", import.meta.url),
    "utf8",
  );
  assert.ok(healthCheck.includes("check_project_quota t3-code-operator"));
  assert.ok(!healthCheck.includes("check_project_quota t3-code-pilot"));
  assert.ok(healthCheck.includes("check_project_quota t3-code-cache"));
  assert.ok(healthCheck.includes("test ! -e /srv/remote-development/t3-code-pilot"));
  assert.ok(healthCheck.includes('any(.type == "DiskPressure"'));
  assert.ok(healthCheck.includes("check_disk_headroom /srv/remote-development"));
  assert.ok(healthCheck.includes('keys | sort == ["3000", "3001"'));
  assert.ok(healthCheck.includes('$1 == "/dev/zram0"'));
  assert.ok(healthCheck.includes("for _ in $(seq 1 60)"));
  assert.ok(healthCheck.includes(".lastState.terminated.reason"));
  assert.ok(healthCheck.includes(".lastState.terminated.exitCode"));
  assert.ok(
    healthCheck.includes("no pods match app.kubernetes.io/name=t3-code"),
  );
  assert.ok(
    healthCheck.indexOf('runtime_summary=$(') <
      healthCheck.indexOf('return "${rollout_status}"'),
    "restart diagnostics must be collected before a failed rollout is returned",
  );
  assert.ok(healthCheck.includes(".CF_ACCESS_CLIENT_ID"));
  assert.ok(healthCheck.includes(".CF_ACCESS_CLIENT_SECRET"));
  assert.ok(healthCheck.includes(".data as $data"));
  assert.ok(healthCheck.includes('($data[$key] // "")'));
  assert.ok(healthCheck.includes('"WORK_GRAPH_CF_ACCESS_CLIENT_ID"'));
  assert.ok(healthCheck.includes('"WORK_GRAPH_CF_ACCESS_CLIENT_SECRET"'));
  assert.ok(healthCheck.includes("@base64d"));

  const dopplerInstaller = readFileSync(
    new URL("../scripts/install-doppler-operator", import.meta.url),
    "utf8",
  );
  assert.ok(
    dopplerInstaller.includes(
      '"t3-code:doppler-agent-token:personal-site:dev_agent"',
    ),
  );
  assert.ok(
    dopplerInstaller.includes(
      '"t3-code:doppler-work-graph-token:work-graph:prd_work_graph"',
    ),
  );
  assert.ok(
    dopplerInstaller.includes(
      'remote-development-k3s-${namespace}-${token_secret}-${doppler_config}',
    ),
  );
  assert.ok(dopplerInstaller.includes("sha256sum -c -"));
  assert.ok(dopplerInstaller.includes("| tr -d '\\r\\n'"));
  assert.ok(dopplerInstaller.includes("--from-file=serviceToken=/dev/stdin"));
  assert.ok(!dopplerInstaller.includes("token_file"));
});
