import { describe, expect, it, vi } from "vitest";
import { diagnose, formatDiagnosticOutput } from "../src/diagnostics";

const config = {
  accountId: "a".repeat(32),
  hyperdriveId: "b".repeat(32),
  token: "SECRET",
};
const start = new Date("2026-09-30T00:00:00Z");
const end = new Date("2026-09-30T00:15:00Z");
function responses({
  invocations = [],
  records = [],
  usage = [],
  waiting = 0,
  peakWaiting = waiting,
  poolSize = waiting > 0 ? 12 : 2,
  queryErrors = 0,
}: {
  invocations?: unknown[];
  records?: unknown[];
  usage?: unknown[];
  waiting?: number;
  peakWaiting?: number;
  poolSize?: number;
  queryErrors?: number;
} = {}) {
  return [
    { result: { events: { events: invocations } } },
    { result: { events: { events: records } } },
    { result: { events: { events: usage } } },
    {
      data: {
        viewer: {
          accounts: [
            {
              hyperdrivePoolSizesAdaptiveGroups: [
                {
                  avg: {
                    waitingClients: waiting,
                    currentPoolSize: poolSize,
                    availablePoolSlots: 12 - poolSize,
                  },
                  max: {
                    waitingClients: peakWaiting,
                    currentPoolSize: poolSize,
                    maxPoolSize: 12,
                  },
                  dimensions: { coloCode: "DUB" },
                },
              ],
              hyperdriveQueriesAdaptiveGroups: [{ count: queryErrors }],
            },
          ],
        },
      },
    },
  ];
}
function sender(results: unknown[]) {
  const send = vi.fn<typeof fetch>();
  for (const body of results) send.mockResolvedValueOnce(Response.json(body));
  return send;
}

describe("production diagnostics", () => {
  it("queries the same time window and production scope with the dedicated token", async () => {
    const send = sender(responses());
    const result = await diagnose(config, start, end, send);
    expect(result.unhealthy).toBe(false);
    expect(result.truncated).toBe(false);
    const requests = send.mock.calls.map(([url, init]) => ({
      url,
      body: JSON.parse(init?.body as string),
      headers: init?.headers,
    }));
    expect(requests[0]?.url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/workers/observability/telemetry/query`,
    );
    expect(requests[0]?.headers).toMatchObject({
      Authorization: "Bearer SECRET",
    });
    expect(requests[0]?.body).toMatchObject({
      timeframe: { from: start.getTime(), to: end.getTime() },
      parameters: {
        filters: [
          {
            key: "$metadata.service",
            value: "work-graph-api",
            operation: "eq",
            type: "string",
          },
          {
            key: "$workers.event.response.status",
            value: 500,
            operation: "gte",
            type: "number",
          },
          {
            key: "$workers.event.response.status",
            value: 600,
            operation: "lt",
            type: "number",
          },
        ],
      },
    });
    expect(requests[2]?.body).toMatchObject({
      queryId: "work-graph-production-route-usage",
      parameters: {
        filters: expect.arrayContaining([
          {
            key: "event",
            value: "request_usage",
            operation: "eq",
            type: "string",
          },
        ]),
      },
    });
    expect(requests[3]?.body.variables).toEqual({
      accountTag: config.accountId,
      configId: config.hyperdriveId,
      start: start.toISOString(),
      end: end.toISOString(),
    });
  });

  it.each([false, true])(
    "projects sanitized fields from logs, string source %s",
    async (stringSource) => {
      const source = {
        requestId: "request-safe",
        route: "/api/work-items/:workItemId",
        outcome: "error",
        status: 503,
        workerVersion: "v1",
        exceptionClass: "database_capacity",
        error: "postgresql://SECRET",
        headers: { Authorization: "SECRET" },
      };
      const send = sender(
        responses({
          invocations: [{ source: { url: "SECRET" } }],
          records: [
            {
              source: stringSource ? JSON.stringify(source) : source,
              timestamp: 123,
              $workers: { requestId: "native-safe" },
            },
          ],
        }),
      );
      const result = await diagnose(config, start, end, send);
      expect(result.unhealthy).toBe(true);
      expect(result.http5xxInvocations).toBe(1);
      expect(result.errors[0]).toMatchObject({
        requestId: "request-safe",
        invocationId: "native-safe",
        timestamp: 123,
      });
      expect(JSON.stringify(result)).not.toContain("SECRET");
    },
  );

  it.each([
    { invocations: [{}] },
    { waiting: 1 },
    { queryErrors: 1 },
    { records: [{ source: { exceptionClass: "database_capacity" } }] },
  ])("detects each failure signal %j", async (input) => {
    expect(
      (await diagnose(config, start, end, sender(responses(input)))).unhealthy,
    ).toBe(true);
  });

  it("reports event truncation", async () => {
    expect(
      (
        await diagnose(
          config,
          start,
          end,
          sender(
            responses({
              invocations: Array.from({ length: 2000 }, () => ({})),
            }),
          ),
        )
      ).truncated,
    ).toBe(true);
  });

  it("aggregates route usage by estimated database transfer", async () => {
    const usage = [
      {
        timestamp: 200,
        source: {
          method: "GET",
          route: "/api/work-items",
          databaseQueryCount: 3,
          databaseResultRowCount: 10,
          databaseResultBytesEstimated: 1_000,
          responseBytes: 700,
          durationMs: 25,
        },
      },
      {
        timestamp: 100,
        source: JSON.stringify({
          method: "GET",
          route: "/api/work-items",
          databaseQueryCount: 2,
          databaseResultRowCount: 5,
          databaseResultBytesEstimated: 500,
          responseBytes: 350,
          durationMs: 15,
        }),
      },
      {
        timestamp: 300,
        source: {
          method: "GET",
          route: "/api/critical-path",
          databaseQueryCount: 6,
          databaseResultRowCount: 12,
          databaseResultBytesEstimated: 2_000,
          responseBytes: 900,
          durationMs: 40,
        },
      },
    ];

    const result = await diagnose(
      config,
      start,
      end,
      sender(responses({ usage })),
    );

    expect(result.usageByRoute).toEqual([
      {
        method: "GET",
        route: "/api/critical-path",
        requests: 1,
        databaseQueries: 6,
        databaseResultRows: 12,
        databaseResultBytesEstimated: 2_000,
        responseBytes: 900,
        durationMs: 40,
        firstObservedAt: 300,
        lastObservedAt: 300,
      },
      {
        method: "GET",
        route: "/api/work-items",
        requests: 2,
        databaseQueries: 5,
        databaseResultRows: 15,
        databaseResultBytesEstimated: 1_500,
        responseBytes: 1_050,
        durationMs: 40,
        firstObservedAt: 100,
        lastObservedAt: 200,
      },
    ]);
  });

  it("rejects malformed usage events instead of reporting misleading totals", async () => {
    await expect(
      diagnose(
        config,
        start,
        end,
        sender(
          responses({
            usage: [
              {
                source: {
                  method: "GET",
                  route: "/api/work-items",
                  databaseQueryCount: "many",
                },
              },
            ],
          }),
        ),
      ),
    ).rejects.toThrow("Unexpected Work Graph usage event");
  });

  it.each([new Error("SECRET"), new DOMException("SECRET", "TimeoutError")])(
    "redacts network errors",
    async (failure) => {
      const send = vi.fn<typeof fetch>().mockRejectedValue(failure);
      await expect(diagnose(config, start, end, send)).rejects.toThrow(
        "Cloudflare diagnostic query could not connect",
      );
    },
  );

  it("redacts HTTP and API error bodies", async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("SECRET", { status: 403 }));
    await expect(diagnose(config, start, end, send)).rejects.toThrow(
      "HTTP 403",
    );
    for (const body of [
      { success: false },
      { errors: [{ message: "SECRET" }] },
    ]) {
      await expect(
        diagnose(config, start, end, sender([body])),
      ).rejects.toThrow("check permissions and schema");
    }
  });

  it("rejects schema drift instead of treating it as healthy", async () => {
    await expect(
      diagnose(
        config,
        start,
        end,
        sender([{ result: { events: { events: {} } } }]),
      ),
    ).rejects.toThrow("Unexpected Cloudflare events");
    const emptyAccounts = responses();
    emptyAccounts[3] = { data: { viewer: { accounts: [] } } };
    await expect(
      diagnose(config, start, end, sender(emptyAccounts)),
    ).rejects.toThrow("Expected one account");
  });

  it.each([
    { ...config, token: "" },
    { ...config, accountId: "bad" },
    { ...config, hyperdriveId: "bad" },
  ])("rejects missing credentials or invalid IDs", async (input) => {
    await expect(diagnose(input, start, end)).rejects.toThrow(
      "Dedicated token and valid",
    );
  });

  it.each([
    [end, start],
    [new Date("invalid"), end],
    [start, new Date("2026-10-08T00:00:00Z")],
  ])("rejects invalid time windows", async (from, to) => {
    await expect(diagnose(config, from, to)).rejects.toThrow("positive window");
  });
});

describe("diagnostic terminal output", () => {
  it("escapes remote line separators and terminal controls while retaining valid JSON", () => {
    const remote = {
      requestId: "safe\r\nforged\u2028line\u2029line\u001b[31m",
    };
    const formatted = formatDiagnosticOutput(remote);
    for (const separator of ["\r", "\n", "\u2028", "\u2029", "\u001b"]) {
      expect(formatted).not.toContain(separator);
    }
    expect(JSON.parse(formatted)).toEqual(remote);
  });
});

describe("pool-capacity alert threshold", () => {
  it.each([
    { waiting: 0.0006, peakWaiting: 1, poolSize: 2 },
    { waiting: 1, peakWaiting: 1, poolSize: 2 },
    { waiting: 0.1, peakWaiting: 1, poolSize: 12 },
  ])(
    "keeps brief or non-capacity waiting as diagnostic context %j",
    async (input) => {
      expect(
        (await diagnose(config, start, end, sender(responses(input))))
          .unhealthy,
      ).toBe(false);
    },
  );
});
