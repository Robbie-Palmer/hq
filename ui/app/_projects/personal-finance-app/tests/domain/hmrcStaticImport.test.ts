import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AcceptHmrcImportInputSchema,
  applyAcceptHmrcImport,
  type HmrcEmploymentObservation,
  readHmrcImportFile,
  reconcileHmrcDraftRow,
  reviewHmrcImport,
} from "@/app/_projects/personal-finance-app/domain/hmrcStaticImport";
import type { SalaryHistoryRecord } from "@/app/_projects/personal-finance-app/domain/salaryHistory";

const FIXTURE_ROOT = join(
  process.cwd(),
  "app/_projects/personal-finance-app/tests/fixtures",
);
const IMPORTED_AT = "2026-10-31T10:00:00.000Z";
const ACCEPTED_AT = "2026-10-31T10:01:00.000Z";

async function fixture(name: string): Promise<File> {
  return new File([await readFile(join(FIXTURE_ROOT, name))], name, {
    type: "application/json",
  });
}

describe("HMRC static import", () => {
  it("joins the official synthetic income and tax examples by PAYE reference", async () => {
    const income = await readHmrcImportFile(
      await fixture("hmrc-individual-income-full.json"),
      "income",
      IMPORTED_AT,
    );
    const tax = await readHmrcImportFile(
      await fixture("hmrc-individual-tax-full.json"),
      "tax",
      IMPORTED_AT,
    );

    const review = reviewHmrcImport({
      memberId: "alex",
      taxYear: "2024-25",
      income,
      tax,
    });

    expect(review.diagnostics).toEqual([]);
    expect(review.rows).toHaveLength(2);
    expect(review.rows[0]).toMatchObject({
      memberId: "alex",
      taxYear: "2024-25",
      payeReference: "123/AB456",
      observedTaxablePay: 22_500,
      observedIncomeTax: 890.35,
      sources: [
        {
          api: "individual-income",
          version: "1.2",
          importedAt: IMPORTED_AT,
          objectPath: "/employments/0/payFromEmployment",
        },
        {
          api: "individual-tax",
          version: "1.1",
          importedAt: IMPORTED_AT,
          objectPath: "/employments/0/taxTakenOffPay",
        },
      ],
    });
    expect(
      review.rows[0]?.sources.every(
        (source) => source.fingerprint.length === 64,
      ),
    ).toBe(true);
    expect(review.rows[0]).not.toHaveProperty("grossPay");
  });

  it("accepts minimal, partial, and empty official response shapes", async () => {
    const minimal = await readHmrcImportFile(
      await fixture("hmrc-individual-income-minimal.json"),
      "income",
      IMPORTED_AT,
    );
    const partial = reviewHmrcImport({
      memberId: "primary",
      taxYear: "2024-25",
      income: minimal,
    });
    expect(partial.rows).toEqual([
      expect.objectContaining({
        payeReference: "321/XY987",
        observedTaxablePay: 1200.25,
      }),
    ]);
    expect(partial.rows[0]).not.toHaveProperty("observedIncomeTax");

    const empty = await readHmrcImportFile(
      await fixture("hmrc-individual-income-empty.json"),
      "income",
      IMPORTED_AT,
    );
    expect(
      reviewHmrcImport({
        memberId: "primary",
        taxYear: "2024-25",
        income: empty,
      }),
    ).toEqual({ rows: [], diagnostics: [] });
  });

  it("rejects malformed JSON, duplicate PAYE rows, unsafe money, UTRs, and unsupported versions", async () => {
    await expect(
      readHmrcImportFile(
        new File(['{"employments": ['], "malformed.json"),
        "income",
      ),
    ).rejects.toThrow("not valid JSON");
    await expect(
      readHmrcImportFile(
        await fixture("hmrc-individual-income-duplicate.json"),
        "income",
      ),
    ).rejects.toThrow('Duplicate PAYE reference "123/AB456"');
    await expect(
      readHmrcImportFile(
        new File(
          [
            JSON.stringify({
              pensionsAnnuitiesAndOtherStateBenefits: {},
              employments: [
                {
                  employerPayeReference: "123/AB456",
                  payFromEmployment: 1.001,
                },
              ],
            }),
          ],
          "unsafe.json",
        ),
        "income",
      ),
    ).rejects.toThrow("Individual Income 1.2");
    await expect(
      readHmrcImportFile(
        new File(
          [
            JSON.stringify({
              utr: "invented-sensitive-identifier",
              pensionsAnnuitiesAndOtherStateBenefits: {},
              employments: [],
            }),
          ],
          "utr.json",
        ),
        "income",
      ),
    ).rejects.toThrow("Remove credentials and the UTR");
    await expect(
      readHmrcImportFile(
        new File(
          [
            JSON.stringify({
              api: "individual-income",
              version: "9.9",
              response: {
                pensionsAnnuitiesAndOtherStateBenefits: {},
                employments: [],
              },
            }),
          ],
          "unsupported.json",
        ),
        "income",
      ),
    ).rejects.toThrow("Unsupported individual-income version 9.9");
  });

  it("rejects mismatched tax years before pairing files", async () => {
    const income = await readHmrcImportFile(
      await fixture("hmrc-individual-income-corrected.json"),
      "income",
      IMPORTED_AT,
    );
    const taxEnvelope = new File(
      [
        JSON.stringify({
          api: "individual-tax",
          version: "1.1",
          taxYear: "2023-24",
          response: {
            pensionsAnnuitiesAndOtherStateBenefits: {},
            refunds: {},
            employments: [],
          },
        }),
      ],
      "tax-2023-24.json",
    );
    const tax = await readHmrcImportFile(taxEnvelope, "tax", IMPORTED_AT);

    const review = reviewHmrcImport({
      memberId: "primary",
      taxYear: "2024-25",
      income,
      tax,
    });

    expect(review.rows).toEqual([]);
    expect(
      review.diagnostics.map(({ message }) => message).join(" "),
    ).toContain("different tax years");
  });

  it("rejects empty observations and mismatched API source versions", () => {
    const source = {
      api: "individual-income",
      version: "1.2",
      fingerprint: "a".repeat(64),
      importedAt: IMPORTED_AT,
      objectPath: "/employments/0/payFromEmployment",
    };
    const emptyRow = {
      memberId: "primary",
      taxYear: "2024-25",
      payeReference: "123/AB456",
      sources: [source],
    };

    expect(() =>
      AcceptHmrcImportInputSchema.parse({ rows: [emptyRow], labels: {} }),
    ).toThrow("An HMRC observation must contain taxable pay or Income Tax");
    expect(() =>
      AcceptHmrcImportInputSchema.parse({
        rows: [
          {
            ...emptyRow,
            observedTaxablePay: 1000,
            sources: [{ ...source, version: "1.1" }],
          },
        ],
        labels: {},
      }),
    ).toThrow();
  });

  it("keeps re-imports idempotent and links revised values as corrections", async () => {
    const income = await readHmrcImportFile(
      await fixture("hmrc-individual-income-full.json"),
      "income",
      IMPORTED_AT,
    );
    const firstReview = reviewHmrcImport({
      memberId: "primary",
      taxYear: "2024-25",
      income,
    });
    let nextId = 0;
    const first = applyAcceptHmrcImport(
      [],
      [],
      { rows: firstReview.rows, labels: { "123/AB456": "Invented employer" } },
      () => String(++nextId),
      ACCEPTED_AT,
    );
    const repeated = applyAcceptHmrcImport(
      first.observations,
      first.labels,
      { rows: firstReview.rows, labels: { "123/AB456": "Invented employer" } },
      () => String(++nextId),
      "2026-10-31T10:02:00.000Z",
    );
    expect(repeated.observations).toHaveLength(2);
    expect(repeated.labels).toHaveLength(1);
    expect(repeated.labels[0]).toMatchObject({
      label: "Invented employer",
      source: "manual",
    });

    const correctedFile = await readHmrcImportFile(
      await fixture("hmrc-individual-income-corrected.json"),
      "income",
      "2026-10-31T10:03:00.000Z",
    );
    const correctedReview = reviewHmrcImport({
      memberId: "primary",
      taxYear: "2024-25",
      income: correctedFile,
    });
    const corrected = applyAcceptHmrcImport(
      repeated.observations,
      repeated.labels,
      { rows: correctedReview.rows, labels: {} },
      () => String(++nextId),
      "2026-10-31T10:04:00.000Z",
    );
    const prior = repeated.observations.find(
      (record) => record.payeReference === "123/AB456",
    );
    expect(corrected.observations).toHaveLength(3);
    expect(corrected.observations.at(-1)).toMatchObject({
      observedTaxablePay: 22_600,
      correctsId: prior?.id,
      acceptedAt: "2026-10-31T10:04:00.000Z",
    });
  });

  it("reconciles taxable pay and tax without treating gross pay as comparable", () => {
    const row = {
      memberId: "primary",
      taxYear: "2024-25",
      payeReference: "123/AB456",
      observedTaxablePay: 48_000,
      observedIncomeTax: 9_000,
      sources: [],
    };
    const salaryFact: SalaryHistoryRecord = {
      id: "salary-1",
      person: "Invented Person",
      employer: "Invented Employer",
      employmentId: "123/AB456",
      currency: "GBP",
      jurisdiction: "UK",
      effectiveStart: "2024-04-06",
      effectiveEnd: "2025-04-05",
      payFrequency: "annual",
      amountKind: "annualSalary",
      grossPay: 50_000,
      taxablePay: 48_000,
      observedIncomeTax: 8_500,
      source: { kind: "manual" },
      acceptedAt: ACCEPTED_AT,
    };

    expect(
      reconcileHmrcDraftRow(row, [] as HmrcEmploymentObservation[], [
        salaryFact,
      ]),
    ).toEqual({
      status: "new",
      taxablePay: "agrees",
      incomeTax: "differs",
      comparedWith: ["manual salary fact"],
    });
  });
});
