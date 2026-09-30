import { describe, expect, it, vi } from "vitest";
import { diagnose } from "../src/diagnostics";

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
  waiting = 0,
  queryErrors = 0,
}: {
  invocations?: unknown[];
  records?: unknown[];
  waiting?: number;
  queryErrors?: number;
} = {}) {
  return [
    { result: { events: { events: invocations } } },
    { result: { events: { events: records } } },
    {
      data: {
        viewer: {
          accounts: [
            {
              hyperdrivePoolSizesAdaptiveGroups: [
                {
                  max: { waitingClients: waiting },
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
    expect(requests[2]?.body.variables).toEqual({
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
    emptyAccounts[2] = { data: { viewer: { accounts: [] } } };
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
