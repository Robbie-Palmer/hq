import assert from "node:assert/strict";
import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
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

test("Serve health accepts the private Netdata route and rejects unexpected routes", () => {
  const healthCheck = readFileSync(
    new URL("../scripts/remote-development-health", import.meta.url),
    "utf8",
  );
  const filter = healthCheck.match(
    /tailscale serve status --json\s*\\\s*\| jq -e '([\s\S]*?)'/,
  )?.[1];
  assert.ok(filter, "the live health check must contain a Serve filter");
  const workspacePorts = ["443", "3000", "3001", "3002", "3003", "3004"];
  const base = {
    TCP: Object.fromEntries(workspacePorts.map((port) => [port, { HTTPS: true }])),
    Web: {},
  };
  const netdata = {
    TCP: { ...base.TCP, "19999": { HTTPS: true } },
    Web: {
      "remote-development.example.ts.net:19999": {
        Handlers: { "/": { Proxy: "http://127.0.0.1:19999" } },
      },
    },
  };
  const cases = [
    { name: "workspace only", config: base, expected: true },
    { name: "private Netdata", config: netdata, expected: true },
    {
      name: "retired pilot",
      config: { ...netdata, TCP: { ...netdata.TCP, "8443": { HTTPS: true } } },
      expected: false,
    },
    {
      name: "missing workspace port",
      config: { ...base, TCP: { ...base.TCP, "3004": undefined } },
      expected: false,
    },
    {
      name: "missing Netdata proxy",
      config: { ...netdata, Web: {} },
      expected: false,
    },
    {
      name: "non-HTTPS Netdata",
      config: { ...netdata, TCP: { ...netdata.TCP, "19999": { HTTPS: false } } },
      expected: false,
    },
    {
      name: "unexpected Netdata proxy",
      config: {
        ...netdata,
        Web: {
          "remote-development.example.ts.net:19999": {
            Handlers: { "/": { Proxy: "http://192.0.2.1:19999" } },
          },
        },
      },
      expected: false,
    },
  ];
  for (const { name, config, expected } of cases) {
    const result: SpawnSyncReturns<string> = spawnSync("jq", ["-e", filter], {
      encoding: "utf8",
      input: JSON.stringify(config),
      timeout: 5000,
    });
    assert.equal(result.error, undefined, name);
    assert.equal(result.status === 0, expected, `${name}: ${result.stderr}`);
  }
});

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

test("the agent coordinator enforces the pilot budget and skips documentation", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "agent-coordinator-"));
  const binDirectory = join(temporaryDirectory, "bin");
  const stateDirectory = join(temporaryDirectory, "state");
  const worktree = join(temporaryDirectory, "worktree");
  const graphPath = join(temporaryDirectory, "graph.json");
  const launchesPath = join(temporaryDirectory, "launches.jsonl");
  const contextRetryPath = join(temporaryDirectory, "context-retried");
  const memoryCurrentPath = join(temporaryDirectory, "memory.current");
  const memoryMaxPath = join(temporaryDirectory, "memory.max");
  const memoryPressurePath = join(temporaryDirectory, "memory.pressure");
  const ioPressurePath = join(temporaryDirectory, "io.pressure");
  const coordinator = fileURLToPath(
    new URL("../scripts/work-graph-agent-coordinator", import.meta.url),
  );
  const tickets = Array.from({ length: 12 }, (_, index) => ({
    id: `ticket-${String(index + 1).padStart(2, "0")}`,
    title: `Ticket ${index + 1}`,
    stage: "ready",
  }));
  const ticketAt = (index: number) => {
    const ticket = tickets[index];
    assert.ok(ticket);
    return ticket;
  };
  ticketAt(1).title = "Publish ideas for sampling bias";

  try {
    mkdirSync(binDirectory, { recursive: true });
    mkdirSync(worktree, { recursive: true });
    writeFileSync(graphPath, `${JSON.stringify({ items: tickets })}\n`);
    writeFileSync(memoryCurrentPath, "80\n");
    writeFileSync(memoryMaxPath, "100\n");
    writeFileSync(memoryPressurePath, "full avg10=0.00 avg60=0.00 avg300=0.00 total=0\n");
    writeFileSync(ioPressurePath, "full avg10=0.00 avg60=0.00 avg300=0.00 total=0\n");
    writeFileSync(
      join(binDirectory, "mise"),
      `#!/usr/bin/env bash
set -euo pipefail
test "$1" = exec
test "$2" = --
tool=$3
shift 3
if [ "$tool" = work-graph ]; then
  command=$1
  shift
  case "$command" in
    queue)
      jq . "$FAKE_GRAPH_FILE"
      ;;
    ready)
      jq '{items: [.items[] | select(.stage == "ready")]}' "$FAKE_GRAPH_FILE"
      ;;
    show)
      jq --arg id "$1" -e '.items[] | select(.id == $id)' "$FAKE_GRAPH_FILE"
      ;;
    context)
      test "$1" = show
      if [ "$2" = ticket-01 ] && [ ! -e "$FAKE_CONTEXT_RETRY_FILE" ]; then
        touch "$FAKE_CONTEXT_RETRY_FILE"
        exit 0
      fi
      jq -n '{items: [{kind: "brief", content: "Do the work."}]}'
      ;;
    *)
      exit 2
      ;;
  esac
elif [ "$tool" = pnpm ]; then
  ticket_id=$(jq -r '.ticket.id' <<<"$T3_WORK_GRAPH_SELECTION")
  printf '%s\\n' "$ticket_id" >>"$FAKE_LAUNCHES_FILE"
  jq -n --arg ticket_id "$ticket_id" '{threadId: ("thread-" + $ticket_id)}'
else
  exit 2
fi
`,
    );
    writeFileSync(
      join(binDirectory, "t3"),
      "#!/usr/bin/env bash\nprintf 'test-access-token\\n'\n",
    );
    writeFileSync(join(binDirectory, "pnpm"), "#!/usr/bin/env bash\nexit 2\n");
    for (const command of ["mise", "t3", "pnpm"]) {
      chmodSync(join(binDirectory, command), 0o755);
    }

    const environment = {
      ...process.env,
      PATH: `${binDirectory}:${process.env.PATH ?? ""}`,
      FAKE_GRAPH_FILE: graphPath,
      FAKE_LAUNCHES_FILE: launchesPath,
      FAKE_CONTEXT_RETRY_FILE: contextRetryPath,
      T3_WORK_GRAPH_BASE_BRANCH: "main",
      T3_WORK_GRAPH_ORIGIN: "http://127.0.0.1:3773",
      WORK_GRAPH_COORDINATOR_MAX_TICKETS: "3",
      WORK_GRAPH_COORDINATOR_MAX_TOTAL_ADMISSIONS: "4",
      WORK_GRAPH_COORDINATOR_MAX_LAUNCHES_PER_CYCLE: "1",
      WORK_GRAPH_COORDINATOR_EXCLUDE_DOCUMENTATION: "true",
      WORK_GRAPH_COORDINATOR_MEMORY_CURRENT_FILE: memoryCurrentPath,
      WORK_GRAPH_COORDINATOR_MEMORY_MAX_FILE: memoryMaxPath,
      WORK_GRAPH_COORDINATOR_MEMORY_PRESSURE_FILE: memoryPressurePath,
      WORK_GRAPH_COORDINATOR_IO_PRESSURE_FILE: ioPressurePath,
      WORK_GRAPH_COORDINATOR_PROJECT_ROOT: "/test/project",
      WORK_GRAPH_COORDINATOR_RELAUNCH_AFTER_SECONDS: "3600",
      WORK_GRAPH_COORDINATOR_RUN_ONCE: "true",
      WORK_GRAPH_COORDINATOR_SKIP_BOOTSTRAP: "true",
      WORK_GRAPH_COORDINATOR_SKIP_PROVIDER_REFRESH: "true",
      WORK_GRAPH_COORDINATOR_STATE_DIRECTORY: stateDirectory,
      WORK_GRAPH_COORDINATOR_WORKTREE: worktree,
    };

    run("bash", [coordinator], undefined, environment);
    const pressuredHealth = JSON.parse(
      readFileSync(join(stateDirectory, "health.json"), "utf8"),
    ) as { admission: { open: boolean; reason: string }; trackedCount: number };
    assert.equal(pressuredHealth.trackedCount, 0);
    assert.equal(pressuredHealth.admission.open, false);
    assert.equal(pressuredHealth.admission.reason, "memory_usage");

    writeFileSync(memoryCurrentPath, "50\n");
    for (let cycle = 0; cycle < 3; cycle += 1) {
      run("bash", [coordinator], undefined, environment);
    }
    const firstState = JSON.parse(
      readFileSync(join(stateDirectory, "state.json"), "utf8"),
    ) as { tickets: Record<string, unknown>; totalAdmissions: number };
    assert.equal(Object.keys(firstState.tickets).length, 3);
    assert.equal(firstState.totalAdmissions, 3);
    assert.equal(firstState.tickets["ticket-02"], undefined);
    assert.equal(
      readFileSync(launchesPath, "utf8").trim().split("\n").length,
      3,
    );
    assert.equal(readFileSync(contextRetryPath, "utf8"), "");

    ticketAt(0).stage = "released";
    ticketAt(2).stage = "needs_attention";
    writeFileSync(graphPath, `${JSON.stringify({ items: tickets })}\n`);
    run("bash", [coordinator], undefined, environment);

    const secondState = JSON.parse(
      readFileSync(join(stateDirectory, "state.json"), "utf8"),
    ) as { tickets: Record<string, { stage: string }> };
    const health = JSON.parse(
      readFileSync(join(stateDirectory, "health.json"), "utf8"),
    ) as {
      admission: { open: boolean };
      excludedDocumentationCount: number;
      maxTotalAdmissions: number;
      maxTickets: number;
      maxLaunchesPerCycle: number;
      needsAttentionCount: number;
      remainingAdmissions: number;
      status: string;
      totalAdmissions: number;
      trackedCount: number;
    };
    assert.equal(Object.keys(secondState.tickets).length, 3);
    assert.equal(secondState.tickets["ticket-01"], undefined);
    assert.equal(secondState.tickets["ticket-03"]?.stage, "needs_attention");
    assert.notEqual(secondState.tickets["ticket-05"], undefined);
    assert.equal(
      readFileSync(launchesPath, "utf8").trim().split("\n").length,
      4,
    );
    assert.equal(health.maxTickets, 3);
    assert.equal(health.maxTotalAdmissions, 4);
    assert.equal(health.maxLaunchesPerCycle, 1);
    assert.equal(health.excludedDocumentationCount, 1);
    assert.equal(health.needsAttentionCount, 1);
    assert.equal(health.trackedCount, 3);
    assert.equal(health.totalAdmissions, 4);
    assert.equal(health.remainingAdmissions, 0);
    assert.equal(health.status, "pilot_exhausted");
    assert.equal(health.admission.open, false);

    ticketAt(3).stage = "released";
    writeFileSync(graphPath, `${JSON.stringify({ items: tickets })}\n`);
    run("bash", [coordinator], undefined, environment);
    const exhaustedState = JSON.parse(
      readFileSync(join(stateDirectory, "state.json"), "utf8"),
    ) as { tickets: Record<string, unknown>; totalAdmissions: number };
    assert.equal(exhaustedState.totalAdmissions, 4);
    assert.equal(Object.keys(exhaustedState.tickets).length, 2);
    assert.equal(exhaustedState.tickets["ticket-06"], undefined);
    assert.equal(
      readFileSync(launchesPath, "utf8").trim().split("\n").length,
      4,
    );

    writeFileSync(
      join(stateDirectory, "state.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        maxTickets: 3,
        createdAt: "2026-10-09T00:00:00Z",
        updatedAt: "2026-10-09T00:00:00Z",
        tickets: {},
      })}\n`,
    );
    run("bash", [coordinator], undefined, environment);
    const migratedState = JSON.parse(
      readFileSync(join(stateDirectory, "state.json"), "utf8"),
    ) as {
      maxTotalAdmissions: number;
      schemaVersion: number;
      tickets: Record<string, unknown>;
      totalAdmissions: number;
    };
    assert.equal(migratedState.schemaVersion, 2);
    assert.equal(migratedState.maxTotalAdmissions, 4);
    assert.equal(migratedState.totalAdmissions, 4);
    assert.equal(Object.keys(migratedState.tickets).length, 0);
    assert.equal(
      readFileSync(launchesPath, "utf8").trim().split("\n").length,
      4,
    );
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

test("the t3 bootstrap defaults every Codex home to Sol with high reasoning", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "t3-bootstrap-"));
  const testHome = join(temporaryDirectory, "home");
  const t3Home = join(testHome, ".t3");
  const codexHome = join(testHome, ".codex");
  const codex2Home = join(testHome, ".codex-personal");
  const codex2MaintenanceLock = join(
    codex2Home,
    ".sqlite-maintenance.lock",
  );
  const settingsPath = join(t3Home, "userdata/settings.json");
  const configPath = join(codexHome, "config.toml");
  const catalogPath = join(codexHome, "model-catalog.json");

  try {
    mkdirSync(join(t3Home, "userdata"), { recursive: true });
    mkdirSync(codexHome, { recursive: true });
    mkdirSync(codex2Home, { recursive: true });
    writeFileSync(codex2MaintenanceLock, "stale shadow lock\n");
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
      '"model" = "gpt-6-astra"\n\'model_reasoning_effort\' = \'medium\'\n"custom-key" = "keep"\npersonality = "pragmatic"\n\n[features]\njs_repl = false\n\n[mcp_servers.recipe-agent]\ncommand = "stale-command"\n\n[mcp_servers.other]\ncommand = "keep-command"\n',
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
      CONFIGURE_RECIPE_AGENT_MCP: "true",
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
    assert.equal(existsSync(codex2MaintenanceLock), false);
    const primaryMaintenanceLock = join(
      codexHome,
      ".sqlite-maintenance.lock",
    );
    writeFileSync(primaryMaintenanceLock, "");
    symlinkSync(primaryMaintenanceLock, codex2MaintenanceLock);
    run(process.execPath, [scriptPath], undefined, environment);

    assert.equal(readFileSync(configPath, "utf8"), firstConfig);
    assert.equal(readFileSync(settingsPath, "utf8"), firstSettings);
    assert.equal(readFileSync(catalogPath, "utf8"), firstCatalog);
    assert.equal(lstatSync(codex2MaintenanceLock).isSymbolicLink(), true);
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
    assert.match(firstConfig, /^\[mcp_servers\.other\]$/m);
    assert.match(firstConfig, /^command = "keep-command"$/m);
    assert.match(firstConfig, /^\[mcp_servers\.recipe-agent\]$/m);
    assert.match(firstConfig, /^command = "\/usr\/local\/bin\/node"$/m);
    assert.match(
      firstConfig,
      /^args = \["\/usr\/local\/lib\/agent-auth-mcp\/src\/cli\.mjs","--storage-dir",".*\/\.codex\/agent-auth\/recipes","--host-name","T3 Code Codex","--url","https:\/\/robbiepalmer\.me"\]$/m,
    );
    assert.match(
      firstConfig,
      /^env_vars = \["AGENT_AUTH_ENCRYPTION_KEY"\]$/m,
    );
    assert.doesNotMatch(firstConfig, /stale-command/);
    assert.equal(
      statSync(join(codexHome, "agent-auth/recipes")).mode & 0o777,
      0o700,
    );

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

test("the observability collector attributes quota, backup, and Kubernetes state to operator", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "remote-observability-"));
  const binaryDirectory = join(temporaryDirectory, "bin");
  const configPath = join(temporaryDirectory, "metrics.env");
  const statusPath = join(temporaryDirectory, "status.json");
  const coordinatorHealthPath = join(
    temporaryDirectory,
    "agent-coordinator-health.json",
  );
  const outputPath = join(temporaryDirectory, "statsd.txt");

  try {
    mkdirSync(binaryDirectory);
    const commands: Record<string, string> = {
      curl: `#!/usr/bin/env bash
cat <<'METRICS'
kube_pod_container_status_last_terminated_reason{namespace="t3-code",reason="OOMKilled"} 1
kube_pod_status_reason{namespace="t3-code",reason="Evicted"} 0
kube_pod_container_status_waiting_reason{namespace="t3-code",reason="CrashLoopBackOff"} 2
METRICS
`,
      df: `#!/usr/bin/env bash
if [ "$1" = --output=pcent ]; then
  printf 'Use%%\\n40%%\\n'
else
  printf 'IUse%%\\n10%%\\n'
fi
`,
      repquota: `#!/usr/bin/env bash
printf '%s\\n' \\
  'Project,BlockStatus,FileStatus,BlockUsed,BlockSoftLimit,BlockHardLimit,BlockGrace,FileUsed,FileSoftLimit,FileHardLimit,FileGrace' \\
  '#2000,--,--,1024,0,57671680,,20,0,3000000,' \\
  '#2002,--,--,2048,0,31457280,,40,0,2000000,'
`,
      systemctl: "#!/usr/bin/env bash\nexit 0\n",
    };
    for (const [name, content] of Object.entries(commands)) {
      const path = join(binaryDirectory, name);
      writeFileSync(path, content);
      chmodSync(path, 0o755);
    }
    writeFileSync(
      configPath,
      [
        "WORKSPACE_ID=operator",
        `DATA_MOUNT=${temporaryDirectory}`,
        "OPERATOR_PROJECT_ID=2000",
        "CACHE_PROJECT_ID=2002",
        `BACKUP_STATUS_FILE=${statusPath}`,
        "BACKUP_MAXIMUM_AGE_SECONDS=129600",
        "KUBE_STATE_METRICS_URL=http://127.0.0.1:18080/api/v1/namespaces/observability/services/http:kube-state-metrics:8080/proxy/metrics",
        "AGENT_COORDINATOR_ENABLED=1",
        `AGENT_COORDINATOR_HEALTH_FILE=${coordinatorHealthPath}`,
        "",
      ].join("\n"),
    );
    writeFileSync(
      statusPath,
      `${JSON.stringify({ lastSuccessUnix: Math.floor(Date.now() / 1000) - 60 })}\n`,
    );
    writeFileSync(
      coordinatorHealthPath,
      `${JSON.stringify({
        status: "draining",
        maxTickets: 3,
        maxTotalAdmissions: 12,
        maxLaunchesPerCycle: 1,
        totalAdmissions: 8,
        remainingAdmissions: 4,
        trackedCount: 7,
        needsAttentionCount: 2,
        admission: { open: true },
        reconciledAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      })}\n`,
    );

    run(
      "bash",
      [
        fileURLToPath(
          new URL(
            "../scripts/remote-development-observability-metrics",
            import.meta.url,
          ),
        ),
      ],
      undefined,
      {
        ...process.env,
        PATH: `${binaryDirectory}:${process.env.PATH}`,
        REMOTE_DEVELOPMENT_OBSERVABILITY_CONFIG: configPath,
        STATSD_OUTPUT_FILE: outputPath,
      },
    );

    const metrics = readFileSync(outputPath, "utf8");
    assert.match(
      metrics,
      /^remote_development\.operator\.durable_bytes_used:1048576\|g$/m,
    );
    assert.match(
      metrics,
      /^remote_development\.operator\.cache_bytes_used:2097152\|g$/m,
    );
    assert.match(
      metrics,
      /^remote_development\.operator\.durable_inodes_used:20\|g$/m,
    );
    assert.match(
      metrics,
      /^remote_development\.operator\.backup_fresh:1\|g$/m,
    );
    assert.match(
      metrics,
      /^remote_development\.operator\.k3s_up:1\|g$/m,
    );
    assert.match(
      metrics,
      /^remote_development\.operator\.agent_coordinator_enabled:1\|g$/m,
    );
    assert.match(
      metrics,
      /^remote_development\.operator\.agent_coordinator_up:1\|g$/m,
    );
    assert.match(
      metrics,
      /^remote_development\.operator\.agent_coordinator_tracked:7\|g$/m,
    );
    assert.match(
      metrics,
      /^remote_development\.operator\.agent_coordinator_needs_attention:2\|g$/m,
    );
    assert.match(
      metrics,
      /^remote_development\.operator\.agent_coordinator_admission_open:1\|g$/m,
    );
    assert.match(
      metrics,
      /^remote_development\.operator\.kube_state_metrics_up:1\|g$/m,
    );
    assert.match(
      metrics,
      /^remote_development\.operator\.oom_killed:1\|g$/m,
    );
    assert.match(
      metrics,
      /^remote_development\.operator\.crash_loop:2\|g$/m,
    );
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

test("the Healthchecks reconciler upserts the declared check and stores its ping URL", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "healthchecks-reconcile-"));
  const binaryDirectory = join(temporaryDirectory, "bin");
  const captureDirectory = join(temporaryDirectory, "capture");

  try {
    mkdirSync(binaryDirectory);
    mkdirSync(captureDirectory);
    const dopplerPath = join(binaryDirectory, "doppler");
    writeFileSync(
      dopplerPath,
      `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = secrets ] && [ "$2" = get ] && [ "$3" = HEALTHCHECKS_API_KEY ]; then
  printf 'test-api-key'
elif [ "$1" = secrets ] && [ "$2" = set ] && [ "$3" = HEALTHCHECKS_PING_URL ]; then
  cat >"$CAPTURE_DIRECTORY/stored-ping-url"
else
  exit 2
fi
`,
    );
    chmodSync(dopplerPath, 0o755);

    const curlPath = join(binaryDirectory, "curl");
    writeFileSync(
      curlPath,
      `#!/usr/bin/env bash
set -euo pipefail
output=
payload=
url=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output)
      output=$2
      shift 2
      ;;
    --data-binary)
      payload=$2
      shift 2
      ;;
    --connect-timeout|--max-time|--header|--request)
      shift 2
      ;;
    --fail|--silent|--show-error)
      shift
      ;;
    http*)
      url=$1
      shift
      ;;
    *)
      exit 2
      ;;
  esac
done
if [[ "$url" == */channels/ ]]; then
  printf '%s' '{"channels":[{"id":"slack-id","name":"remote-development-alerts","kind":"slack"}]}' >"$output"
elif [[ "$url" == */checks/ ]]; then
  cp -- "\${payload#@}" "$CAPTURE_DIRECTORY/check-payload.json"
  printf '%s' '{"slug":"remote-development-host","timeout":60,"grace":120,"methods":"POST","channels":"slack-id","ping_url":"https://hc-ping.com/test-check"}' >"$output"
else
  exit 2
fi
`,
    );
    chmodSync(curlPath, 0o755);

    run(
      "bash",
      [
        fileURLToPath(
          new URL(
            "../scripts/reconcile-remote-development-healthchecks",
            import.meta.url,
          ),
        ),
      ],
      undefined,
      {
        ...process.env,
        CAPTURE_DIRECTORY: captureDirectory,
        PATH: `${binaryDirectory}:${process.env.PATH}`,
      },
    );

    const payload = JSON.parse(
      readFileSync(join(captureDirectory, "check-payload.json"), "utf8"),
    ) as Record<string, unknown>;
    assert.deepEqual(payload, {
      name: "remote-development host",
      slug: "remote-development-host",
      tags: "remote-development host-loss",
      desc: "External reachability check for the remote-development host",
      timeout: 60,
      grace: 120,
      methods: "POST",
      channels: "slack-id",
      unique: ["slug"],
    });
    assert.equal(
      readFileSync(join(captureDirectory, "stored-ping-url"), "utf8"),
      "https://hc-ping.com/test-check",
    );
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
    ClusterRole: 1,
    ClusterRoleBinding: 1,
    Deployment: 2,
    DopplerSecret: 3,
    Namespace: 2,
    NetworkPolicy: 1,
    PersistentVolume: 2,
    PersistentVolumeClaim: 2,
    Service: 2,
    ServiceAccount: 2,
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
      "observability.remote-development/workspace-id",
    ]),
    "operator",
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
  assert.deepEqual(
    valueAt(operatorDeployment, [
      "spec",
      "template",
      "spec",
      "initContainers",
      0,
      "env",
    ]),
    [{ name: "CONFIGURE_RECIPE_AGENT_MCP", value: "true" }],
  );
  assert.deepEqual(
    operatorEnvironment.find(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        entry.name === "AGENT_AUTH_ENCRYPTION_KEY",
    ),
    {
      name: "AGENT_AUTH_ENCRYPTION_KEY",
      valueFrom: {
        secretKeyRef: {
          key: "AGENT_AUTH_ENCRYPTION_KEY",
          name: "t3-code-runtime",
          optional: false,
        },
      },
    },
  );

  const initContainers = valueAt(operatorDeployment, [
    "spec",
    "template",
    "spec",
    "initContainers",
  ]);
  assert.ok(Array.isArray(initContainers));
  const dockerImage = valueAt(operatorDeployment, [
    "spec",
    "template",
    "spec",
    "containers",
    1,
    "image",
  ]);
  if (typeof dockerImage !== "string") {
    throw new TypeError("The Docker sidecar image must be a string");
  }
  assert.match(
    dockerImage,
    /^docker:\d+\.\d+\.\d+-dind-rootless@sha256:[a-f0-9]{64}$/,
  );
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
    image: dockerImage,
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
    image: dockerImage,
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
    ClusterRole: 1,
    ClusterRoleBinding: 1,
    Deployment: 2,
    DopplerSecret: 3,
    Namespace: 2,
    NetworkPolicy: 1,
    PersistentVolume: 2,
    PersistentVolumeClaim: 2,
    Service: 2,
    ServiceAccount: 2,
  });
  assert.ok(
    resources.every(({ metadata }) => metadata.namespace !== "t3-code-pilot"),
  );
  assert.ok(
    resources.every(({ metadata }) => !metadata.name.includes("pilot")),
  );
});

test("the remote overlay runs a pinned and bounded kube-state-metrics exporter", () => {
  const resources = parseResources(overlays.remote);
  const deployment = resource(
    resources,
    "Deployment",
    "kube-state-metrics",
    "observability",
  );
  const containerValue = valueAt(deployment, [
    "spec",
    "template",
    "spec",
    "containers",
    0,
  ]);
  assert.ok(typeof containerValue === "object" && containerValue !== null);
  const container = containerValue as Record<string, unknown>;
  assert.match(
    String(container.image),
    /^registry\.k8s\.io\/kube-state-metrics\/kube-state-metrics:v2\.18\.0@sha256:[a-f0-9]{64}$/,
  );
  assert.deepEqual(container.resources, {
    limits: { cpu: "100m", memory: "128Mi" },
    requests: { cpu: "10m", memory: "32Mi" },
  });
  const args = container.args;
  assert.ok(Array.isArray(args));
  assert.ok(args.includes("--resources=namespaces,nodes,pods"));
  assert.ok(
    args.includes(
      "--metric-labels-allowlist=namespaces=[observability.remote-development/workspace-id]",
    ),
  );
  const metricsPort = (container.ports as Array<Record<string, unknown>>).find(
    ({ name }) => name === "metrics",
  );
  assert.deepEqual(metricsPort, {
    containerPort: 8080,
    name: "metrics",
    protocol: "TCP",
  });
  const clusterRole = resource(resources, "ClusterRole", "kube-state-metrics");
  assert.deepEqual(valueAt(clusterRole, ["rules"]), [
    {
      apiGroups: [""],
      resources: ["namespaces", "nodes", "pods"],
      verbs: ["list", "watch"],
    },
  ]);
  const policy = resource(
    resources,
    "NetworkPolicy",
    "kube-state-metrics",
    "observability",
  );
  assert.deepEqual(valueAt(policy, ["spec", "ingress"]), []);
});

test("the NixOS host publishes, prepares, and limits workspace storage", () => {
  const hostDefinition = readFileSync(
    new URL("../hosts/remote-development/default.nix", import.meta.url),
    "utf8",
  );
  const agentCoordinatorRunner = readFileSync(
    new URL(
      "../scripts/run-work-graph-agent-coordinator",
      import.meta.url,
    ),
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
  assert.match(
    hostDefinition,
    /trustedInterfaces = \[\s*"cni0"\s*"tailscale0"\s*\];/,
  );
  assert.ok(hostDefinition.includes("--request POST"));
  assert.ok(hostDefinition.includes('--data ""'));
  const netdataNotificationConfig = readFileSync(
    new URL(
      "../hosts/remote-development/netdata/health_alarm_notify.conf",
      import.meta.url,
    ),
    "utf8",
  );
  assert.ok(netdataNotificationConfig.includes("#homelab-alerts"));
  assert.ok(!netdataNotificationConfig.includes("robbie"));
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
  assert.ok(
    hostDefinition.includes(
      "systemd.services.remote-development-kubernetes-api-proxy",
    ),
  );
  assert.ok(
    hostDefinition.includes(
      "systemd.services.remote-development-agent-coordinator",
    ),
  );
  assert.ok(
    hostDefinition.includes(
      `ExecStart = "\${agentCoordinatorRunner}/bin/run-work-graph-agent-coordinator"`,
    ),
  );
  assert.ok(!hostDefinition.includes("pod_record=$("));
  assert.ok(agentCoordinatorRunner.includes("pod_record=$("));
  assert.ok(agentCoordinatorRunner.includes("k3s kubectl --namespace t3-code exec"));
  assert.match(
    hostDefinition,
    /systemd\.services\.remote-development-data-layout = \{[\s\S]*?wantedBy = \[ "multi-user\.target" \];[\s\S]*?systemd\.services\.remote-development-agent-coordinator = \{[\s\S]*?wantedBy = lib\.optionals agentCoordinatorEnabled \[ "multi-user\.target" \];/,
  );
  assert.ok(
    hostDefinition.includes('WORK_GRAPH_COORDINATOR_MAX_TICKETS = "3"'),
  );
  assert.ok(hostDefinition.includes("agentCoordinatorEnabled = false"));
  assert.ok(
    hostDefinition.includes(
      'WORK_GRAPH_COORDINATOR_MAX_TOTAL_ADMISSIONS = "12"',
    ),
  );
  assert.ok(
    hostDefinition.includes(
      'WORK_GRAPH_COORDINATOR_EXCLUDE_DOCUMENTATION = "true"',
    ),
  );
  assert.ok(
    hostDefinition.includes(
      'WORK_GRAPH_COORDINATOR_MAX_LAUNCHES_PER_CYCLE = "1"',
    ),
  );
  assert.ok(
    hostDefinition.includes(
      'WORK_GRAPH_COORDINATOR_MEMORY_LIMIT_PERCENT = "70"',
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
  assert.ok(healthCheck.includes('if .TCP | has("19999") then'));
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
  assert.ok(
    healthCheck.includes(".data.AGENT_AUTH_ENCRYPTION_KEY"),
    "remote health must verify the Agent Auth encryption key",
  );
  assert.ok(
    healthCheck.includes("codex mcp get recipe-agent"),
    "remote health must verify the recipe-agent MCP registration",
  );
  assert.ok(healthCheck.includes(".CF_ACCESS_CLIENT_ID"));
  assert.ok(healthCheck.includes(".CF_ACCESS_CLIENT_SECRET"));
  assert.ok(healthCheck.includes(".data as $data"));
  assert.ok(healthCheck.includes('($data[$key] // "")'));
  assert.ok(healthCheck.includes('"WORK_GRAPH_CF_ACCESS_CLIENT_ID"'));
  assert.ok(healthCheck.includes('"WORK_GRAPH_CF_ACCESS_CLIENT_SECRET"'));
  assert.ok(healthCheck.includes("@base64d"));
  assert.ok(healthCheck.includes("deployment/kube-state-metrics"));
  assert.ok(healthCheck.includes("remote_development.operator_quota_bytes"));
  assert.ok(
    healthCheck.includes("remote-development-healthcheck-heartbeat.service"),
  );

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
