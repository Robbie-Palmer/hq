import rulesArtifactJson from "../artifacts/uk-side-income-rules-2026-10-31.json";
import { z } from "zod";
import {
  IdentifierSchema,
  IsoDateSchema,
  MoneySchema,
  SupportedSideIncomeJurisdictionSchema,
  TaxYearSchema,
} from "./sideIncome";

export const UK_SIDE_INCOME_RULESET_VERSION = "2026-10-31" as const;

export const OfficialSourceSchema = z
  .object({
    publisher: z.literal("GOV.UK"),
    title: z.string().trim().min(1),
    url: z.url().refine((url) => new URL(url).hostname === "www.gov.uk", {
      message: "Rule sources must use an official GOV.UK page",
    }),
    checkedOn: IsoDateSchema,
  })
  .strict();

export const RuleApplicabilitySchema = z
  .object({
    jurisdiction: SupportedSideIncomeJurisdictionSchema,
    effectiveFrom: IsoDateSchema.nullable(),
    effectiveTo: IsoDateSchema.nullable(),
    structures: z.array(
      z.enum(["sole-trader", "uk-limited-company", "umbrella-employment"]),
    ),
    activityKinds: z.array(
      z.enum([
        "product-sales",
        "subscription-sales",
        "freelance-services",
        "contracting-services",
      ]),
    ),
    notes: z.array(z.string().trim().min(1)),
  })
  .strict();

export const RuleTestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("threshold"),
      measure: z.enum([
        "annual-gross-trading-income",
        "trailing-twelve-month-taxable-turnover",
        "expected-next-thirty-day-taxable-turnover",
        "prior-return-qualifying-income",
      ]),
      comparison: z.literal("more-than"),
      amount: MoneySchema,
      referenceTaxYear: TaxYearSchema.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("duty"),
      trigger: z.enum([
        "company-exists",
        "company-pays-salary-benefits-or-expenses",
        "company-pays-dividend",
        "umbrella-arrangement-used",
        "umbrella-payment-on-or-after-date",
      ]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("contract-assessment"),
      trigger: z.literal("services-through-intermediary"),
      assessmentScope: z.literal("each-contract"),
    })
    .strict(),
]);

export const SideIncomeRuleSchema = z
  .object({
    id: IdentifierSchema,
    version: z.string().trim().min(1),
    topic: z.enum([
      "sole-trader-registration",
      "trading-allowance",
      "company-formation",
      "company-reporting",
      "company-withdrawals",
      "payroll",
      "vat",
      "making-tax-digital",
      "off-payroll-working",
      "umbrella-employment",
    ]),
    applicability: RuleApplicabilitySchema,
    test: RuleTestSchema,
    outcome: z.string().trim().min(1),
    source: OfficialSourceSchema,
  })
  .strict();
export type SideIncomeRule = z.infer<typeof SideIncomeRuleSchema>;

const SourceCatalogEntrySchema = OfficialSourceSchema.extend({
  id: IdentifierSchema,
}).strict();

const SideIncomeRuleRecordSchema = SideIncomeRuleSchema.omit({
  source: true,
})
  .extend({ sourceId: IdentifierSchema })
  .strict();

const SideIncomeRulesArtifactSchema = z
  .object({
    rulesetVersion: z.literal(UK_SIDE_INCOME_RULESET_VERSION),
    sources: z.array(SourceCatalogEntrySchema).min(1),
    rules: z.array(SideIncomeRuleRecordSchema).min(1),
  })
  .strict();

const rulesArtifact: unknown = rulesArtifactJson;
const parsedArtifact = SideIncomeRulesArtifactSchema.parse(rulesArtifact);
const sourcesById = new Map(
  parsedArtifact.sources.map(({ id, ...source }) => [id, source]),
);

export const ukSideIncomeRules = parsedArtifact.rules.map(
  ({ sourceId, ...rule }) => {
    const source = sourcesById.get(sourceId);
    if (source === undefined) {
      throw new Error(`Unknown side-income rule source: ${sourceId}`);
    }
    return SideIncomeRuleSchema.parse({ ...rule, source });
  },
);

export function findSideIncomeRule(id: string): SideIncomeRule {
  const rule = ukSideIncomeRules.find((candidate) => candidate.id === id);
  if (rule === undefined) throw new Error(`Unknown side-income rule: ${id}`);
  return rule;
}
