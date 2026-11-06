import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { RuleDataset } from "./schema";
import type { ValidationCorpus } from "./validation";

const evidenceSchema = z.object({
  implementationPaths: z.array(z.string().min(1)),
  testPaths: z.array(z.string().min(1)),
  fixturePaths: z.array(z.string().min(1)).default([]),
  officialRuleSourceIds: z.array(z.string().min(1)),
  validationFixtureIds: z.array(z.string().min(1)),
  workGraphTicketIds: z.array(z.string().min(1)),
});

const coverageClaimSchema = z.object({
  id: z.string().min(1),
  status: z.enum([
    "implemented",
    "approximate",
    "explicitly-unavailable",
    "untracked",
  ]),
  calculationKinds: z.array(
    z.enum([
      "annual-liability-estimate",
      "period-exact-payroll-calculation",
      "user-supplied-assumption",
      "not-applicable",
    ]),
  ).min(1),
  summary: z.string().min(1),
  boundaries: z.array(z.string().min(1)),
  evidence: evidenceSchema,
});

const providerEvaluationSchema = z.object({
  provider: z.string().min(1),
  version: z.string().min(1),
  decision: z.enum(["accepted", "rejected"]),
  evaluationStatus: z.enum(["evaluated", "blocked-before-fixture-execution"]),
  runtimeFit: z.string().min(1),
  licence: z.string().min(1),
  versionSelection: z.string().min(1),
  reproducibility: z.string().min(1),
  historicalDepth: z.string().min(1),
  failureBehavior: z.string().min(1),
  validationFixtureIds: z.array(z.string().min(1)),
  evidencePaths: z.array(z.string().min(1)).min(1),
});

export const coverageContractSchema = z.object({
  coverageContractVersion: z.string().regex(/^\d{4}\.\d{2}\.\d+$/),
  publishedAt: z.iso.date(),
  ruleDatasetVersion: z.string().min(1),
  validationCorpusVersion: z.string().min(1),
  externalRuleSets: z.array(
    z.object({
      id: z.string().min(1),
      version: z.string().min(1),
      sourceDefinitionPath: z.string().min(1),
      officialRuleSourceIds: z.array(z.string().min(1)).min(1),
    }),
  ).min(1),
  userFlows: z.array(
    z.object({
      id: z.enum([
        "salary-history",
        "job-move-forecast",
        "household-tax-position",
        "side-income-scenarios",
      ]),
      claims: z.array(coverageClaimSchema).min(1),
    }),
  ).length(4),
  providerEvaluations: z.array(providerEvaluationSchema).min(1),
});

const annualFixtureIds = [
  "annual-england-basic-band-ceiling",
  "annual-personal-allowance-taper",
  "annual-scotland-bands",
  "annual-pension-salary-sacrifice",
  "annual-pension-net-pay",
  "annual-pension-relief-at-source",
];

const payrollFixtureIds = [
  "payroll-monthly-br",
  "payroll-weekly-br",
  "payroll-cumulative-1257l-month-one",
  "payroll-cumulative-1257l-bonus",
  "payroll-non-cumulative-1257l-bonus",
  "payroll-job-change-with-prior-state",
  "payroll-ni-rate-before-january-2024-cut",
  "payroll-ni-rate-after-january-2024-cut",
  "unsupported-ni-category-b",
  "unsupported-job-change-without-prior-state",
];

type ProviderEvaluationInput = z.input<typeof providerEvaluationSchema>;

const salaryProviderEvidencePath =
  "ui/content/projects/personal-finance-app/adrs/005-adapt-savingtool-for-annual-salary-estimates.mdx";

const evaluatedSalaryProvider = (
  evaluation: Omit<
    ProviderEvaluationInput,
    "evaluationStatus" | "validationFixtureIds" | "evidencePaths"
  >,
  additionalEvidencePaths: string[] = [],
): ProviderEvaluationInput => {
  const { provider, version, decision, ...details } = evaluation;

  return {
    provider,
    version,
    decision,
    evaluationStatus: "evaluated",
    ...details,
    validationFixtureIds: [...annualFixtureIds, ...payrollFixtureIds],
    evidencePaths: [salaryProviderEvidencePath, ...additionalEvidencePaths],
  };
};

export const coverageContract = {
  coverageContractVersion: "2026.11.0",
  publishedAt: "2026-11-05",
  ruleDatasetVersion: "2026.10.4",
  validationCorpusVersion: "2026.10.4",
  externalRuleSets: [
    {
      id: "uk-side-income-eligibility-and-obligations",
      version: "2026-10-31",
      sourceDefinitionPath:
        "packages/personal-finance-contracts/artifacts/uk-side-income-rules-2026-10-31.json",
      officialRuleSourceIds: [
        "register-sole-trader",
        "tax-free-allowances-on-property-and-trading-income",
        "register-for-vat",
        "using-making-tax-digital-for-income-tax-for-the-first-time",
      ],
    },
    {
      id: "uk-sole-trader-tax",
      version: "2026-10-31",
      sourceDefinitionPath:
        "packages/personal-finance-contracts/src/soleTraderRules.ts",
      officialRuleSourceIds: [
        "self-employed-national-insurance-rates",
        "student-loans-in-tax-return",
        "student-loan-rates-2026-27",
        "payments-on-account",
        "self-assessment-deadlines",
      ],
    },
  ],
  userFlows: [
    {
      id: "salary-history",
      claims: [
        {
          id: "annual-tax-and-pension-estimate",
          status: "implemented",
          calculationKinds: [
            "annual-liability-estimate",
            "user-supplied-assumption",
          ],
          summary:
            "Historical salary records use reviewed annual Income Tax rules, pay-period employee National Insurance, and explicit workplace-pension methods.",
          boundaries: [
            "Income Tax is an annual liability estimate rather than PAYE withholding.",
            "Employer National Insurance savings and other-income amounts remain user-supplied assumptions.",
          ],
          evidence: {
            implementationPaths: [
              "packages/finance-tax-rules/src/historicalSalary.ts",
              "ui/app/_projects/personal-finance-app/domain/salaryCalculation.ts",
            ],
            testPaths: [
              "packages/finance-tax-rules/tests/historicalSalary.test.ts",
              "ui/app/_projects/personal-finance-app/tests/domain/salaryCalculation.test.ts",
            ],
            officialRuleSourceIds: [
              "hmrc-income-tax-current-and-past",
              "hmrc-employer-rates",
              "hmrc-workplace-pension-methods",
              "hmrc-salary-sacrifice",
            ],
            validationFixtureIds: annualFixtureIds,
            workGraphTicketIds: [],
          },
        },
        {
          id: "annualised-national-insurance-fallback",
          status: "approximate",
          calculationKinds: ["annual-liability-estimate"],
          summary:
            "When salary history has no pay-period earnings, employee National Insurance is approximated with twelve monthly periods.",
          boundaries: [
            "Supplying actual weekly or monthly post-sacrifice earnings periods replaces this fallback.",
            "The fallback is not payslip reconciliation and cannot place bonuses into their actual periods.",
          ],
          evidence: {
            implementationPaths: [
              "packages/finance-tax-rules/src/historicalSalary.ts",
            ],
            testPaths: [
              "packages/finance-tax-rules/tests/historicalSalary.test.ts",
            ],
            officialRuleSourceIds: ["hmrc-employer-rates"],
            validationFixtureIds: annualFixtureIds,
            workGraphTicketIds: [],
          },
        },
        {
          id: "payslip-reconciliation",
          status: "explicitly-unavailable",
          calculationKinds: ["period-exact-payroll-calculation"],
          summary:
            "The validation corpus can test period-exact payroll candidates, but the salary-history result does not claim exact PAYE reconciliation.",
          boundaries: [
            "A production result is unavailable without complete tax-code, pay-period, prior-pay, prior-tax, and rounding facts.",
          ],
          evidence: {
            implementationPaths: [
              "packages/finance-tax-rules/src/historicalSalary.ts",
              "packages/finance-tax-rules/src/validation.ts",
            ],
            testPaths: [
              "packages/finance-tax-rules/tests/historicalSalary.test.ts",
              "packages/finance-tax-rules/tests/rules.test.ts",
            ],
            officialRuleSourceIds: [
              "hmrc-paye-routine-v24",
              "hmrc-ca38-2026",
            ],
            validationFixtureIds: payrollFixtureIds,
            workGraphTicketIds: [],
          },
        },
      ],
    },
    {
      id: "job-move-forecast",
      claims: [
        {
          id: "offer-take-home-and-workplace-pension",
          status: "implemented",
          calculationKinds: [
            "annual-liability-estimate",
            "user-supplied-assumption",
          ],
          summary:
            "Job offers use the shared annual salary and workplace-pension calculators, including salary sacrifice, net pay, relief at source, scheme earnings, and employer policies.",
          boundaries: [
            "Variable pay is placed into supplied pay periods for National Insurance, but Income Tax remains an annual estimate.",
            "Unknown scheme bases and employer rules stay unavailable until the user supplies them.",
          ],
          evidence: {
            implementationPaths: [
              "packages/finance-tax-rules/src/historicalSalary.ts",
              "packages/finance-tax-rules/src/workplacePension.ts",
              "ui/app/_projects/personal-finance-app/domain/jobMoveScenario.ts",
            ],
            testPaths: [
              "packages/finance-tax-rules/tests/historicalSalary.test.ts",
              "packages/finance-tax-rules/tests/workplacePension.test.ts",
              "ui/app/_projects/personal-finance-app/tests/domain/jobMoveScenario.test.ts",
            ],
            officialRuleSourceIds: [
              "dwp-automatic-enrolment-earnings-bands",
              "hmrc-pension-scheme-rates",
              "hmrc-pension-relief-at-source",
              "hmrc-pension-net-pay",
              "hmrc-salary-sacrifice",
            ],
            validationFixtureIds: [
              ...annualFixtureIds,
              "payroll-job-change-with-prior-state",
              "unsupported-job-change-without-prior-state",
            ],
            workGraphTicketIds: [],
          },
        },
      ],
    },
    {
      id: "household-tax-position",
      claims: [
        {
          id: "annual-household-liability",
          status: "implemented",
          calculationKinds: [
            "annual-liability-estimate",
            "user-supplied-assumption",
          ],
          summary:
            "The household calculator combines employment, savings, dividends, disposals, wrappers, National Insurance, and pension inputs for 2025/26 and 2026/27.",
          boundaries: [
            "Observed records and user assumptions remain separate in result lineage.",
            "Any unsupported household fact withholds the household total rather than silently omitting it.",
          ],
          evidence: {
            implementationPaths: [
              "packages/finance-tax-rules/src/householdTax.ts",
            ],
            testPaths: [
              "packages/finance-tax-rules/tests/householdTax.test.ts",
            ],
            officialRuleSourceIds: [
              "hmrc-income-tax-current-and-past",
              "hmrc-tax-on-savings-interest",
              "hmrc-capital-gains-rates-and-allowances",
              "hmrc-isa-overview",
            ],
            validationFixtureIds: [],
            workGraphTicketIds: [],
          },
        },
        {
          id: "unsupported-household-boundaries",
          status: "explicitly-unavailable",
          calculationKinds: ["not-applicable"],
          summary:
            "Scottish household totals, partial-year residence, taxable benefits, unsupported National Insurance categories, and several allowances and reliefs are unavailable.",
          boundaries: [
            "Marriage Allowance has an accepted follow-up ticket.",
            "The specialist annual-allowance calculator is separate because it requires more statutory facts than the household summary records.",
          ],
          evidence: {
            implementationPaths: [
              "packages/finance-tax-rules/src/householdTax.ts",
              "packages/finance-tax-rules/src/annualAllowance.ts",
            ],
            testPaths: [
              "packages/finance-tax-rules/tests/householdTax.test.ts",
              "packages/finance-tax-rules/tests/annualAllowance.test.ts",
            ],
            officialRuleSourceIds: ["hmrc-income-tax-current-and-past"],
            validationFixtureIds: ["unsupported-ni-category-b"],
            workGraphTicketIds: ["finance-marriage-allowance"],
          },
        },
      ],
    },
    {
      id: "side-income-scenarios",
      claims: [
        {
          id: "sole-trader-tax-and-obligations",
          status: "implemented",
          calculationKinds: [
            "annual-liability-estimate",
            "user-supplied-assumption",
          ],
          summary:
            "The sole-trader scenario calculates 2026/27 profit, annual Income Tax, Class 4 National Insurance, student loans, payments on account, cash timing, tax reserves, and filing obligations.",
          boundaries: [
            "Coverage is limited to the 2026/27 ruleset and supported GB sole-trader cases.",
            "Trading losses stop the calculation because loss relief and carry-forward treatment are not modelled.",
            "Unresolved eligibility, expense treatment, international facts, and non-sole-trader structures return review or unsupported issues before tax is calculated.",
          ],
          evidence: {
            implementationPaths: [
              "packages/personal-finance-contracts/src/soleTraderCashFlow.ts",
              "packages/personal-finance-contracts/src/soleTraderRules.ts",
              "packages/personal-finance-contracts/src/soleTraderScenario.ts",
              "packages/personal-finance-contracts/src/soleTraderTax.ts",
              "ui/app/_projects/personal-finance-app/components/sole-trader-scenarios.tsx",
            ],
            testPaths: [
              "packages/personal-finance-contracts/tests/soleTraderRules.test.ts",
              "packages/personal-finance-contracts/tests/soleTraderScenario.test.ts",
              "ui/app/_projects/personal-finance-app/tests/components/routes.test.tsx",
            ],
            fixturePaths: [
              "packages/personal-finance-contracts/src/soleTraderSyntheticScenarios.ts",
            ],
            officialRuleSourceIds: [
              "hmrc-income-tax-current-and-past",
              "register-sole-trader",
              "tax-free-allowances-on-property-and-trading-income",
              "register-for-vat",
              "using-making-tax-digital-for-income-tax-for-the-first-time",
              "self-employed-national-insurance-rates",
              "student-loans-in-tax-return",
              "student-loan-rates-2026-27",
              "payments-on-account",
              "self-assessment-deadlines",
            ],
            validationFixtureIds: [
              "annual-personal-allowance-taper",
              "annual-scotland-bands",
            ],
            workGraphTicketIds: [],
          },
        },
        {
          id: "limited-company-comparison",
          status: "explicitly-unavailable",
          calculationKinds: ["annual-liability-estimate"],
          summary:
            "The released tax package does not compare limited-company salary, dividends, pensions, retained profit, and household cash.",
          boundaries: ["The accepted gap has its own prioritised Work Graph ticket."],
          evidence: {
            implementationPaths: [],
            testPaths: [],
            officialRuleSourceIds: [],
            validationFixtureIds: [],
            workGraphTicketIds: ["finance-side-income-03-limited-company"],
          },
        },
        {
          id: "umbrella-and-ir35-comparison",
          status: "explicitly-unavailable",
          calculationKinds: ["annual-liability-estimate"],
          summary:
            "The released tax package does not model umbrella contracting or inside and outside IR35 scenarios.",
          boundaries: ["The accepted gap has its own prioritised Work Graph ticket."],
          evidence: {
            implementationPaths: [],
            testPaths: [],
            officialRuleSourceIds: [],
            validationFixtureIds: [],
            workGraphTicketIds: ["finance-side-income-04-umbrella-ir35"],
          },
        },
      ],
    },
  ],
  providerEvaluations: [
    evaluatedSalaryProvider(
      {
        provider: "@saving-tool/hmrc-income-tax",
        version: "3.0.1",
        decision: "accepted",
        runtimeFit: "TypeScript with no runtime dependencies; used behind a local adapter.",
        licence: "MIT",
        versionSelection: "The package version is pinned exactly in package.json and calculation lineage.",
        reproducibility: "Saved results record the adapter, dependency, rule dataset, rules, sources, inputs, assumptions, and rounding contract.",
        historicalDepth: "The application limits use to reviewed 2015/16 through 2026/27 local rules even when the dependency exposes other constants.",
        failureBehavior: "Unsupported dates, jurisdictions, payroll facts, or pension facts return unavailable; no alternative rule set is substituted.",
      },
      ["packages/finance-tax-rules/src/historicalSalary.ts"],
    ),
    evaluatedSalaryProvider({
      provider: "PolicyEngine UK",
      version: "2.109.4",
      decision: "rejected",
      runtimeFit: "Python 3.11 or newer with 76 installed packages in the evaluation environment.",
      licence: "AGPL-3.0",
      versionSelection: "The evaluated release was pinned, but adopting it would add a Python service and licence boundary.",
      reproducibility: "Annual Income Tax matched after rounding; no candidate completed the exact-payroll contract.",
      historicalDepth: "Evaluated against the versioned local salary corpus rather than accepting broad package coverage claims.",
      failureBehavior: "Not integrated; local unsupported cases remain unavailable.",
    }),
    evaluatedSalaryProvider({
      provider: "uk-tax",
      version: "0.1.3",
      decision: "rejected",
      runtimeFit: "Rust with no dependencies, but TypeScript or WebAssembly integration would still be required.",
      licence: "MIT",
      versionSelection: "The evaluated crate release was pinned.",
      reproducibility: "It failed the Personal Allowance taper fixture and lacks Scottish, pension, and payroll-period coverage.",
      historicalDepth: "Older constants do not extend the product claim without reviewed official rules and fixtures.",
      failureBehavior: "Not integrated; missing cases remain unavailable.",
    }),
    {
      provider: "TaxScope",
      version: "unversioned-public-api-observed-2026-11-04",
      decision: "rejected",
      evaluationStatus: "evaluated",
      runtimeFit: "The public API disclaims production use, uptime, and breaking-change notice.",
      licence: "Public API terms do not provide the production and data-handling contract this project requires.",
      versionSelection: "Requests choose a tax-year start year, but responses identify no immutable API, engine, or rule version.",
      reproducibility: "The request cannot carry the payroll or pension facts needed to replay the local corpus.",
      historicalDepth: "The live inventory exposed only 2024, 2025, and 2026 start years when evaluated.",
      failureBehavior: "Not integrated; outages or disagreements cannot replace the local reviewed result.",
      validationFixtureIds: [
        "annual-personal-allowance-taper",
        "annual-scotland-bands",
        "annual-pension-salary-sacrifice",
        "annual-pension-net-pay",
        "annual-pension-relief-at-source",
        "payroll-ni-rate-before-january-2024-cut",
        "payroll-ni-rate-after-january-2024-cut",
      ],
      evidencePaths: [
        "ui/content/projects/personal-finance-app/adrs/006-adopt-taxscope-for-uk-salary-calculations.mdx",
      ],
    },
    {
      provider: "The Finance Toolkit API",
      version: "unversioned-public-listing-observed-2026-11-04",
      decision: "rejected",
      evaluationStatus: "blocked-before-fixture-execution",
      runtimeFit: "A remote salary API is advertised, but there is no approved automated consumer contract.",
      licence: "The site terms prohibit automated and commercial use without written consent; the API listing supplies no provider-specific terms.",
      versionSelection: "The available response provides no immutable calculation or rule version.",
      reproducibility: "Fixture execution stopped at the licensing and lineage boundary.",
      historicalDepth: "No supported historical range could be established under an approved contract.",
      failureBehavior: "Not integrated; local unsupported cases remain unavailable.",
      validationFixtureIds: [],
      evidencePaths: [
        "ui/content/projects/personal-finance-app/adrs/006-adopt-taxscope-for-uk-salary-calculations.mdx",
      ],
    },
  ],
} satisfies z.input<typeof coverageContractSchema>;

export type CoverageContract = z.infer<typeof coverageContractSchema>;

type CoverageClaim = CoverageContract["userFlows"][number]["claims"][number];
type ProviderEvaluation = CoverageContract["providerEvaluations"][number];

type CoverageValidationContext = {
  sourceIds: Set<string>;
  fixtureIds: Set<string>;
  claimIds: Set<string>;
  validatePath: (path: string) => void;
};

function validateClaim(
  claim: CoverageClaim,
  context: CoverageValidationContext,
): void {
  assert(!context.claimIds.has(claim.id), `Duplicate coverage claim ${claim.id}`);
  context.claimIds.add(claim.id);
  for (const path of [
    ...claim.evidence.implementationPaths,
    ...claim.evidence.testPaths,
    ...claim.evidence.fixturePaths,
  ]) {
    context.validatePath(path);
  }
  for (const sourceId of claim.evidence.officialRuleSourceIds) {
    assert(
      context.sourceIds.has(sourceId),
      `${claim.id} references unknown source ${sourceId}`,
    );
  }
  for (const fixtureId of claim.evidence.validationFixtureIds) {
    assert(
      context.fixtureIds.has(fixtureId),
      `${claim.id} references unknown fixture ${fixtureId}`,
    );
  }
  if (claim.status === "implemented" || claim.status === "approximate") {
    assert(
      claim.evidence.implementationPaths.length > 0,
      `${claim.id} has no implementation evidence`,
    );
    assert(
      claim.evidence.testPaths.length > 0,
      `${claim.id} has no test evidence`,
    );
    assert(
      claim.evidence.officialRuleSourceIds.length > 0,
      `${claim.id} has no official-rule evidence`,
    );
    return;
  }
  assert(
    claim.boundaries.length > 0 &&
      (claim.evidence.testPaths.length > 0 ||
        claim.evidence.workGraphTicketIds.length > 0),
    `${claim.id} has no unavailable or untracked evidence`,
  );
}

function validateProviderEvaluation(
  evaluation: ProviderEvaluation,
  context: Pick<CoverageValidationContext, "fixtureIds" | "validatePath">,
): void {
  evaluation.evidencePaths.forEach(context.validatePath);
  for (const fixtureId of evaluation.validationFixtureIds) {
    assert(
      context.fixtureIds.has(fixtureId),
      `${evaluation.provider} references unknown fixture ${fixtureId}`,
    );
  }
  if (evaluation.evaluationStatus === "evaluated") {
    assert(
      evaluation.validationFixtureIds.length > 0,
      `${evaluation.provider} has no fixture evidence`,
    );
  }
}

export function validateCoverageContract(
  packageRoot: string,
  dataset: RuleDataset,
  corpus: ValidationCorpus,
  candidate: unknown = coverageContract,
): CoverageContract {
  const contract = coverageContractSchema.parse(candidate);
  assert.equal(contract.ruleDatasetVersion, dataset.datasetVersion);
  assert.equal(contract.validationCorpusVersion, corpus.corpusVersion);

  const sourceIds = new Set([
    ...dataset.sources.map(({ id }) => id),
    ...corpus.sources.map(({ id }) => id),
  ]);
  const fixtureIds = new Set(corpus.fixtures.map(({ id }) => id));
  const repositoryRoot = resolve(packageRoot, "../..");
  const claimIds = new Set<string>();

  const validatePath = (path: string) => {
    assert(existsSync(resolve(repositoryRoot, path)), `${path} does not exist`);
  };

  for (const ruleSet of contract.externalRuleSets) {
    validatePath(ruleSet.sourceDefinitionPath);
    const definition = readFileSync(
      resolve(repositoryRoot, ruleSet.sourceDefinitionPath),
      "utf8",
    );
    assert(
      definition.includes(ruleSet.version),
      `${ruleSet.id} does not contain version ${ruleSet.version}`,
    );
    for (const sourceId of ruleSet.officialRuleSourceIds) {
      assert(
        definition.includes(sourceId),
        `${ruleSet.id} does not define source ${sourceId}`,
      );
      sourceIds.add(sourceId);
    }
  }

  const context = { sourceIds, fixtureIds, claimIds, validatePath };

  for (const claim of contract.userFlows.flatMap(({ claims }) => claims)) {
    validateClaim(claim, context);
  }

  for (const evaluation of contract.providerEvaluations) {
    validateProviderEvaluation(evaluation, context);
  }

  return contract;
}
