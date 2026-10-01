import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ruleDataset } from "./data";
import { datasetSchema, type RuleDataset } from "./schema";

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
  ];
  assert(new Set(ids).size === ids.length, "Source and rule IDs must be unique");
};

const validateSources = (dataset: RuleDataset) => {
  const sourceIds = new Set(dataset.sources.map(({ id }) => id));
  for (const rule of [
    ...dataset.incomeTax,
    ...dataset.nationalInsurance,
    ...dataset.pensions,
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
  for (const rule of [...dataset.incomeTax, ...dataset.pensions]) {
    const expected = taxYearDates(rule.taxYear);
    assert(
      rule.effectiveFrom === expected.from && rule.effectiveTo === expected.to,
      `${rule.id} must cover its complete tax year`,
    );
  }

  const byTaxYear = new Map<
    string,
    RuleDataset["nationalInsurance"]
  >();
  for (const rule of dataset.nationalInsurance) {
    const rules = byTaxYear.get(rule.taxYear) ?? [];
    rules.push(rule);
    byTaxYear.set(rule.taxYear, rules);
  }
  for (const [taxYear, rules] of byTaxYear) {
    const sorted = rules.toSorted((left, right) =>
      left.effectiveFrom.localeCompare(right.effectiveFrom),
    );
    const expected = taxYearDates(taxYear);
    assert(sorted[0]?.effectiveFrom === expected.from, `${taxYear} NI starts late`);
    assert(sorted.at(-1)?.effectiveTo === expected.to, `${taxYear} NI ends early`);
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      assert(previous && current, `${taxYear} NI interval is missing`);
      const dayAfterPrevious = new Date(`${previous.effectiveTo}T00:00:00Z`);
      dayAfterPrevious.setUTCDate(dayAfterPrevious.getUTCDate() + 1);
      assert(
        dayAfterPrevious.toISOString().slice(0, 10) === current.effectiveFrom,
        `${taxYear} NI intervals overlap or have a gap`,
      );
    }
  }
};

const validateCoverage = (dataset: RuleDataset) => {
  const taxYears = ["2022-23", "2023-24", "2024-25", "2025-26", "2026-27"];
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

const addResolvedProvenance = <Rule extends RuleDataset["incomeTax"][number] | RuleDataset["nationalInsurance"][number] | RuleDataset["pensions"][number]>(
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
    missingDataBehavior: "unavailable",
  };

  const version = dataset.datasetVersion;
  const artifacts = new Map([
    [`artifacts/enacted/${version}.json`, canonicalJson(enacted)],
    [`artifacts/coverage-matrix/${version}.json`, canonicalJson(coverage)],
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
  };
  artifacts.set("artifacts/manifest.json", canonicalJson(manifest));
  return artifacts;
};
