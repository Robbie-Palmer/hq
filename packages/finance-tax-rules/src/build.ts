import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ruleDataset } from "./data";
import { datasetSchema, type RuleDataset } from "./schema";
import { validateValidationCorpus } from "./validation";
import { validationCorpus } from "./validationData";

const canonicalJson = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const taxYearDates = (taxYear: string) => {
  const startYear = Number(taxYear.slice(0, 4));
  return {
    from: `${startYear}-04-06`,
    to: `${startYear + 1}-04-05`,
  };
};

const validateUniqueIds = (dataset: RuleDataset) => {
  const ids = [
    ...dataset.sources.map(({ id }) => id),
    ...dataset.incomeTax.map(({ id }) => id),
    ...dataset.nationalInsurance.map(({ id }) => id),
    ...dataset.pensions.map(({ id }) => id),
    ...dataset.householdTax.map(({ id }) => id),
  ];
  assert(new Set(ids).size === ids.length, "Source and rule IDs must be unique");
};

const validateSources = (dataset: RuleDataset) => {
  const sourceIds = new Set(dataset.sources.map(({ id }) => id));
  for (const rule of [
    ...dataset.incomeTax,
    ...dataset.nationalInsurance,
    ...dataset.pensions,
    ...dataset.householdTax,
  ]) {
    for (const sourceId of rule.provenance.sourceIds) {
      assert(
        sourceIds.has(sourceId),
        `${rule.id} references unknown source ${sourceId}`,
      );
    }
  }
};

const validateRuleIntervals = (dataset: RuleDataset) => {
  for (const rule of [
    ...dataset.incomeTax,
    ...dataset.householdTax,
  ]) {
    const expected = taxYearDates(rule.taxYear);
    assert(
      rule.effectiveFrom === expected.from && rule.effectiveTo === expected.to,
      `${rule.id} must cover its complete tax year`,
    );
  }

  const validateContinuousIntervals = (
    label: string,
    rules: Array<{ taxYear: string; effectiveFrom: string; effectiveTo: string }>,
  ) => {
    const byTaxYear = new Map<string, typeof rules>();
    for (const rule of rules) {
      const intervals = byTaxYear.get(rule.taxYear) ?? [];
      intervals.push(rule);
      byTaxYear.set(rule.taxYear, intervals);
    }
    for (const [taxYear, intervals] of byTaxYear) {
      const sorted = intervals.toSorted((left, right) =>
        left.effectiveFrom.localeCompare(right.effectiveFrom),
      );
      const expected = taxYearDates(taxYear);
      assert(
        sorted[0]?.effectiveFrom === expected.from,
        `${taxYear} ${label} starts late`,
      );
      assert(
        sorted.at(-1)?.effectiveTo === expected.to,
        `${taxYear} ${label} ends early`,
      );
      for (let index = 1; index < sorted.length; index += 1) {
        const previous = sorted[index - 1];
        const current = sorted[index];
        assert(previous && current, `${taxYear} ${label} interval is missing`);
        const dayAfterPrevious = new Date(`${previous.effectiveTo}T00:00:00Z`);
        dayAfterPrevious.setUTCDate(dayAfterPrevious.getUTCDate() + 1);
        assert(
          dayAfterPrevious.toISOString().slice(0, 10) === current.effectiveFrom,
          `${taxYear} ${label} intervals overlap or have a gap`,
        );
      }
    }
  };

  validateContinuousIntervals("NI", dataset.nationalInsurance);
  validateContinuousIntervals("pension", dataset.pensions);
};

const validateCoverage = (dataset: RuleDataset) => {
  const taxYears = [
    "2015-16",
    "2016-17",
    "2017-18",
    "2018-19",
    "2019-20",
    "2020-21",
    "2021-22",
    "2022-23",
    "2023-24",
    "2024-25",
    "2025-26",
    "2026-27",
  ];
  const jurisdictions = [
    "england-and-northern-ireland",
    "scotland",
    "wales",
  ] as const;
  for (const taxYear of taxYears) {
    for (const jurisdiction of jurisdictions) {
      assert(
        dataset.incomeTax.some(
          (rule) =>
            rule.taxYear === taxYear && rule.jurisdictions.includes(jurisdiction),
        ),
        `${taxYear} has no Income Tax rule for ${jurisdiction}`,
      );
    }
    assert(
      dataset.nationalInsurance.some((rule) => rule.taxYear === taxYear),
      `${taxYear} has no National Insurance rules`,
    );
    assert(
      dataset.pensions.some((rule) => rule.taxYear === taxYear),
      `${taxYear} has no pension rule`,
    );
    if (taxYear === "2025-26" || taxYear === "2026-27") {
      assert(
        dataset.householdTax.some((rule) => rule.taxYear === taxYear),
        `${taxYear} has no household tax rule`,
      );
    }
  }

  for (const rule of dataset.incomeTax) {
    assert(
      rule.jurisdictions.length === 1,
      `${rule.id} must belong to one independently versioned jurisdiction`,
    );
    assert(
      rule.bands.at(-1)?.widthPence === null,
      `${rule.id} must end with an open tax band`,
    );
    assert(
      rule.bands.slice(0, -1).every(({ widthPence }) => widthPence !== null),
      `${rule.id} has an open tax band before its final band`,
    );
  }
};

export const validateDataset = (input: unknown): RuleDataset => {
  const dataset = datasetSchema.parse(input);
  validateUniqueIds(dataset);
  validateSources(dataset);
  validateRuleIntervals(dataset);
  validateCoverage(dataset);
  return dataset;
};

export const validateReleaseLineage = (
  packageRoot: string,
  dataset: RuleDataset,
): void => {
  if (dataset.supersedes === null) return;
  assert.notEqual(
    dataset.datasetVersion,
    dataset.supersedes,
    "A dataset release cannot supersede itself",
  );
  const previousArtifactPath = join(
    packageRoot,
    `artifacts/enacted/${dataset.supersedes}.json`,
  );
  let previousArtifact: { datasetVersion?: unknown };
  try {
    previousArtifact = JSON.parse(readFileSync(previousArtifactPath, "utf8"));
  } catch {
    assert.fail(
      `Superseded artifact artifacts/enacted/${dataset.supersedes}.json must remain available`,
    );
  }
  assert.equal(
    previousArtifact.datasetVersion,
    dataset.supersedes,
    `Superseded artifact must identify dataset ${dataset.supersedes}`,
  );
};

const addResolvedProvenance = <Rule extends RuleDataset["incomeTax"][number] | RuleDataset["nationalInsurance"][number] | RuleDataset["pensions"][number] | RuleDataset["householdTax"][number]>(
  rule: Rule,
  sources: Map<string, ResolvedSource>,
) => ({
  ...rule,
  provenance: {
    ...rule.provenance,
    sources: rule.provenance.sourceIds.map((sourceId) => {
      const source = sources.get(sourceId);
      assert(source, `${rule.id} references unknown source ${sourceId}`);
      return source;
    }),
  },
});

type ResolvedSource = RuleDataset["sources"][number] & {
  snapshotSha256: string;
};

export const buildArtifacts = (packageRoot: string) => {
  const dataset = validateDataset(ruleDataset);
  validateReleaseLineage(packageRoot, dataset);
  const validatedCorpus = validateValidationCorpus(validationCorpus);
  assert(
    validatedCorpus.ruleDatasetVersion === dataset.datasetVersion,
    "Validation corpus must pin the built rule dataset version",
  );
  const resolvedSources: ResolvedSource[] = dataset.sources.map((source) => {
    const snapshot = readFileSync(join(packageRoot, source.snapshotPath), "utf8");
    return { ...source, snapshotSha256: sha256(snapshot) };
  });
  const sourcesById = new Map(resolvedSources.map((source) => [source.id, source]));
  const allRules = [
    ...dataset.incomeTax.map((rule) => addResolvedProvenance(rule, sourcesById)),
    ...dataset.nationalInsurance.map((rule) =>
      addResolvedProvenance(rule, sourcesById),
    ),
    ...dataset.pensions.map((rule) => addResolvedProvenance(rule, sourcesById)),
    ...dataset.householdTax.map((rule) =>
      addResolvedProvenance(rule, sourcesById),
    ),
  ];
  const commonArtifact = {
    datasetVersion: dataset.datasetVersion,
    releasedAt: dataset.releasedAt,
    supersedes: dataset.supersedes,
    corrections: dataset.corrections,
    dataLicence: dataset.dataLicence,
  };
  const enacted = {
    ...commonArtifact,
    legalStatus: "enacted",
    rules: allRules.filter(({ legalStatus }) => legalStatus === "enacted"),
  };
  const announcedRules = allRules.filter(
    ({ legalStatus }) => legalStatus === "announced",
  );
  const coverage = {
    ...commonArtifact,
    supportedTaxYears: [
      "2015-16",
      "2016-17",
      "2017-18",
      "2018-19",
      "2019-20",
      "2020-21",
      "2021-22",
      "2022-23",
      "2023-24",
      "2024-25",
      "2025-26",
      "2026-27",
    ],
    jurisdictions: [
      "england-and-northern-ireland",
      "scotland",
      "wales",
    ],
    incomeTax: {
      incomeScope: "employment-non-savings-non-dividend",
      calculationScope: "annual-liability",
      personalAllowanceTapering: true,
      unavailable: [
        "PAYE withholding and tax codes",
        "savings and dividend income",
        "Marriage Allowance and Blind Person's Allowance",
      ],
    },
    nationalInsurance: {
      class: 1,
      categories: ["A"],
      employmentTypes: ["employee-not-director"],
      payPeriods: ["weekly", "monthly"],
      unavailable: [
        "categories other than A",
        "company directors",
        "annual and irregular pay periods",
      ],
    },
    pensions: {
      methods: ["salary-sacrifice", "net-pay", "relief-at-source"],
      limits: [
        "member tax-relief earnings limit",
        "annual allowance",
        "tapered annual allowance",
        "money purchase annual allowance",
      ],
    },
    householdTax: {
      supportedTaxYears: ["2025-26", "2026-27"],
      income: ["employment", "savings interest", "dividends"],
      capitalGains: ["non-residential assets", "residential property"],
      wrappers: ["ISA", "pension", "taxable"],
      unavailable: [
        "partial-year residence",
        "taxable benefits",
        "Scottish household totals",
        "foreign savings, accrued income securities, chargeable-event gains, and property income",
        "Capital Gains Tax reliefs and elections",
        "pension carry forward and defined benefit input amounts",
      ],
    },
    missingDataBehavior: "unavailable",
  };

  const version = dataset.datasetVersion;
  const artifacts = new Map([
    [`artifacts/enacted/${version}.json`, canonicalJson(enacted)],
    [`artifacts/coverage-matrix/${version}.json`, canonicalJson(coverage)],
    [
      `artifacts/validation/${validatedCorpus.corpusVersion}.json`,
      canonicalJson(validatedCorpus),
    ],
  ]);
  if (announcedRules.length > 0) {
    artifacts.set(
      `artifacts/announced/${version}.json`,
      canonicalJson({
        ...commonArtifact,
        legalStatus: "announced",
        rules: announcedRules,
      }),
    );
  }
  const manifest = {
    ...commonArtifact,
    artifacts: [...artifacts].map(([path, content]) => ({
      path,
      sha256: sha256(content),
    })),
    sourceSnapshots: resolvedSources.map(
      ({ id, snapshotPath, snapshotSha256, sourceContentSha256 }) => ({
        id,
        path: snapshotPath,
        snapshotSha256,
        sourceContentSha256,
      }),
    ),
    validation: {
      corpusVersion: validatedCorpus.corpusVersion,
      libraryVersion: validatedCorpus.libraryVersion,
      ruleDatasetVersion: validatedCorpus.ruleDatasetVersion,
      calculationContractVersion: validatedCorpus.calculationContractVersion,
      fixtureCount: validatedCorpus.fixtures.length,
      sourceSnapshots: validatedCorpus.sources.map((source) => ({
        id: source.id,
        path: source.snapshotPath,
        snapshotSha256: sha256(
          readFileSync(join(packageRoot, source.snapshotPath), "utf8"),
        ),
      })),
    },
  };
  artifacts.set("artifacts/manifest.json", canonicalJson(manifest));
  return artifacts;
};
