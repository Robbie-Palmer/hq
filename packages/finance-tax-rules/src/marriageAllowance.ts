import { ruleDataset } from "./data";
import type { Jurisdiction } from "./schema";

export const marriageAllowanceSources = [
  {
    id: "income-tax-act-2007-chapter-3a",
    title:
      "Income Tax Act 2007, Part 3, Chapter 3A: transferable tax allowance",
    publisher: "The National Archives",
    url: "https://www.legislation.gov.uk/ukpga/2007/3/part/3/chapter/3A",
  },
  {
    id: "govuk-marriage-allowance",
    title: "Marriage Allowance",
    publisher: "HM Revenue & Customs",
    url: "https://www.gov.uk/marriage-allowance",
  },
  {
    id: "hmrc-paye100060",
    title: "PAYE100060: marriage allowance",
    publisher: "HM Revenue & Customs",
    url: "https://www.gov.uk/hmrc-internal-manuals/paye-manual/paye100060",
  },
  {
    id: "hmrc-income-tax-current-and-past",
    title: "Income Tax rates and allowances for current and previous tax years",
    publisher: "HM Revenue & Customs",
    url: "https://www.gov.uk/government/publications/rates-and-allowances-income-tax/income-tax-rates-and-allowances-current-and-past",
  },
] as const;

type IncomeTaxRule = (typeof ruleDataset.incomeTax)[number];

export type MarriageAllowanceJurisdictionRule = {
  jurisdiction: Jurisdiction;
  incomeTaxRuleId: string;
  standardPersonalAllowancePence: number;
  basicRateBasisPoints: number;
  eligibleNonSavingsBandNames: string[];
};

export type MarriageAllowanceRule = {
  id: string;
  version: "1";
  taxYear: string;
  effectiveFrom: string;
  effectiveTo: string;
  transferableAllowancePence: number;
  maximumRecipientReductionPence: number;
  jurisdictions: MarriageAllowanceJurisdictionRule[];
  application: {
    currentYearEffectiveFrom: "tax-year-start";
    continuesAutomatically: true;
    retrospectiveDeadlineYears: 4;
    retrospectiveClaimContinues: false;
  };
  cancellation: {
    incomeChange: "end-of-tax-year";
    voluntary: "end-of-tax-year";
    relationshipEnd: "may-backdate-to-tax-year-start";
  };
  provenance: {
    sourceIds: string[];
    reviewedAt: string;
  };
};

const supportedJurisdictions: Jurisdiction[] = [
  "england-and-northern-ireland",
  "scotland",
  "wales",
];

const ruleForJurisdiction = (
  taxYear: string,
  jurisdiction: Jurisdiction,
): IncomeTaxRule => {
  const rules = ruleDataset.incomeTax.filter(
    (rule) =>
      rule.taxYear === taxYear &&
      rule.legalStatus === "enacted" &&
      rule.jurisdictions.includes(jurisdiction),
  );
  if (rules.length !== 1 || rules[0] == null) {
    throw new Error(
      `${taxYear} must have one enacted Income Tax rule for ${jurisdiction}`,
    );
  }
  return rules[0];
};

const transferableAmount = (personalAllowancePence: number): number =>
  Math.ceil(personalAllowancePence / 10_000) * 1_000;

const taxYears = [
  ...new Set(ruleDataset.incomeTax.map(({ taxYear }) => taxYear)),
].toSorted((left, right) => left.localeCompare(right));

const marriageAllowanceRules: MarriageAllowanceRule[] = taxYears.map(
  (taxYear) => {
    const jurisdictions = supportedJurisdictions.map((jurisdiction) => {
      const incomeTaxRule = ruleForJurisdiction(taxYear, jurisdiction);
      const basicRate = incomeTaxRule.bands.find(({ name }) => name === "basic");
      if (basicRate == null) {
        throw new Error(`${incomeTaxRule.id} has no basic rate`);
      }
      return {
        jurisdiction,
        incomeTaxRuleId: incomeTaxRule.id,
        standardPersonalAllowancePence:
          incomeTaxRule.standardPersonalAllowancePence,
        basicRateBasisPoints: basicRate.rateBasisPoints,
        eligibleNonSavingsBandNames:
          jurisdiction === "scotland"
            ? incomeTaxRule.bands
                .map(({ name }) => name)
                .filter((name) =>
                  ["starter", "basic", "intermediate"].includes(name),
                )
            : ["basic"],
      } satisfies MarriageAllowanceJurisdictionRule;
    });
    const personalAllowances = new Set(
      jurisdictions.map(({ standardPersonalAllowancePence }) =>
        standardPersonalAllowancePence,
      ),
    );
    const basicRates = new Set(
      jurisdictions.map(({ basicRateBasisPoints }) => basicRateBasisPoints),
    );
    if (personalAllowances.size !== 1 || basicRates.size !== 1) {
      throw new Error(
        `${taxYear} Marriage Allowance needs one UK Personal Allowance and basic rate`,
      );
    }
    const personalAllowancePence =
      jurisdictions[0]?.standardPersonalAllowancePence ?? 0;
    const basicRateBasisPoints = jurisdictions[0]?.basicRateBasisPoints ?? 0;
    const transferableAllowancePence = transferableAmount(
      personalAllowancePence,
    );
    return {
      id: `marriage-allowance-${taxYear}`,
      version: "1",
      taxYear,
      effectiveFrom: jurisdictions.length > 0
        ? ruleForJurisdiction(taxYear, jurisdictions[0]?.jurisdiction ?? "wales")
            .effectiveFrom
        : "",
      effectiveTo: jurisdictions.length > 0
        ? ruleForJurisdiction(taxYear, jurisdictions[0]?.jurisdiction ?? "wales")
            .effectiveTo
        : "",
      transferableAllowancePence,
      maximumRecipientReductionPence: Math.round(
        (transferableAllowancePence * basicRateBasisPoints) / 10_000,
      ),
      jurisdictions,
      application: {
        currentYearEffectiveFrom: "tax-year-start",
        continuesAutomatically: true,
        retrospectiveDeadlineYears: 4,
        retrospectiveClaimContinues: false,
      },
      cancellation: {
        incomeChange: "end-of-tax-year",
        voluntary: "end-of-tax-year",
        relationshipEnd: "may-backdate-to-tax-year-start",
      },
      provenance: {
        sourceIds: marriageAllowanceSources.map(({ id }) => id),
        reviewedAt: "2026-11-06",
      },
    };
  },
);

export const marriageAllowanceRuleSet = {
  ruleSetVersion: "2026.11.0",
  ruleDatasetVersion: ruleDataset.datasetVersion,
  releasedAt: "2026-11-06",
  sources: marriageAllowanceSources,
  rules: marriageAllowanceRules,
} as const;

export type MarriageAllowanceRelationship =
  | "married"
  | "civil-partnership"
  | "neither";

export type OtherIncomeRatePosition =
  | "none"
  | "eligible-rates-only"
  | "disqualifying-rate";

export type MarriageAllowancePerson = {
  jurisdiction: string;
  meetsResidenceRequirements: boolean | null;
  hasDisqualifyingPersonalAllowanceClaim: boolean | null;
  personalAllowanceBasis: "standard" | "non-standard" | null;
  annualNonSavingsNonDividendIncomePence: number | null;
  otherIncomeRatePosition: OtherIncomeRatePosition | null;
};

export type MarriageAllowanceDonor = MarriageAllowancePerson & {
  entitledToPersonalAllowance: boolean | null;
};

export type MarriageAllowanceClaim =
  | { kind: "new-current-year"; claimDate: string | null }
  | { kind: "continuing" }
  | { kind: "retrospective"; claimDate: string | null };

export type MarriageAllowanceCancellation = {
  reason: "income-change" | "voluntary" | "relationship-ended";
  noticeDate: string | null;
  relationshipEndTreatment?: "tax-year-start" | "tax-year-end" | null;
};

export type MarriageAllowanceDeath = {
  person: "donor" | "recipient";
  date: string;
};

export type MarriageAllowanceRequest = {
  taxYear: string;
  relationship: MarriageAllowanceRelationship | null;
  partnersForPartOfTaxYear: boolean | null;
  partnersAtClaim: boolean | null;
  marriedCouplesAllowanceClaimed: boolean | null;
  donorHasAnotherActiveElection: boolean | null;
  recipientHasAnotherActiveClaim: boolean | null;
  donor: MarriageAllowanceDonor;
  recipient: MarriageAllowancePerson;
  claim: MarriageAllowanceClaim;
  cancellation: MarriageAllowanceCancellation | null;
  death: MarriageAllowanceDeath | null;
};

export type MarriageAllowanceIssueCode =
  | "unsupported-tax-year"
  | "unsupported-jurisdiction"
  | "invalid-input"
  | "missing-statutory-fact"
  | "not-married-or-civil-partners"
  | "not-partners-during-tax-year"
  | "not-partners-at-claim"
  | "married-couples-allowance-claimed"
  | "donor-not-entitled-to-personal-allowance"
  | "residence-requirement-not-met"
  | "disqualifying-personal-allowance-claim"
  | "disqualifying-tax-rate"
  | "another-election-or-claim"
  | "backdating-deadline-passed"
  | "claim-kind-does-not-match-date"
  | "cancelled-for-tax-year"
  | "relationship-end-treatment-unknown";

export type MarriageAllowanceIssue = {
  code: MarriageAllowanceIssueCode;
  detail: string;
};

export type MarriageAllowanceClaimTreatment = {
  kind: MarriageAllowanceClaim["kind"];
  appliesForTaxYear: boolean | null;
  effectiveFrom: string;
  effectiveTo: string;
  backdatingDeadline: string;
  continuesAutomatically: boolean;
  cancellationEffect:
    | "none"
    | "ends-after-tax-year"
    | "cancelled-from-tax-year-start"
    | "relationship-end-treatment-required";
  deathEffect:
    | "none"
    | "donor-allowance-remains-reduced"
    | "donor-allowance-restored";
};

type TaxBandSlice = {
  name: string;
  amountPence: number;
  rateBasisPoints: number;
  taxPence: number;
};

export type MarriageAllowanceTaxImpact =
  | {
      available: false;
      issues: MarriageAllowanceIssue[];
    }
  | {
      available: true;
      donor: {
        allowanceBeforePence: number;
        allowanceAfterPence: number;
        taxBeforePence: number;
        taxAfterPence: number;
        taxDeltaPence: number;
        taxAfterBands: TaxBandSlice[];
      };
      recipient: {
        taxBeforePence: number;
        taxAfterPence: number;
        taxDeltaPence: number;
        maximumReductionPence: number;
        actualReductionPence: number;
        taxBeforeBands: TaxBandSlice[];
      };
      household: {
        taxBeforePence: number;
        taxAfterPence: number;
        taxDeltaPence: number;
        netSavingPence: number;
      };
    };

export type MarriageAllowanceResult = {
  status: "eligible" | "ineligible" | "unknown";
  taxYear: string;
  issues: MarriageAllowanceIssue[];
  claimTreatment: MarriageAllowanceClaimTreatment | null;
  taxImpact: MarriageAllowanceTaxImpact;
  lineage: null | {
    ruleSetVersion: string;
    ruleDatasetVersion: string;
    ruleId: string;
    ruleVersion: string;
    incomeTaxRuleIds: string[];
    sourceIds: string[];
    sources: typeof marriageAllowanceSources;
  };
};

const unknown = (
  code: MarriageAllowanceIssueCode,
  detail: string,
): MarriageAllowanceIssue => ({ code, detail });

const isMoney = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isRealDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  );
};

const plusYears = (date: string, years: number): string => {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCFullYear(parsed.getUTCFullYear() + years);
  return parsed.toISOString().slice(0, 10);
};

const marriageRuleFor = (taxYear: string): MarriageAllowanceRule | null =>
  marriageAllowanceRules.find((rule) => rule.taxYear === taxYear) ?? null;

const jurisdictionRuleFor = (
  rule: MarriageAllowanceRule,
  jurisdiction: string,
): MarriageAllowanceJurisdictionRule | null =>
  rule.jurisdictions.find(
    (candidate) => candidate.jurisdiction === jurisdiction,
  ) ?? null;

const incomeTaxRuleFor = (id: string): IncomeTaxRule => {
  const rule = ruleDataset.incomeTax.find((candidate) => candidate.id === id);
  if (rule == null) throw new Error(`Missing Income Tax rule ${id}`);
  return rule;
};

const taxWithAllowance = (
  incomePence: number,
  allowancePence: number,
  rule: IncomeTaxRule,
): { totalPence: number; bands: TaxBandSlice[] } => {
  let remaining = Math.max(0, incomePence - allowancePence);
  const bands: TaxBandSlice[] = [];
  for (const band of rule.bands) {
    const amountPence = Math.min(
      remaining,
      band.widthPence ?? remaining,
    );
    if (amountPence > 0) {
      bands.push({
        name: band.name,
        amountPence,
        rateBasisPoints: band.rateBasisPoints,
        taxPence: Math.round(
          (amountPence * band.rateBasisPoints) / 10_000,
        ),
      });
      remaining -= amountPence;
    }
    if (remaining === 0) break;
  }
  return {
    totalPence: bands.reduce((total, band) => total + band.taxPence, 0),
    bands,
  };
};

type ClaimAssessment = {
  appliesForTaxYear: boolean | null;
  unknownIssues: MarriageAllowanceIssue[];
  ineligibleIssues: MarriageAllowanceIssue[];
};

const claimDateAssessment = (
  claim: MarriageAllowanceClaim,
  rule: MarriageAllowanceRule,
  deadline: string,
): ClaimAssessment => {
  if (claim.kind === "continuing") {
    return { appliesForTaxYear: true, unknownIssues: [], ineligibleIssues: [] };
  }
  if (claim.claimDate == null) {
    return {
      appliesForTaxYear: null,
      unknownIssues: [
        unknown("missing-statutory-fact", "The claim date is required."),
      ],
      ineligibleIssues: [],
    };
  }
  if (!isRealDate(claim.claimDate)) {
    return {
      appliesForTaxYear: null,
      unknownIssues: [
        unknown("invalid-input", "The claim date must be a real ISO date."),
      ],
      ineligibleIssues: [],
    };
  }
  const wrongCurrentYear =
    claim.kind === "new-current-year" &&
    (claim.claimDate < rule.effectiveFrom || claim.claimDate > rule.effectiveTo);
  const retrospectiveBeforeYearEnd =
    claim.kind === "retrospective" && claim.claimDate <= rule.effectiveTo;
  if (wrongCurrentYear || retrospectiveBeforeYearEnd) {
    const detail = wrongCurrentYear
      ? `${claim.claimDate} is outside ${rule.taxYear}; use a retrospective claim after the tax year ends.`
      : `${claim.claimDate} is not after the end of ${rule.taxYear}.`;
    return {
      appliesForTaxYear: false,
      unknownIssues: [],
      ineligibleIssues: [unknown("claim-kind-does-not-match-date", detail)],
    };
  }
  if (claim.kind === "retrospective" && claim.claimDate > deadline) {
    return {
      appliesForTaxYear: false,
      unknownIssues: [],
      ineligibleIssues: [
        unknown(
          "backdating-deadline-passed",
          `${rule.taxYear} could be claimed no later than ${deadline}.`,
        ),
      ],
    };
  }
  return { appliesForTaxYear: true, unknownIssues: [], ineligibleIssues: [] };
};

type CancellationAssessment = ClaimAssessment & {
  effect: MarriageAllowanceClaimTreatment["cancellationEffect"];
};

const relationshipEndCancellation = (
  cancellation: MarriageAllowanceCancellation,
  rule: MarriageAllowanceRule,
): CancellationAssessment => {
  if (cancellation.relationshipEndTreatment == null) {
    return {
      appliesForTaxYear: null,
      effect: "relationship-end-treatment-required",
      unknownIssues: [
        unknown(
          "relationship-end-treatment-unknown",
          "HMRC may backdate a relationship-end cancellation to the tax-year start; record the applied treatment before recalculating.",
        ),
      ],
      ineligibleIssues: [],
    };
  }
  if (cancellation.relationshipEndTreatment === "tax-year-start") {
    return {
      appliesForTaxYear: false,
      effect: "cancelled-from-tax-year-start",
      unknownIssues: [],
      ineligibleIssues: [
        unknown(
          "cancelled-for-tax-year",
          `The relationship-end cancellation was applied from ${rule.effectiveFrom}.`,
        ),
      ],
    };
  }
  return {
    appliesForTaxYear: true,
    effect: "ends-after-tax-year",
    unknownIssues: [],
    ineligibleIssues: [],
  };
};

const cancellationAssessment = (
  cancellation: MarriageAllowanceCancellation | null,
  rule: MarriageAllowanceRule,
): CancellationAssessment => {
  const noEffect: CancellationAssessment = {
    appliesForTaxYear: true,
    effect: "none",
    unknownIssues: [],
    ineligibleIssues: [],
  };
  if (cancellation == null) {
    return noEffect;
  }
  if (cancellation.noticeDate == null || !isRealDate(cancellation.noticeDate)) {
    const code = cancellation.noticeDate == null
      ? "missing-statutory-fact"
      : "invalid-input";
    return {
      appliesForTaxYear: null,
      effect: "none",
      unknownIssues: [
        unknown(code, "The cancellation notice date must be a real ISO date."),
      ],
      ineligibleIssues: [],
    };
  }
  if (cancellation.noticeDate > rule.effectiveTo) return noEffect;
  if (cancellation.noticeDate < rule.effectiveFrom) {
    return {
      appliesForTaxYear: false,
      effect: "cancelled-from-tax-year-start",
      unknownIssues: [],
      ineligibleIssues: [
        unknown(
          "cancelled-for-tax-year",
          `The election was cancelled before ${rule.taxYear} began.`,
        ),
      ],
    };
  }
  return cancellation.reason === "relationship-ended"
    ? relationshipEndCancellation(cancellation, rule)
    : {
        appliesForTaxYear: true,
        effect: "ends-after-tax-year",
        unknownIssues: [],
        ineligibleIssues: [],
      };
};

type DeathAssessment = {
  appliesForTaxYear: boolean | null;
  effect: MarriageAllowanceClaimTreatment["deathEffect"];
  unknownIssues: MarriageAllowanceIssue[];
};

const deathAssessment = (
  death: MarriageAllowanceDeath | null,
  rule: MarriageAllowanceRule,
): DeathAssessment => {
  if (death == null) {
    return { appliesForTaxYear: true, effect: "none", unknownIssues: [] };
  }
  if (!isRealDate(death.date)) {
    return {
      appliesForTaxYear: null,
      effect: "none",
      unknownIssues: [
        unknown("invalid-input", "The death date must be a real ISO date."),
      ],
    };
  }
  if (death.date > rule.effectiveTo) {
    return { appliesForTaxYear: true, effect: "none", unknownIssues: [] };
  }
  const effect = death.person === "recipient"
    ? "donor-allowance-restored"
    : "donor-allowance-remains-reduced";
  return { appliesForTaxYear: true, effect, unknownIssues: [] };
};

const combinedApplicability = (
  values: Array<boolean | null>,
): boolean | null => {
  if (values.includes(false)) return false;
  return values.includes(null) ? null : true;
};

const claimTreatment = (
  request: MarriageAllowanceRequest,
  rule: MarriageAllowanceRule,
) => {
  const deadline = plusYears(
    rule.effectiveTo,
    rule.application.retrospectiveDeadlineYears,
  );
  const claim = claimDateAssessment(request.claim, rule, deadline);
  const cancellation = cancellationAssessment(request.cancellation, rule);
  const death = deathAssessment(request.death, rule);
  const appliesForTaxYear = combinedApplicability([
    claim.appliesForTaxYear,
    cancellation.appliesForTaxYear,
    death.appliesForTaxYear,
  ]);
  return {
    value: {
      kind: request.claim.kind,
      appliesForTaxYear,
      effectiveFrom: rule.effectiveFrom,
      effectiveTo: rule.effectiveTo,
      backdatingDeadline: deadline,
      continuesAutomatically:
        request.claim.kind !== "retrospective" && appliesForTaxYear !== false,
      cancellationEffect: cancellation.effect,
      deathEffect: death.effect,
    } satisfies MarriageAllowanceClaimTreatment,
    unknownIssues: [
      ...claim.unknownIssues,
      ...cancellation.unknownIssues,
      ...death.unknownIssues,
    ],
    ineligibleIssues: [
      ...claim.ineligibleIssues,
      ...cancellation.ineligibleIssues,
    ],
  };
};

const missingBoolean = (
  value: boolean | null,
  detail: string,
): MarriageAllowanceIssue[] =>
  value == null ? [unknown("missing-statutory-fact", detail)] : [];

const impactUnavailable = (
  issues: MarriageAllowanceIssue[],
): MarriageAllowanceTaxImpact => ({ available: false, issues });

type IssueAssessment = {
  unknownIssues: MarriageAllowanceIssue[];
  ineligibleIssues: MarriageAllowanceIssue[];
};

type ResolvedJurisdictions = {
  donor: MarriageAllowanceJurisdictionRule | null;
  recipient: MarriageAllowanceJurisdictionRule | null;
  issues: MarriageAllowanceIssue[];
};

const jurisdictionAssessment = (
  request: MarriageAllowanceRequest,
  rule: MarriageAllowanceRule,
): ResolvedJurisdictions => {
  const donor = jurisdictionRuleFor(rule, request.donor.jurisdiction);
  const recipient = jurisdictionRuleFor(rule, request.recipient.jurisdiction);
  const issues = [
    donor == null
      ? unknown(
          "unsupported-jurisdiction",
          `${request.donor.jurisdiction} has no reviewed donor rule for ${request.taxYear}.`,
        )
      : null,
    recipient == null
      ? unknown(
          "unsupported-jurisdiction",
          `${request.recipient.jurisdiction} has no reviewed recipient rule for ${request.taxYear}.`,
        )
      : null,
  ].filter((issue): issue is MarriageAllowanceIssue => issue != null);
  return { donor, recipient, issues };
};

const relationshipAssessment = (
  request: MarriageAllowanceRequest,
): IssueAssessment => ({
  unknownIssues: request.relationship == null
    ? [unknown("missing-statutory-fact", "The legal relationship is required.")]
    : [],
  ineligibleIssues: [
    request.relationship === "neither"
      ? unknown(
          "not-married-or-civil-partners",
          "Marriage Allowance requires a marriage or civil partnership.",
        )
      : null,
    request.partnersForPartOfTaxYear === false
      ? unknown(
          "not-partners-during-tax-year",
          "The couple were not married or civil partners during the tax year.",
        )
      : null,
    request.partnersAtClaim === false && request.death == null
      ? unknown(
          "not-partners-at-claim",
          "The couple were not married or civil partners when the claim was made.",
        )
      : null,
  ].filter((issue): issue is MarriageAllowanceIssue => issue != null),
});

const missingEligibilityFacts = (
  request: MarriageAllowanceRequest,
): MarriageAllowanceIssue[] => [
  ...missingBoolean(
    request.partnersForPartOfTaxYear,
    "State whether the couple were partners for part of the tax year.",
  ),
  ...missingBoolean(
    request.partnersAtClaim,
    "State whether the couple were partners when the claim was made.",
  ),
  ...missingBoolean(
    request.marriedCouplesAllowanceClaimed,
    "State whether either partner claimed Married Couple's Allowance.",
  ),
  ...missingBoolean(
    request.donorHasAnotherActiveElection,
    "State whether the donor has another active Marriage Allowance election.",
  ),
  ...missingBoolean(
    request.recipientHasAnotherActiveClaim,
    "State whether the recipient has another active Marriage Allowance claim.",
  ),
  ...missingBoolean(
    request.donor.meetsResidenceRequirements,
    "The donor's Personal Allowance residence position is required.",
  ),
  ...missingBoolean(
    request.recipient.meetsResidenceRequirements,
    "The recipient's residence position is required.",
  ),
  ...missingBoolean(
    request.donor.hasDisqualifyingPersonalAllowanceClaim,
    "State whether the donor made a claim or election that removes Personal Allowance entitlement.",
  ),
  ...missingBoolean(
    request.recipient.hasDisqualifyingPersonalAllowanceClaim,
    "State whether the recipient made a claim or election that removes Marriage Allowance entitlement.",
  ),
  ...missingBoolean(
    request.donor.entitledToPersonalAllowance,
    "State whether the donor is entitled to a Personal Allowance.",
  ),
];

const failedEligibilityConditions = (
  request: MarriageAllowanceRequest,
): MarriageAllowanceIssue[] => [
  request.marriedCouplesAllowanceClaimed === true
    ? unknown(
        "married-couples-allowance-claimed",
        "Marriage Allowance and Married Couple's Allowance cannot both apply for the tax year.",
      )
    : null,
  request.donor.entitledToPersonalAllowance === false
    ? unknown(
        "donor-not-entitled-to-personal-allowance",
        "The donor must be entitled to a Personal Allowance.",
      )
    : null,
  request.donor.meetsResidenceRequirements === false ||
  request.recipient.meetsResidenceRequirements === false
    ? unknown(
        "residence-requirement-not-met",
        "Both recorded residence positions must meet the statutory conditions.",
      )
    : null,
  request.donor.hasDisqualifyingPersonalAllowanceClaim === true ||
  request.recipient.hasDisqualifyingPersonalAllowanceClaim === true
    ? unknown(
        "disqualifying-personal-allowance-claim",
        "A remittance-basis or foreign-income-regime claim or election removes entitlement for this tax year.",
      )
    : null,
  request.donorHasAnotherActiveElection === true ||
  request.recipientHasAnotherActiveClaim === true
    ? unknown(
        "another-election-or-claim",
        "A person cannot have more than one Marriage Allowance election or reduction for a tax year.",
      )
    : null,
].filter((issue): issue is MarriageAllowanceIssue => issue != null);

const personAssessment = (
  label: "donor" | "recipient",
  person: MarriageAllowancePerson,
): IssueAssessment => {
  const unknownIssues: MarriageAllowanceIssue[] = [];
  if (person.personalAllowanceBasis !== "standard") {
    const detail = person.personalAllowanceBasis == null
      ? `The ${label}'s Personal Allowance basis is required.`
      : `The ${label}'s non-standard allowance requires a tax-liability amount outside this calculator's standard Personal Allowance scope.`;
    unknownIssues.push(unknown("missing-statutory-fact", detail));
  }
  if (!isMoney(person.annualNonSavingsNonDividendIncomePence)) {
    const code = person.annualNonSavingsNonDividendIncomePence == null
      ? "missing-statutory-fact"
      : "invalid-input";
    unknownIssues.push(
      unknown(
        code,
        `The ${label}'s annual non-savings, non-dividend income must be a non-negative whole-pence amount.`,
      ),
    );
  }
  if (person.otherIncomeRatePosition == null) {
    unknownIssues.push(
      unknown(
        "missing-statutory-fact",
        `The ${label}'s savings, dividend, property, and other-income rate position is required.`,
      ),
    );
  }
  const ineligibleIssues = person.otherIncomeRatePosition === "disqualifying-rate"
    ? [
        unknown(
          "disqualifying-tax-rate",
          `The ${label} is liable at a rate outside the Marriage Allowance permitted rates.`,
        ),
      ]
    : [];
  return { unknownIssues, ineligibleIssues };
};

const nonSavingsRateIssue = (
  role: "donor" | "recipient",
  person: MarriageAllowancePerson,
  jurisdiction: MarriageAllowanceJurisdictionRule | null,
  marriageRule: MarriageAllowanceRule,
): MarriageAllowanceIssue | null => {
  if (
    jurisdiction == null ||
    person.personalAllowanceBasis !== "standard" ||
    !isMoney(person.annualNonSavingsNonDividendIncomePence)
  ) {
    return null;
  }
  const allowance = role === "donor"
    ? Math.max(
        0,
        jurisdiction.standardPersonalAllowancePence -
          marriageRule.transferableAllowancePence,
      )
    : jurisdiction.standardPersonalAllowancePence;
  const tax = taxWithAllowance(
    person.annualNonSavingsNonDividendIncomePence,
    allowance,
    incomeTaxRuleFor(jurisdiction.incomeTaxRuleId),
  );
  const disqualified = tax.bands.some(
    ({ name }) => !jurisdiction.eligibleNonSavingsBandNames.includes(name),
  );
  if (!disqualified) return null;
  const detail = role === "donor"
    ? "The donor would be liable above the permitted non-savings rates after the transfer."
    : "The recipient is liable above the permitted non-savings rates.";
  return unknown("disqualifying-tax-rate", detail);
};

const lineageFor = (
  rule: MarriageAllowanceRule,
  jurisdictions: ResolvedJurisdictions,
): NonNullable<MarriageAllowanceResult["lineage"]> => ({
  ruleSetVersion: marriageAllowanceRuleSet.ruleSetVersion,
  ruleDatasetVersion: marriageAllowanceRuleSet.ruleDatasetVersion,
  ruleId: rule.id,
  ruleVersion: rule.version,
  incomeTaxRuleIds: [
    jurisdictions.donor?.incomeTaxRuleId,
    jurisdictions.recipient?.incomeTaxRuleId,
  ].filter((id): id is string => id != null),
  sourceIds: [...rule.provenance.sourceIds],
  sources: marriageAllowanceSources,
});

const exactTaxImpact = (
  request: MarriageAllowanceRequest,
  rule: MarriageAllowanceRule,
  donorJurisdiction: MarriageAllowanceJurisdictionRule,
  recipientJurisdiction: MarriageAllowanceJurisdictionRule,
  treatment: MarriageAllowanceClaimTreatment,
): MarriageAllowanceTaxImpact => {
  if (
    request.donor.otherIncomeRatePosition !== "none" ||
    request.recipient.otherIncomeRatePosition !== "none"
  ) {
    return impactUnavailable([
      unknown(
        "missing-statutory-fact",
        "An exact household delta needs complete tax liabilities when either partner has savings, dividends, property, or other taxable income.",
      ),
    ]);
  }
  const donorIncomeRule = incomeTaxRuleFor(donorJurisdiction.incomeTaxRuleId);
  const recipientIncomeRule = incomeTaxRuleFor(
    recipientJurisdiction.incomeTaxRuleId,
  );
  const donorIncome = request.donor.annualNonSavingsNonDividendIncomePence ?? 0;
  const recipientIncome =
    request.recipient.annualNonSavingsNonDividendIncomePence ?? 0;
  const donorBefore = taxWithAllowance(
    donorIncome,
    donorJurisdiction.standardPersonalAllowancePence,
    donorIncomeRule,
  );
  const donorAllowanceAfter = treatment.deathEffect === "donor-allowance-restored"
    ? donorJurisdiction.standardPersonalAllowancePence
    : donorJurisdiction.standardPersonalAllowancePence -
      rule.transferableAllowancePence;
  const donorAfter = taxWithAllowance(
    donorIncome,
    donorAllowanceAfter,
    donorIncomeRule,
  );
  const recipientBefore = taxWithAllowance(
    recipientIncome,
    recipientJurisdiction.standardPersonalAllowancePence,
    recipientIncomeRule,
  );
  const recipientReduction = Math.min(
    recipientBefore.totalPence,
    rule.maximumRecipientReductionPence,
  );
  const recipientAfterPence = recipientBefore.totalPence - recipientReduction;
  const donorDelta = donorAfter.totalPence - donorBefore.totalPence;
  const householdBefore = donorBefore.totalPence + recipientBefore.totalPence;
  const householdAfter = donorAfter.totalPence + recipientAfterPence;
  return {
    available: true,
    donor: {
      allowanceBeforePence: donorJurisdiction.standardPersonalAllowancePence,
      allowanceAfterPence: donorAllowanceAfter,
      taxBeforePence: donorBefore.totalPence,
      taxAfterPence: donorAfter.totalPence,
      taxDeltaPence: donorDelta,
      taxAfterBands: donorAfter.bands,
    },
    recipient: {
      taxBeforePence: recipientBefore.totalPence,
      taxAfterPence: recipientAfterPence,
      taxDeltaPence: -recipientReduction,
      maximumReductionPence: rule.maximumRecipientReductionPence,
      actualReductionPence: recipientReduction,
      taxBeforeBands: recipientBefore.bands,
    },
    household: {
      taxBeforePence: householdBefore,
      taxAfterPence: householdAfter,
      taxDeltaPence: householdAfter - householdBefore,
      netSavingPence: householdBefore - householdAfter,
    },
  };
};

const unsupportedTaxYearResult = (
  request: MarriageAllowanceRequest,
): MarriageAllowanceResult => {
  const issue = unknown(
    "unsupported-tax-year",
    `${request.taxYear} is outside the enacted 2015-16 to 2026-27 Marriage Allowance rules.`,
  );
  return {
    status: "unknown",
    taxYear: request.taxYear,
    issues: [issue],
    claimTreatment: null,
    taxImpact: impactUnavailable([issue]),
    lineage: null,
  };
};

export function calculateMarriageAllowance(
  request: MarriageAllowanceRequest,
): MarriageAllowanceResult {
  const rule = marriageRuleFor(request.taxYear);
  if (rule == null) return unsupportedTaxYearResult(request);

  const jurisdictions = jurisdictionAssessment(request, rule);
  const treatment = claimTreatment(request, rule);
  const relationship = relationshipAssessment(request);
  const donor = personAssessment("donor", request.donor);
  const recipient = personAssessment("recipient", request.recipient);
  const rateIssues = [
    nonSavingsRateIssue("donor", request.donor, jurisdictions.donor, rule),
    nonSavingsRateIssue(
      "recipient",
      request.recipient,
      jurisdictions.recipient,
      rule,
    ),
  ].filter((issue): issue is MarriageAllowanceIssue => issue != null);
  const unknownIssues = [
    ...jurisdictions.issues,
    ...treatment.unknownIssues,
    ...relationship.unknownIssues,
    ...missingEligibilityFacts(request),
    ...donor.unknownIssues,
    ...recipient.unknownIssues,
  ];
  const ineligibleIssues = [
    ...treatment.ineligibleIssues,
    ...relationship.ineligibleIssues,
    ...failedEligibilityConditions(request),
    ...donor.ineligibleIssues,
    ...recipient.ineligibleIssues,
    ...rateIssues,
  ];
  const lineage = lineageFor(rule, jurisdictions);

  if (ineligibleIssues.length > 0) {
    return {
      status: "ineligible",
      taxYear: request.taxYear,
      issues: ineligibleIssues,
      claimTreatment: treatment.value,
      taxImpact: impactUnavailable(ineligibleIssues),
      lineage,
    };
  }
  if (unknownIssues.length > 0) {
    return {
      status: "unknown",
      taxYear: request.taxYear,
      issues: unknownIssues,
      claimTreatment: treatment.value,
      taxImpact: impactUnavailable(unknownIssues),
      lineage,
    };
  }
  if (jurisdictions.donor == null || jurisdictions.recipient == null) {
    throw new Error("Jurisdictions were validated but not resolved");
  }
  return {
    status: "eligible",
    taxYear: request.taxYear,
    issues: [],
    claimTreatment: treatment.value,
    taxImpact: exactTaxImpact(
      request,
      rule,
      jurisdictions.donor,
      jurisdictions.recipient,
      treatment.value,
    ),
    lineage,
  };
}
