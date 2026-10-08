import { readFileSync } from "node:fs";
import { URL } from "node:url";

/** Account-scoped incident queries, using a dedicated diagnostic token. */
export interface DiagnosticConfig {
  accountId: string;
  hyperdriveId: string;
  token: string;
}

type Event = {
  source: string | Record<string, unknown>;
  timestamp?: number;
  $workers?: { requestId?: string };
};
type Pool = {
  avg: {
    currentPoolSize: number;
    availablePoolSlots: number;
    waitingClients: number;
  };
  max: { currentPoolSize: number; maxPoolSize: number; waitingClients: number };
  dimensions: { coloCode: string };
};

export const poolQuery = readFileSync(
  new URL("../queries/hyperdrive-pools.graphql", import.meta.url),
  "utf8",
);

export async function diagnose(
  config: DiagnosticConfig,
  start: Date,
  end: Date,
  send: typeof fetch = fetch,
) {
  if (
    !config.token ||
    ![config.accountId, config.hyperdriveId].every((id) =>
      /^[0-9a-f]{32}$/.test(id),
    )
  ) {
    throw new Error(
      "Dedicated token and valid account and Hyperdrive IDs are required",
    );
  }
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    start >= end ||
    end.getTime() - start.getTime() > 7 * 86400000
  ) {
    throw new Error("Use a positive window of at most seven days");
  }
  async function post(path: string, body: unknown) {
    let response: Response;
    try {
      response = await send(`https://api.cloudflare.com/client/v4${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new Error("Cloudflare diagnostic query could not connect");
    }
    if (!response.ok)
      throw new Error(
        `Cloudflare diagnostic query returned HTTP ${response.status}`,
      );
    const result = (await response.json()) as Record<string, unknown>;
    if (
      result.success === false ||
      (Array.isArray(result.errors) && result.errors.length > 0)
    ) {
      throw new Error(
        "Cloudflare rejected the diagnostic query; check permissions and schema",
      );
    }
    return result;
  }
  async function logs(statusKey: string): Promise<Event[]> {
    const result = await post(
      `/accounts/${config.accountId}/workers/observability/telemetry/query`,
      {
        queryId: "work-graph-production-errors",
        timeframe: { from: start.getTime(), to: end.getTime() },
        view: "events",
        limit: 2000,
        parameters: {
          filterCombination: "and",
          filters: [
            {
              key: "$metadata.service",
              value: "work-graph-api",
              type: "string",
              operation: "eq",
            },
            { key: statusKey, value: 500, type: "number", operation: "gte" },
            { key: statusKey, value: 600, type: "number", operation: "lt" },
          ],
        },
      },
    );
    const events = (result.result as { events: { events: Event[] } }).events
      .events;
    if (!Array.isArray(events))
      throw new Error("Unexpected Cloudflare events response");
    return events;
  }
  const invocations = await logs("$workers.event.response.status");
  const records = await logs("status");
  const metrics = await post("/graphql", {
    query: poolQuery,
    variables: {
      accountTag: config.accountId,
      configId: config.hyperdriveId,
      start: start.toISOString(),
      end: end.toISOString(),
    },
  });
  const accounts = (
    metrics.data as {
      viewer: {
        accounts: {
          hyperdrivePoolSizesAdaptiveGroups: Pool[];
          hyperdriveQueriesAdaptiveGroups: { count: number }[];
        }[];
      };
    }
  ).viewer.accounts;
  if (accounts.length !== 1 || !accounts[0])
    throw new Error("Expected one account in the Hyperdrive metrics response");
  const pools = accounts[0].hyperdrivePoolSizesAdaptiveGroups;
  const queryRows = accounts[0].hyperdriveQueriesAdaptiveGroups;
  const validCount = (value: number) => Number.isFinite(value) && value >= 0;
  if (
    !Array.isArray(pools) ||
    !Array.isArray(queryRows) ||
    pools.some(
      (row) =>
        ![
          row.max.waitingClients,
          row.max.currentPoolSize,
          row.max.maxPoolSize,
          row.avg.waitingClients,
        ].every(validCount),
    ) ||
    queryRows.some((row) => !validCount(row.count))
  ) {
    throw new Error("Unexpected Hyperdrive metrics response");
  }
  const queryErrors = queryRows.reduce((sum, row) => sum + row.count, 0);
  // Project fixed application fields. Native URLs, headers, stacks, SQL, and
  // historical raw exception messages must not reach terminal or CI output.
  const errors = records.map((event) => {
    const source =
      typeof event.source === "string"
        ? JSON.parse(event.source)
        : event.source;
    const record: Record<string, unknown> = {};
    for (const key of [
      "requestId",
      "route",
      "outcome",
      "status",
      "workerVersion",
      "exceptionClass",
    ]) {
      if (Object.hasOwn(source, key)) record[key] = source[key];
    }
    record.timestamp = event.timestamp;
    record.invocationId = event.$workers?.requestId;
    return record;
  });
  return {
    from: start.toISOString(),
    to: end.toISOString(),
    http5xxInvocations: invocations.length,
    truncated: invocations.length === 2000 || records.length === 2000,
    errors,
    hyperdrivePools: pools,
    hyperdriveQueryErrors: queryErrors,
    unhealthy:
      invocations.length > 0 ||
      records.length > 0 ||
      queryErrors > 0 ||
      pools.some(
        (row) =>
          row.avg.waitingClients >= 1 &&
          row.max.currentPoolSize >= row.max.maxPoolSize,
      ),
  };
}

/** Keep server-provided text on one JSON line in terminal and workflow logs. */
export function formatDiagnosticOutput(result: unknown): string {
  return JSON.stringify(result)
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}
