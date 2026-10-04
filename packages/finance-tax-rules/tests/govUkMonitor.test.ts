import { describe, expect, it } from "vitest";
import {
  buildGovUkSourceRegistry,
  createRuleUpdateProposal,
  diffGovUkSnapshots,
  snapshotGovUkContent,
  type GovUkSourceSpec,
} from "../src/govUkMonitor";

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

describe("GOV.UK source registry", () => {
  it("ties every trusted source to supported rules", () => {
    const registry = buildGovUkSourceRegistry();

    expect(registry.length).toBeGreaterThan(0);
    expect(
      registry.every(
        (entry) =>
          entry.ruleIds.length > 0 &&
          entry.contentApiUrl.startsWith("https://www.gov.uk/api/content/"),
      ),
    ).toBe(true);
  });
});

describe("GOV.UK source changes", () => {
  it("does not propose an unchanged normalized snapshot", () => {
    const snapshot = snapshotGovUkContent(contentItem());

    expect(
      createRuleUpdateProposal(
        source,
        snapshot,
        snapshot,
        "2026-10-03T10:00:00Z",
      ),
    ).toBeNull();
  });

  it("turns an amended table into a gated review proposal", () => {
    const reviewed = snapshotGovUkContent(contentItem());
    const candidate = snapshotGovUkContent(
      contentItem({
        body: "<table><tr><td>Basic rate</td><td>21%</td></tr></table>",
        publicUpdatedAt: "2026-10-02T12:00:00Z",
      }),
    );
    const proposal = createRuleUpdateProposal(
      source,
      reviewed,
      candidate,
      "2026-10-03T10:00:00Z",
    );

    expect(proposal).toMatchObject({
      kind: "source-change",
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
      proposal?.changes.some(
        ({ area, path }) => area === "content" && path === "/details/body",
      ),
    ).toBe(true);
    expect(JSON.stringify(proposal)).not.toContain("<table>");
  });

  it("reports a document-link replacement separately", () => {
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

  it("keeps nested HTML out of compact PostgreSQL diffs", () => {
    const reviewed = snapshotGovUkContent({
      ...contentItem(),
      details: { rows: ["<strong>Basic rate</strong>", "20%"] },
    });
    const candidate = snapshotGovUkContent({
      ...contentItem(),
      details: { rows: ["<strong>Basic rate</strong>", "21%"] },
    });

    const proposal = createRuleUpdateProposal(
      source,
      reviewed,
      candidate,
      "2026-10-03T10:00:00Z",
    );

    expect(JSON.stringify(proposal)).not.toContain("<strong>");
    expect(JSON.stringify(proposal)).toContain("Basic rate");
  });

  it("creates a review task for the first R2 baseline", () => {
    const candidate = snapshotGovUkContent(contentItem());
    const proposal = createRuleUpdateProposal(
      source,
      null,
      candidate,
      "2026-10-03T10:00:00Z",
    );

    expect(proposal).toMatchObject({
      kind: "initial-baseline",
      baseFingerprint: null,
      candidateFingerprint: candidate.fingerprint,
      changes: [{ path: "/snapshot", before: null }],
    });
  });

  it("flags future-dated publications for review", () => {
    const reviewed = snapshotGovUkContent(contentItem());
    const candidate = snapshotGovUkContent(
      contentItem({
        publicUpdatedAt: "2027-04-06T00:00:00Z",
        body: "<p>Rates announced for a future tax year.</p>",
      }),
    );

    expect(
      createRuleUpdateProposal(
        source,
        reviewed,
        candidate,
        "2026-10-03T10:00:00Z",
      ),
    ).toMatchObject({
      timing: "future-announcement",
      dates: {
        publicationDate: "2027-04-06",
        detectedDate: "2026-10-03",
      },
    });
  });
});
