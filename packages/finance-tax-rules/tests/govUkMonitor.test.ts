import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  buildGovUkSourceRegistry,
  diffGovUkSnapshots,
  govUkContentSnapshotSchema,
  monitorGovUkSources,
  renderGovUkMonitorReport,
  snapshotGovUkContent,
  type GovUkMonitorState,
  type GovUkSourceSpec,
} from "../src/govUkMonitor";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

const source: GovUkSourceSpec = {
  id: "income-tax",
  title: "Income Tax rates",
  pageUrl: "https://www.gov.uk/income-tax-rates",
  contentApiUrl: "https://www.gov.uk/api/content/income-tax-rates",
  ruleIds: ["income-tax-2026-27"],
  effectivePeriods: [{ from: "2026-04-06", to: "2027-04-05" }],
  defaultCheckIntervalHours: 168,
};

function contentItem(
  overrides: {
    body?: string;
    links?: Record<string, unknown>;
    publicUpdatedAt?: string;
    title?: string;
  } = {},
) {
  return {
    base_path: "/income-tax-rates",
    content_id: "5f802f95-4aef-45c2-b9d5-87b4f85f68b0",
    description: "Official rates",
    details: {
      body:
        overrides.body ??
        '<table><tr><td>Basic rate</td><td>20%</td></tr></table><a href="https://assets.publishing.service.gov.uk/rates.pdf">Rates PDF</a>',
    },
    document_type: "guidance",
    first_published_at: "2025-11-01T09:00:00Z",
    links: overrides.links ?? {},
    public_updated_at: overrides.publicUpdatedAt ?? "2026-04-06T00:00:00Z",
    schema_name: "detailed_guide",
    title: overrides.title ?? "Income Tax rates",
    updated_at: "2026-04-06T00:01:00Z",
    withdrawn_notice: {},
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("GOV.UK source registry", () => {
  it("ties every monitored source to supported rules on the trusted API", () => {
    const registry = buildGovUkSourceRegistry();

    expect(registry.length).toBeGreaterThan(0);
    expect(
      registry.every(
        (entry) =>
          entry.ruleIds.length > 0 &&
          entry.contentApiUrl.startsWith("https://www.gov.uk/api/content/"),
      ),
    ).toBe(true);
    expect(
      registry.every(({ id }) =>
        govUkContentSnapshotSchema.safeParse(
          JSON.parse(
            readFileSync(
              resolve(packageRoot, `monitoring/reviewed/${id}.json`),
              "utf8",
            ),
          ),
        ).success,
      ),
    ).toBe(true);
  });
});

describe("GOV.UK source monitoring", () => {
  it("records successful checks, caches unchanged content, and sends no salary data", async () => {
    const reviewed = snapshotGovUkContent(contentItem());
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("GET");
      expect(init?.body).toBeUndefined();
      return jsonResponse(contentItem());
    });
    const first = await monitorGovUkSources([source], {
      checkedAt: "2026-10-03T10:00:00Z",
      fetchImpl,
      reviewedSnapshots: { [source.id]: reviewed },
    });

    expect(first.status).toBe("unchanged");
    expect(renderGovUkMonitorReport(first)).toContain(
      "No reviewed source changed.",
    );
    expect(first.state.lastSuccessfulCheckAt).toBe("2026-10-03T10:00:00Z");
    expect(first.state.sources[source.id]?.lastSuccessfulCheckAt).toBe(
      "2026-10-03T10:00:00Z",
    );
    expect(fetchImpl).toHaveBeenCalledOnce();

    const cachedFetch = vi.fn(() => {
      throw new Error("cache was bypassed");
    });
    const second = await monitorGovUkSources([source], {
      checkedAt: "2026-10-04T10:00:00Z",
      fetchImpl: cachedFetch,
      previousState: first.state,
      reviewedSnapshots: { [source.id]: reviewed },
    });

    expect(second.cachedSourceIds).toEqual([source.id]);
    expect(second.status).toBe("unchanged");
    expect(cachedFetch).not.toHaveBeenCalled();
  });

  it("turns an amended table into a review proposal without activating it", async () => {
    const reviewed = snapshotGovUkContent(contentItem());
    const amended = contentItem({
      body: "<table><tr><td>Basic rate</td><td>21%</td></tr></table>",
      publicUpdatedAt: "2026-10-02T12:00:00Z",
    });
    const report = await monitorGovUkSources([source], {
      checkedAt: "2026-10-03T10:00:00Z",
      fetchImpl: async () => jsonResponse(amended),
      reviewedSnapshots: { [source.id]: reviewed },
    });

    expect(report.status).toBe("changes-detected");
    expect(report.proposals).toHaveLength(1);
    expect(report.proposals[0]).toMatchObject({
      affectedRuleIds: source.ruleIds,
      dates: {
        publicationDate: "2026-10-02",
        detectedDate: "2026-10-03",
        reviewedEffectiveDate: null,
        activationDate: null,
      },
      activationGate: {
        status: "review-and-validation-required",
        validationCommand: "mise run //packages/finance-tax-rules:check",
      },
    });
    expect(
      report.proposals[0]?.changes.some(
        ({ area, path }) => area === "content" && path === "/details/body",
      ),
    ).toBe(true);
    const markdown = renderGovUkMonitorReport(report);
    expect(markdown).toContain("## Income Tax rates");
    expect(markdown).toContain("Effective | _(not set; reviewer required)_");
    expect(markdown).toContain(
      "mise run //packages/finance-tax-rules:check",
    );
  });

  it("reports a document-link replacement separately from the body change", () => {
    const reviewed = snapshotGovUkContent(contentItem());
    const candidate = snapshotGovUkContent(
      contentItem({
        body: '<a href="https://assets.publishing.service.gov.uk/rates-v2.pdf">Rates PDF</a>',
      }),
    );
    const changes = diffGovUkSnapshots(reviewed, candidate);

    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          area: "document-link",
          before: "https://assets.publishing.service.gov.uk/rates.pdf",
          after: null,
        }),
        expect.objectContaining({
          area: "document-link",
          before: null,
          after: "https://assets.publishing.service.gov.uk/rates-v2.pdf",
        }),
      ]),
    );
  });

  it("retries an outage and preserves the last successful check", async () => {
    const reviewed = snapshotGovUkContent(contentItem());
    const previousState: GovUkMonitorState = {
      schemaVersion: 1,
      lastSuccessfulCheckAt: "2026-09-01T10:00:00Z",
      sources: {
        [source.id]: {
          lastSuccessfulCheckAt: "2026-09-01T10:00:00Z",
          snapshot: reviewed,
        },
      },
    };
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "down" }, 503));
    const report = await monitorGovUkSources([source], {
      attempts: 3,
      checkedAt: "2026-10-03T10:00:00Z",
      fetchImpl,
      previousState,
      reviewedSnapshots: { [source.id]: reviewed },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(report.status).toBe("degraded");
    expect(report.failures[0]?.message).toContain("503");
    expect(renderGovUkMonitorReport(report)).toContain("## Source failures");
    expect(report.state.lastSuccessfulCheckAt).toBe("2026-09-01T10:00:00Z");
    expect(report.state.sources[source.id]?.lastSuccessfulCheckAt).toBe(
      "2026-09-01T10:00:00Z",
    );
  });

  it("flags future-dated publications while leaving effective and activation dates for review", async () => {
    const reviewed = snapshotGovUkContent(contentItem());
    const report = await monitorGovUkSources([source], {
      checkedAt: "2026-10-03T10:00:00Z",
      fetchImpl: async () =>
        jsonResponse(
          contentItem({
            publicUpdatedAt: "2027-04-06T00:00:00Z",
            body: "<p>Rates announced for a future tax year.</p>",
          }),
        ),
      reviewedSnapshots: { [source.id]: reviewed },
    });

    expect(report.proposals[0]).toMatchObject({
      timing: "future-announcement",
      dates: {
        publicationDate: "2027-04-06",
        detectedDate: "2026-10-03",
        reviewedEffectiveDate: null,
        activationDate: null,
      },
    });
  });
});
