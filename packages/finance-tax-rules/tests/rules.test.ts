import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildArtifacts,
  validateDataset,
  validateReleaseLineage,
} from "../src/build";
import { ruleDataset } from "../src/data";
import { resolveRules } from "../src/index";
import {
  salaryCalculationRequestSchema,
  salaryCalculationResultSchema,
} from "../src/salaryAdapter";
import {
  evaluateValidationFixture,
  type ValidationCandidate,
  validateValidationCorpus,
} from "../src/validation";
import { validationCorpus } from "../src/validationData";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

describe("UK tax rule dataset", () => {
  it("passes structural and semantic validation", () => {
    expect(validateDataset(ruleDataset).datasetVersion).toBe("2026.10.0");
  });

  it("builds deterministic artifacts without an empty announced release", () => {
    const first = buildArtifacts(packageRoot);
    const second = buildArtifacts(packageRoot);

    expect([...first]).toEqual([...second]);
    expect(first.get("artifacts/enacted/2026.10.0.json")).toContain(
      '"legalStatus": "enacted"',
    );
    expect(first.has("artifacts/announced/2026.10.0.json")).toBe(false);
    expect(first.get("artifacts/manifest.json")).not.toContain(
      "artifacts/announced/2026.10.0.json",
    );
    expect(first.get("artifacts/validation/2026.10.0.json")).toContain(
      '"calculationContractVersion": "salary-validation-v1"',
    );
    expect(first.get("artifacts/manifest.json")).toContain('"fixtureCount": 16');
  });

  it("requires a superseded enacted artifact to remain available", () => {
    const releaseRoot = mkdtempSync(resolve(tmpdir(), "finance-tax-rules-"));
    const enactedDirectory = resolve(releaseRoot, "artifacts/enacted");
    mkdirSync(enactedDirectory, { recursive: true });
    writeFileSync(
      resolve(enactedDirectory, "2026.10.0.json"),
      JSON.stringify({ datasetVersion: "2026.10.0" }),
    );
    const nextDataset = validateDataset({
      ...ruleDataset,
      datasetVersion: "2026.10.1",
      supersedes: "2026.10.0",
    });

    expect(() => validateReleaseLineage(releaseRoot, nextDataset)).not.toThrow();
    expect(() =>
      validateReleaseLineage(releaseRoot, {
        ...nextDataset,
        supersedes: "2026.09.0",
      }),
    ).toThrow("Superseded artifact artifacts/enacted/2026.09.0.json");
  });
});

describe("salary validation corpus", () => {
  it("covers the required annual, payroll, pension, and unsupported cases", () => {
    const corpus = validateValidationCorpus(validationCorpus);

    expect(corpus.syntheticDataOnly).toBe(true);
    expect(corpus.fixtures).toHaveLength(16);
    expect(
      corpus.fixtures
        .filter(({ expected }) => expected.supported)
        .every(({ sources }) => sources.length > 0),
    ).toBe(true);
  });

  it("rejects source hosts that merely end with the government suffix", () => {
    const maliciousCorpus = {
      ...validationCorpus,
      sources: validationCorpus.sources.map((source, index) =>
        index === 0 ? { ...source, url: "https://notgov.uk/payroll-rules" } : source,
      ),
    };

    expect(() => validateValidationCorpus(maliciousCorpus)).toThrow(
      "is not an official government source",
    );
  });

  it("reports component mismatches and refuses annual precision for payroll", () => {
    const fixture = validationCorpus.fixtures.find(
      ({ id }) => id === "payroll-monthly-br",
    );
    if (!fixture?.expected.supported) {
      throw new Error("Expected a supported payroll fixture");
    }
    const candidate: ValidationCandidate = {
      supported: true,
      libraryVersion: validationCorpus.libraryVersion,
      ruleDatasetVersion: validationCorpus.ruleDatasetVersion,
      calculationVersion: validationCorpus.calculationContractVersion,
      precision: "annual-liability-estimate",
      components: {
        ...fixture.expected.components,
        incomeTaxPence: fixture.expected.components.incomeTaxPence + 1,
      },
    };

    expect(evaluateValidationFixture(fixture, candidate, validationCorpus)).toMatchObject({
      passed: false,
      mismatches: [
        { component: "precision" },
        { component: "incomeTaxPence", expected: 60_000, actual: 60_001 },
      ],
    });
  });

  it("requires the declared reason when a candidate rejects an input", () => {
    const fixture = validationCorpus.fixtures.find(
      ({ id }) => id === "unsupported-ni-category-b",
    );
    if (!fixture) {
      throw new Error("Expected an unsupported NI fixture");
    }
    const result = evaluateValidationFixture(
      fixture,
      {
        supported: false,
        libraryVersion: validationCorpus.libraryVersion,
        ruleDatasetVersion: validationCorpus.ruleDatasetVersion,
        calculationVersion: validationCorpus.calculationContractVersion,
        reasons: ["unsupported-national-insurance-category"],
      },
      validationCorpus,
    );

    expect(result).toEqual({
      fixtureId: fixture.id,
      passed: true,
      mismatches: [],
    });
  });
});

describe("rule resolution", () => {
  const request = {
    jurisdiction: "england-and-northern-ireland",
    nationalInsuranceCategory: "A",
    payPeriod: "monthly",
  };

  it("selects each 2022/23 NI interval at its boundary", () => {
    const april = resolveRules({ ...request, date: "2022-04-06" });
    const july = resolveRules({ ...request, date: "2022-07-06" });
    const november = resolveRules({ ...request, date: "2022-11-06" });

    expect(april.available && april.nationalInsurance.id).toBe("ni-2022-23-a");
    expect(july.available && july.nationalInsurance.id).toBe("ni-2022-23-b");
    expect(november.available && november.nationalInsurance.id).toBe(
      "ni-2022-23-c",
    );
  });

  it("selects the January 2024 NI reduction", () => {
    const before = resolveRules({ ...request, date: "2024-01-05" });
    const after = resolveRules({ ...request, date: "2024-01-06" });

    expect(
      before.available &&
        before.nationalInsurance.rates.primaryToUpperBasisPoints,
    ).toBe(1_200);
    expect(
      after.available && after.nationalInsurance.rates.primaryToUpperBasisPoints,
    ).toBe(1_000);
  });

  it("selects Scottish bands and pension limits", () => {
    const result = resolveRules({
      ...request,
      date: "2025-08-01",
      jurisdiction: "scotland",
    });

    expect(result.available).toBe(true);
    if (!result.available) {
      throw new Error(result.detail);
    }
    expect(result.incomeTax.id).toBe("income-tax-2025-26-scotland");
    expect(result.incomeTax.bands.map(({ rateBasisPoints }) => rateBasisPoints)).toEqual([
      1_900,
      2_000,
      2_100,
      4_200,
      4_500,
      4_800,
    ]);
    expect(result.pension.annualAllowancePence).toBe(6_000_000);
  });

  it("versions Wales separately despite current rate parity", () => {
    const englandAndNorthernIreland = resolveRules({
      ...request,
      date: "2025-08-01",
    });
    const wales = resolveRules({
      ...request,
      date: "2025-08-01",
      jurisdiction: "wales",
    });

    expect(
      englandAndNorthernIreland.available && englandAndNorthernIreland.incomeTax.id,
    ).toBe("income-tax-2025-26-england-northern-ireland");
    expect(wales.available && wales.incomeTax.id).toBe(
      "income-tax-2025-26-wales",
    );
    expect(
      wales.available && wales.incomeTax.bands,
    ).toEqual(
      englandAndNorthernIreland.available
        ? englandAndNorthernIreland.incomeTax.bands
        : [],
    );
  });

  it.each([
    [
      { ...request, date: "2021-04-06" },
      "unsupported-date",
    ],
    [
      { ...request, date: "2025-04-06", nationalInsuranceCategory: "B" },
      "unsupported-national-insurance-category",
    ],
    [
      { ...request, date: "2025-04-06", payPeriod: "annual" },
      "unsupported-pay-period",
    ],
    [
      { ...request, date: "2025-02-30" },
      "invalid-date",
    ],
  ])("returns unavailable for unsupported input %#", (input, reason) => {
    expect(resolveRules(input)).toMatchObject({ available: false, reason });
  });
});

describe("salary calculator adapter contract", () => {
  const request = {
    effectiveDate: "2025-06-30",
    taxYear: "2025-26",
    jurisdiction: "england-and-northern-ireland",
    precision: "annual-liability-estimate",
    pay: {
      contractualGrossPayPence: 6_000_000,
      grossCashPayPence: 5_400_000,
      taxablePayPence: 5_400_000,
      nationalInsuranceEarningsPence: 5_400_000,
    },
    pension: {
      method: "salary-sacrifice",
      grossContributionPence: 600_000,
      memberDeductionPence: 0,
      employerContributionPence: 600_000,
      providerTaxReliefPence: 0,
    },
    assumptions: [
      { id: "employment-type", value: "employee-not-director" },
    ],
  };

  it("keeps tax, NI, and pension pay bases distinct", () => {
    expect(salaryCalculationRequestSchema.parse(request)).toEqual(request);
    expect(() =>
      salaryCalculationRequestSchema.parse({
        ...request,
        pay: {
          contractualGrossPayPence: 6_000_000,
          grossCashPayPence: 5_400_000,
          taxablePayPence: 4_143_000,
        },
      }),
    ).toThrow();

    expect(() =>
      salaryCalculationRequestSchema.parse({
        ...request,
        precision: "exact-payroll-deduction",
      }),
    ).toThrow();
    expect(() =>
      salaryCalculationRequestSchema.parse({
        ...request,
        taxYear: "2024-25",
      }),
    ).toThrow();
  });

  it("requires reproducible result lineage and rounding", () => {
    const roundingRule = "Round the calculated value to the nearest penny.";
    const result = {
      precision: "annual-liability-estimate",
      components: {
        grossCashPayPence: 5_400_000,
        taxablePayPence: 5_400_000,
        incomeTaxPence: 903_200,
        employeeNationalInsurancePence: 309_000,
        memberPensionDeductionPence: 0,
        employerPensionContributionPence: 600_000,
        providerTaxReliefPence: 0,
        takeHomePayPence: 4_187_800,
      },
      lineage: {
        adapterId: "saving-tool-annual-v1",
        adapterVersion: "1",
        engineId: "@saving-tool/hmrc-income-tax",
        engineVersion: "3.0.1",
        ruleDatasetVersion: "2026.10.0",
        effectiveRuleVersion: "2025-26",
        calculationVersion: "salary-estimate-v1",
        sourceRuleIds: [
          "income-tax-2025-26-england-northern-ireland",
          "ni-2025-26",
        ],
        assumptions: request.assumptions,
        rounding: [
          { component: "grossCashPayPence", rule: roundingRule },
          { component: "taxablePayPence", rule: roundingRule },
          { component: "incomeTaxPence", rule: roundingRule },
          { component: "employeeNationalInsurancePence", rule: roundingRule },
          { component: "memberPensionDeductionPence", rule: roundingRule },
          { component: "employerPensionContributionPence", rule: roundingRule },
          { component: "providerTaxReliefPence", rule: roundingRule },
          { component: "takeHomePayPence", rule: roundingRule },
        ],
      },
    };

    expect(salaryCalculationResultSchema.parse(result)).toEqual(result);
    expect(() =>
      salaryCalculationResultSchema.parse({
        ...result,
        lineage: { ...result.lineage, sourceRuleIds: [] },
      }),
    ).toThrow();
    expect(() =>
      salaryCalculationResultSchema.parse({
        ...result,
        lineage: { ...result.lineage, rounding: result.lineage.rounding.slice(1) },
      }),
    ).toThrow();
    expect(() =>
      salaryCalculationResultSchema.parse({
        ...result,
        lineage: {
          ...result.lineage,
          rounding: [
            ...result.lineage.rounding.slice(0, -1),
            result.lineage.rounding[0],
          ],
        },
      }),
    ).toThrow();
  });
});
