import { ruleDataset } from "./data";
import type { Jurisdiction } from "./schema";

export const pensionAnnualAllowanceSources = [
  {
    id: "hmrc-ptm057100",
    title: "PTM057100: tapered annual allowance",
    url: "https://www.gov.uk/hmrc-internal-manuals/pensions-tax-manual/ptm057100",
  },
  {
    id: "hmrc-ptm055100",
    title: "PTM055100: carry forward",
    url: "https://www.gov.uk/hmrc-internal-manuals/pensions-tax-manual/ptm055100",
  },
  {
    id: "hmrc-ptm056510",
    title: "PTM056510: money purchase annual allowance",
    url: "https://www.gov.uk/hmrc-internal-manuals/pensions-tax-manual/ptm056510",
  },
  {
    id: "hmrc-ptm056410",
    title: "PTM056410: Scheme Pays",
    url: "https://www.gov.uk/hmrc-internal-manuals/pensions-tax-manual/ptm056410",
  },
  {
    id: "hmrc-ptm051100",
    title: "PTM051100: annual allowance essential principles",
    url: "https://www.gov.uk/hmrc-internal-manuals/pensions-tax-manual/ptm051100",
  },
] as const;

export type PensionAnnualAllowanceIncome = {
  netIncomePence: number | null;
  post8July2015SalarySacrificePence: number | null;
  post8July2015FlexibleRemunerationPence: number | null;
  reliefAtSourceNetContributionsPence: number | null;
  claimedPensionReliefPence: number | null;
  netPayContributionsPence: number | null;
  otherMemberContributionsPence: number | null;
  taxableLumpSumDeathBenefitsPence: number | null;
};

export type PensionInput = {
  id: string;
  schemeId: string;
  arrangement: "money-purchase" | "defined-benefit";
  inputPence: number;
  postFlexibleAccessInputPence?: number | null;
};

export type CarryForwardYear = {
  taxYear: string;
  registeredSchemeMember: boolean | null;
  annualAllowancePence: number | null;
  pensionInputPence: number | null;
};

export type AnnualAllowanceChargeRateBand = {
  upperLimitPence: number | null;
  rateBasisPoints: number;
};

export type SchemePaysElection =
  | { status: "none" }
  | {
      status: "assumed" | "observed-election";
      schemeId: string;
      amountPence: number;
    };

export type PensionAnnualAllowanceRequest = {
  taxYear: string;
  jurisdiction: Jurisdiction;
  income: PensionAnnualAllowanceIncome;
  pensionInputs: PensionInput[];
  priorYears: CarryForwardYear[] | null;
  flexibleAccessDate: string | null;
  charge: {
    reducedNetIncomePence: number | null;
    rateBands: AnnualAllowanceChargeRateBand[] | null;
  };
  schemePays: SchemePaysElection;
};

export type PensionAnnualAllowanceIssue = {
  code:
    | "unsupported-tax-year"
    | "missing-statutory-input"
    | "invalid-statutory-input"
    | "invalid-carry-forward-history"
    | "invalid-flexible-access-date"
    | "missing-post-trigger-input"
    | "missing-charge-input"
    | "invalid-scheme-pays-election";
  detail: string;
};

type IncomeMeasures = {
  thresholdIncomePence: number;
  adjustedIncomePence: number;
  reliefAtSourceGrossContributionsPence: number;
  totalMemberContributionsPence: number;
};

export type PensionAnnualAllowanceIncomeResult =
  | {
      available: false;
      issues: PensionAnnualAllowanceIssue[];
    }
  | ({
      available: true;
      taxYear: string;
      standardAnnualAllowancePence: number;
      taperedAnnualAllowancePence: number;
      taperApplied: boolean;
      taperReductionPence: number;
      thresholdIncomeLimitPence: number | null;
      adjustedIncomeLimitPence: number | null;
      minimumAnnualAllowancePence: number | null;
      ruleId: string;
    } & IncomeMeasures);

export type PensionAnnualAllowanceResult =
  | {
      available: false;
      issues: PensionAnnualAllowanceIssue[];
    }
  | {
      available: true;
      taxYear: string;
      ruleId: string;
      thresholdIncomePence: number;
      adjustedIncomePence: number;
      reliefAtSourceGrossContributionsPence: number;
      totalMemberContributionsPence: number;
      standardAnnualAllowancePence: number;
      taperedAnnualAllowancePence: number;
      taperApplied: boolean;
      taperReductionPence: number;
      carryForward: {
        availablePence: number;
        usedPence: number;
        years: Array<{
          taxYear: string;
          availablePence: number;
          usedPence: number;
        }>;
      };
      moneyPurchase: {
        applies: boolean;
        allowancePence: number;
        testedInputPence: number;
        excessPence: number;
        alternativeAnnualAllowancePence: number;
        otherInputPence: number;
      };
      tests: {
        selected: "default" | "alternative";
        defaultChargeablePence: number;
        alternativeChargeablePence: number;
        chargeablePence: number;
      };
      annualAllowanceCharge: {
        amountPence: number;
        defaultTestAmountPence: number;
        slices: Array<{
          amountPence: number;
          rateBasisPoints: number;
          taxPence: number;
        }>;
      };
      schemePays: {
        electionEvidence: "none" | "assumption" | "observed";
        basis: "none" | "mandatory" | "voluntary" | "mixed";
        schemeId: string | null;
        amountPence: number;
        mandatoryEligibleSchemeIds: string[];
        mandatoryMaximumPenceByScheme: Record<string, number>;
        memberRemainsLiablePence: number;
      };
      explanation: string[];
      sources: typeof pensionAnnualAllowanceSources;
    };

type PensionRule = (typeof ruleDataset.pensions)[number];
type StageResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: PensionAnnualAllowanceIssue[] };

type CarryForwardUsage = {
  taxYear: string;
  availablePence: number;
  usedPence: number;
};

type MoneyPurchaseAssessment = {
  applies: boolean;
  allowancePence: number;
  testedInputPence: number;
  excessPence: number;
  alternativeAnnualAllowancePence: number;
  otherInputPence: number;
};

type AllowanceTests = {
  selected: "default" | "alternative";
  defaultChargeablePence: number;
  alternativeChargeablePence: number;
  chargeablePence: number;
  carryRequiredPence: number;
};

type ChargeCalculation = ReturnType<typeof chargeFor>;

type SchemePaysAssessment = {
  electionEvidence: "none" | "assumption" | "observed";
  basis: "none" | "mandatory" | "voluntary" | "mixed";
  schemeId: string | null;
  amountPence: number;
  mandatoryEligibleSchemeIds: string[];
  mandatoryMaximumPenceByScheme: Record<string, number>;
  memberRemainsLiablePence: number;
};

const isMoney = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function taxYearStart(taxYear: string): number | null {
  const match = /^(\d{4})-(\d{2})$/.exec(taxYear);
  if (match == null) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  return (start + 1) % 100 === end ? start : null;
}

function ruleFor(taxYear: string): PensionRule | null {
  const rules = ruleDataset.pensions.filter(
    (rule) => rule.taxYear === taxYear && rule.legalStatus === "enacted",
  );
  return rules.length === 1 ? (rules[0] ?? null) : null;
}

function missingIncomeIssues(
  income: PensionAnnualAllowanceIncome,
): PensionAnnualAllowanceIssue[] {
  const labels: Record<keyof PensionAnnualAllowanceIncome, string> = {
    netIncomePence: "net income",
    post8July2015SalarySacrificePence:
      "post-8-July-2015 salary sacrifice add-back",
    post8July2015FlexibleRemunerationPence:
      "post-8-July-2015 flexible-remuneration add-back",
    reliefAtSourceNetContributionsPence:
      "net relief-at-source contributions",
    claimedPensionReliefPence: "claimed pension relief",
    netPayContributionsPence: "net-pay contributions",
    otherMemberContributionsPence: "other member contributions",
    taxableLumpSumDeathBenefitsPence: "taxable lump-sum death benefits",
  };
  return (Object.keys(labels) as Array<keyof PensionAnnualAllowanceIncome>)
    .filter((key) => !isMoney(income[key]))
    .map((key) => ({
      code:
        income[key] == null
          ? ("missing-statutory-input" as const)
          : ("invalid-statutory-input" as const),
      detail: `${labels[key]} must be supplied as a non-negative whole-pence amount, including zero.`,
    }));
}

function calculateIncomeMeasures(
  income: PensionAnnualAllowanceIncome,
  pensionInputs: readonly PensionInput[],
  rule: PensionRule,
): IncomeMeasures | PensionAnnualAllowanceIssue[] {
  const issues = [
    ...missingIncomeIssues(income),
    ...pensionInputs.flatMap((input) =>
      isMoney(input.inputPence)
        ? []
        : [{
        code: "invalid-statutory-input",
        detail: `Pension input ${input.id} must be a non-negative whole-pence amount.`,
      } satisfies PensionAnnualAllowanceIssue],
    ),
  ];
  if (issues.length > 0) return issues;

  const reliefAtSourceRate =
    rule.methods.find(({ method }) => method === "relief-at-source")
      ?.providerReliefBasisPoints ?? 0;
  const netReliefAtSource = income.reliefAtSourceNetContributionsPence ?? 0;
  const reliefAtSourceGrossContributionsPence = Math.round(
    (netReliefAtSource * 10_000) / (10_000 - reliefAtSourceRate),
  );
  const totalPensionInputPence = pensionInputs.reduce(
    (total, input) => total + input.inputPence,
    0,
  );
  const totalMemberContributionsPence =
    reliefAtSourceGrossContributionsPence +
    (income.netPayContributionsPence ?? 0) +
    (income.otherMemberContributionsPence ?? 0);
  if (totalMemberContributionsPence > totalPensionInputPence) {
    return [
      {
        code: "invalid-statutory-input",
        detail:
          "Total gross member contributions cannot exceed the total pension input amount.",
      },
    ];
  }

  return {
    thresholdIncomePence: Math.max(
      0,
      (income.netIncomePence ?? 0) +
        (income.post8July2015SalarySacrificePence ?? 0) +
        (income.post8July2015FlexibleRemunerationPence ?? 0) -
        reliefAtSourceGrossContributionsPence -
        (income.taxableLumpSumDeathBenefitsPence ?? 0),
    ),
    adjustedIncomePence: Math.max(
      0,
      (income.netIncomePence ?? 0) +
        (income.claimedPensionReliefPence ?? 0) +
        (income.netPayContributionsPence ?? 0) +
        (totalPensionInputPence - totalMemberContributionsPence) -
        (income.taxableLumpSumDeathBenefitsPence ?? 0),
    ),
    reliefAtSourceGrossContributionsPence,
    totalMemberContributionsPence,
  };
}

export function calculatePensionAnnualAllowanceIncome(
  taxYear: string,
  income: PensionAnnualAllowanceIncome,
  pensionInputs: readonly PensionInput[],
): PensionAnnualAllowanceIncomeResult {
  const rule = ruleFor(taxYear);
  if (rule == null) {
    return {
      available: false,
      issues: [
        {
          code: "unsupported-tax-year",
          detail: `${taxYear} does not identify one complete enacted annual-allowance regime; the split 2015-16 transitional year is not inferred.`,
        },
      ],
    };
  }
  const measures = calculateIncomeMeasures(income, pensionInputs, rule);
  if (Array.isArray(measures)) return { available: false, issues: measures };

  const taper = rule.taperedAnnualAllowance;
  const taperApplied =
    taper != null &&
    measures.thresholdIncomePence > taper.thresholdIncomeLimitPence &&
    measures.adjustedIncomePence > taper.adjustedIncomeLimitPence;
  const taperReductionPence = taperApplied
    ? Math.floor(
        (measures.adjustedIncomePence -
          (taper?.adjustedIncomeLimitPence ?? 0)) /
          200,
      ) * 100
    : 0;
  const taperedAnnualAllowancePence = taperApplied
    ? Math.max(
        taper?.minimumAllowancePence ?? 0,
        rule.annualAllowancePence - taperReductionPence,
      )
    : rule.annualAllowancePence;
  return {
    available: true,
    taxYear,
    ruleId: rule.id,
    ...measures,
    standardAnnualAllowancePence: rule.annualAllowancePence,
    taperedAnnualAllowancePence,
    taperApplied,
    taperReductionPence:
      rule.annualAllowancePence - taperedAnnualAllowancePence,
    thresholdIncomeLimitPence: taper?.thresholdIncomeLimitPence ?? null,
    adjustedIncomeLimitPence: taper?.adjustedIncomeLimitPence ?? null,
    minimumAnnualAllowancePence: taper?.minimumAllowancePence ?? null,
  };
}

function carryForwardYears(
  currentTaxYear: string,
  priorYears: CarryForwardYear[] | null,
): StageResult<CarryForwardUsage[]> {
  const start = taxYearStart(currentTaxYear);
  if (start == null || priorYears == null || priorYears.length !== 3) {
    return {
      ok: false,
      issues: [{
        code: "invalid-carry-forward-history",
        detail:
          "Carry forward requires membership and pension-usage facts for each of the previous three tax years.",
      }],
    };
  }
  const expected = [start - 3, start - 2, start - 1].map(
    (year) => `${year}-${String((year + 1) % 100).padStart(2, "0")}`,
  );
  const sorted = [...priorYears].sort((left, right) =>
    left.taxYear.localeCompare(right.taxYear),
  );
  if (sorted.some(({ taxYear }, index) => taxYear !== expected[index])) {
    return {
      ok: false,
      issues: [{
        code: "invalid-carry-forward-history",
        detail: `Expected carry-forward facts for ${expected.join(", ")} in earliest-first order.`,
      }],
    };
  }
  const issues: PensionAnnualAllowanceIssue[] = [];
  const years = sorted.map((year) => {
    if (year.registeredSchemeMember == null) {
      issues.push({
        code: "invalid-carry-forward-history",
        detail: `${year.taxYear} must state whether the individual was a registered pension-scheme member.`,
      });
      return { taxYear: year.taxYear, availablePence: 0, usedPence: 0 };
    }
    if (!year.registeredSchemeMember) {
      return { taxYear: year.taxYear, availablePence: 0, usedPence: 0 };
    }
    if (
      !isMoney(year.annualAllowancePence) ||
      !isMoney(year.pensionInputPence)
    ) {
      issues.push({
        code: "invalid-carry-forward-history",
        detail: `${year.taxYear} membership requires its effective annual allowance and total pension input amount.`,
      });
      return { taxYear: year.taxYear, availablePence: 0, usedPence: 0 };
    }
    return {
      taxYear: year.taxYear,
      availablePence: Math.max(
        0,
        year.annualAllowancePence - year.pensionInputPence,
      ),
      usedPence: 0,
    };
  });
  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, value: years };
}

function consumeCarryForward(
  years: CarryForwardUsage[],
  requiredPence: number,
) {
  let remaining = requiredPence;
  return years.map((year) => {
    const usedPence = Math.min(year.availablePence, remaining);
    remaining -= usedPence;
    return { ...year, usedPence };
  });
}

function chargeFor(
  chargeablePence: number,
  reducedNetIncomePence: number,
  bands: readonly AnnualAllowanceChargeRateBand[],
) {
  let position = reducedNetIncomePence;
  let remaining = chargeablePence;
  const slices: Array<{
    amountPence: number;
    rateBasisPoints: number;
    taxPence: number;
  }> = [];
  for (const band of bands) {
    const capacity =
      band.upperLimitPence == null
        ? remaining
        : Math.max(0, band.upperLimitPence - position);
    const amountPence = Math.min(remaining, capacity);
    if (amountPence > 0) {
      slices.push({
        amountPence,
        rateBasisPoints: band.rateBasisPoints,
        taxPence: Math.round(
          (amountPence * band.rateBasisPoints) / 10_000,
        ),
      });
      position += amountPence;
      remaining -= amountPence;
    }
    if (remaining === 0) break;
  }
  return {
    amountPence: slices.reduce((total, slice) => total + slice.taxPence, 0),
    slices,
    unallocatedPence: remaining,
  };
}

function validChargeBands(
  bands: AnnualAllowanceChargeRateBand[] | null,
): bands is AnnualAllowanceChargeRateBand[] {
  if (bands == null || bands.length === 0) return false;
  let previous = 0;
  return bands.every((band, index) => {
    if (
      !Number.isSafeInteger(band.rateBasisPoints) ||
      band.rateBasisPoints < 0 ||
      band.rateBasisPoints > 10_000
    ) {
      return false;
    }
    if (band.upperLimitPence == null) return index === bands.length - 1;
    if (!isMoney(band.upperLimitPence) || band.upperLimitPence <= previous) {
      return false;
    }
    previous = band.upperLimitPence;
    return true;
  });
}

function dateIsReal(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date
  );
}

function failedStage<T>(
  code: PensionAnnualAllowanceIssue["code"],
  detail: string,
): StageResult<T> {
  return { ok: false, issues: [{ code, detail }] };
}

function testedMoneyPurchaseInput(
  pensionInputs: readonly PensionInput[],
  flexibleAccessDate: string,
  triggeredBeforeStart: boolean,
): StageResult<number> {
  let testedInputPence = 0;
  for (const input of pensionInputs) {
    if (input.arrangement !== "money-purchase") continue;
    if (triggeredBeforeStart) {
      testedInputPence += input.inputPence;
      continue;
    }
    const postTriggerInput = input.postFlexibleAccessInputPence;
    if (!isMoney(postTriggerInput)) {
      return failedStage(
        "missing-post-trigger-input",
        `Money-purchase input ${input.id} must state the amount arising after ${flexibleAccessDate}.`,
      );
    }
    if (postTriggerInput > input.inputPence) {
      return failedStage(
        "invalid-statutory-input",
        `Post-trigger input for ${input.id} cannot exceed its total input.`,
      );
    }
    testedInputPence += postTriggerInput;
  }
  return { ok: true, value: testedInputPence };
}

function assessMoneyPurchase(
  request: PensionAnnualAllowanceRequest,
  rule: PensionRule,
  taperedAnnualAllowancePence: number,
  totalInputPence: number,
): StageResult<MoneyPurchaseAssessment> {
  const start = taxYearStart(request.taxYear);
  if (start == null) {
    return failedStage(
      "unsupported-tax-year",
      `${request.taxYear} is not a valid tax year.`,
    );
  }
  const flexibleAccessDate = request.flexibleAccessDate;
  if (flexibleAccessDate != null && !dateIsReal(flexibleAccessDate)) {
    return failedStage(
      "invalid-flexible-access-date",
      "The flexible-access date must be a real ISO date.",
    );
  }
  const taxYearStartDate = `${start}-04-06`;
  const taxYearEndDate = `${start + 1}-04-05`;
  const triggeredBeforeEnd =
    flexibleAccessDate != null && flexibleAccessDate <= taxYearEndDate;
  const triggeredBeforeStart =
    flexibleAccessDate != null && flexibleAccessDate < taxYearStartDate;
  const testedInput = triggeredBeforeEnd
    ? testedMoneyPurchaseInput(
        request.pensionInputs,
        flexibleAccessDate ?? taxYearEndDate,
        triggeredBeforeStart,
      )
    : ({ ok: true, value: 0 } satisfies StageResult<number>);
  if (!testedInput.ok) return testedInput;

  const allowancePence = rule.moneyPurchaseAnnualAllowancePence;
  const applies = triggeredBeforeEnd && testedInput.value > allowancePence;
  const excessPence = applies ? testedInput.value - allowancePence : 0;
  return {
    ok: true,
    value: {
      applies,
      allowancePence,
      testedInputPence: testedInput.value,
      excessPence,
      alternativeAnnualAllowancePence: Math.max(
        0,
        taperedAnnualAllowancePence - allowancePence,
      ),
      otherInputPence: totalInputPence - testedInput.value,
    },
  };
}

function calculateAllowanceTests(
  totalInputPence: number,
  taperedAnnualAllowancePence: number,
  availableCarryForwardPence: number,
  moneyPurchase: MoneyPurchaseAssessment,
): AllowanceTests {
  const defaultChargeablePence = Math.max(
    0,
    totalInputPence -
      taperedAnnualAllowancePence -
      availableCarryForwardPence,
  );
  const alternativeOtherExcessPence = moneyPurchase.applies
    ? Math.max(
        0,
        moneyPurchase.otherInputPence -
          moneyPurchase.alternativeAnnualAllowancePence -
          availableCarryForwardPence,
      )
    : 0;
  const alternativeChargeablePence = moneyPurchase.applies
    ? moneyPurchase.excessPence + alternativeOtherExcessPence
    : 0;
  const selected =
    alternativeChargeablePence > defaultChargeablePence
      ? "alternative"
      : "default";
  return {
    selected,
    defaultChargeablePence,
    alternativeChargeablePence,
    chargeablePence: Math.max(
      defaultChargeablePence,
      alternativeChargeablePence,
    ),
    carryRequiredPence:
      selected === "alternative"
        ? Math.max(
            0,
            moneyPurchase.otherInputPence -
              moneyPurchase.alternativeAnnualAllowancePence,
          )
        : Math.max(0, totalInputPence - taperedAnnualAllowancePence),
  };
}

const emptyCharge = (): ChargeCalculation => ({
  amountPence: 0,
  slices: [],
  unallocatedPence: 0,
});

function calculateAnnualAllowanceCharges(
  charge: PensionAnnualAllowanceRequest["charge"],
  tests: AllowanceTests,
): StageResult<{
  annualCharge: ChargeCalculation;
  defaultTestCharge: ChargeCalculation;
}> {
  if (tests.chargeablePence === 0) {
    return {
      ok: true,
      value: { annualCharge: emptyCharge(), defaultTestCharge: emptyCharge() },
    };
  }
  if (
    !isMoney(charge.reducedNetIncomePence) ||
    !validChargeBands(charge.rateBands)
  ) {
    return failedStage(
      "missing-charge-input",
      "An excess requires reduced net income and complete, ordered tax-rate limits to calculate the annual allowance charge.",
    );
  }
  const annualCharge = chargeFor(
    tests.chargeablePence,
    charge.reducedNetIncomePence,
    charge.rateBands,
  );
  const defaultTestCharge = chargeFor(
    tests.defaultChargeablePence,
    charge.reducedNetIncomePence,
    charge.rateBands,
  );
  if (
    annualCharge.unallocatedPence > 0 ||
    defaultTestCharge.unallocatedPence > 0
  ) {
    return failedStage(
      "missing-charge-input",
      "The supplied tax-rate limits do not cover the full excess.",
    );
  }
  return { ok: true, value: { annualCharge, defaultTestCharge } };
}

function pensionInputByScheme(
  pensionInputs: readonly PensionInput[],
): Map<string, number> {
  const schemeInput = new Map<string, number>();
  for (const input of pensionInputs) {
    schemeInput.set(
      input.schemeId,
      (schemeInput.get(input.schemeId) ?? 0) + input.inputPence,
    );
  }
  return schemeInput;
}

function mandatorySchemePaysMaximum(
  schemeInputPence: number,
  annualAllowancePence: number,
  defaultTestCharge: ChargeCalculation,
): number {
  let remainingSchemeExcess = Math.max(
    0,
    schemeInputPence - annualAllowancePence,
  );
  let maximumPence = 0;
  for (const slice of [...defaultTestCharge.slices].reverse()) {
    const amountPence = Math.min(remainingSchemeExcess, slice.amountPence);
    maximumPence += Math.round(
      (amountPence * slice.rateBasisPoints) / 10_000,
    );
    remainingSchemeExcess -= amountPence;
    if (remainingSchemeExcess === 0) break;
  }
  return maximumPence;
}

function schemePaysBasis(
  amountPence: number,
  mandatoryMaximumPence: number,
): SchemePaysAssessment["basis"] {
  if (mandatoryMaximumPence === 0) return "voluntary";
  return amountPence <= mandatoryMaximumPence ? "mandatory" : "mixed";
}

function assessSchemePays(
  request: PensionAnnualAllowanceRequest,
  rule: PensionRule,
  annualCharge: ChargeCalculation,
  defaultTestCharge: ChargeCalculation,
): StageResult<SchemePaysAssessment> {
  const schemeInput = pensionInputByScheme(request.pensionInputs);
  const mandatoryEligibleSchemeIds =
    annualCharge.amountPence > 200_000 &&
    defaultTestCharge.amountPence > 200_000
      ? [...schemeInput.entries()]
          .filter(([, amount]) => amount > rule.annualAllowancePence)
          .map(([schemeId]) => schemeId)
      : [];
  const mandatoryMaximumPenceByScheme = Object.fromEntries(
    mandatoryEligibleSchemeIds.map((schemeId) => [
      schemeId,
      mandatorySchemePaysMaximum(
        schemeInput.get(schemeId) ?? 0,
        rule.annualAllowancePence,
        defaultTestCharge,
      ),
    ]),
  );
  const election = request.schemePays;
  if (election.status === "none") {
    return {
      ok: true,
      value: {
        electionEvidence: "none",
        basis: "none",
        schemeId: null,
        amountPence: 0,
        mandatoryEligibleSchemeIds,
        mandatoryMaximumPenceByScheme,
        memberRemainsLiablePence: annualCharge.amountPence,
      },
    };
  }
  if (
    !schemeInput.has(election.schemeId) ||
    !isMoney(election.amountPence) ||
    election.amountPence > annualCharge.amountPence
  ) {
    return failedStage(
      "invalid-scheme-pays-election",
      "A Scheme Pays election must name a contributing scheme and cannot exceed the calculated charge.",
    );
  }
  const mandatoryMaximum =
    mandatoryMaximumPenceByScheme[election.schemeId] ?? 0;
  return {
    ok: true,
    value: {
      electionEvidence:
        election.status === "assumed" ? "assumption" : "observed",
      basis: schemePaysBasis(election.amountPence, mandatoryMaximum),
      schemeId: election.schemeId,
      amountPence: election.amountPence,
      mandatoryEligibleSchemeIds,
      mandatoryMaximumPenceByScheme,
      memberRemainsLiablePence:
        annualCharge.amountPence - election.amountPence,
    },
  };
}

export function calculatePensionAnnualAllowance(
  request: PensionAnnualAllowanceRequest,
): PensionAnnualAllowanceResult {
  const income = calculatePensionAnnualAllowanceIncome(
    request.taxYear,
    request.income,
    request.pensionInputs,
  );
  if (!income.available) return income;
  const rule = ruleFor(request.taxYear);
  if (rule == null) {
    return {
      available: false,
      issues: [
        {
          code: "unsupported-tax-year",
          detail: `${request.taxYear} does not have an enacted pension rule.`,
        },
      ],
    };
  }
  const carryForward = carryForwardYears(
    request.taxYear,
    request.priorYears,
  );
  if (!carryForward.ok) {
    return { available: false, issues: carryForward.issues };
  }
  const years = carryForward.value;
  const availableCarryForwardPence = years.reduce(
    (total, year) => total + year.availablePence,
    0,
  );
  const totalInputPence = request.pensionInputs.reduce(
    (total, input) => total + input.inputPence,
    0,
  );
  const moneyPurchase = assessMoneyPurchase(
    request,
    rule,
    income.taperedAnnualAllowancePence,
    totalInputPence,
  );
  if (!moneyPurchase.ok) {
    return { available: false, issues: moneyPurchase.issues };
  }
  const tests = calculateAllowanceTests(
    totalInputPence,
    income.taperedAnnualAllowancePence,
    availableCarryForwardPence,
    moneyPurchase.value,
  );
  const consumedYears = consumeCarryForward(
    years,
    tests.carryRequiredPence,
  );
  const carryUsedPence = consumedYears.reduce(
    (total, year) => total + year.usedPence,
    0,
  );
  const charges = calculateAnnualAllowanceCharges(request.charge, tests);
  if (!charges.ok) return { available: false, issues: charges.issues };
  const schemePays = assessSchemePays(
    request,
    rule,
    charges.value.annualCharge,
    charges.value.defaultTestCharge,
  );
  if (!schemePays.ok) return { available: false, issues: schemePays.issues };

  return {
    available: true,
    taxYear: request.taxYear,
    ruleId: income.ruleId,
    thresholdIncomePence: income.thresholdIncomePence,
    adjustedIncomePence: income.adjustedIncomePence,
    reliefAtSourceGrossContributionsPence:
      income.reliefAtSourceGrossContributionsPence,
    totalMemberContributionsPence: income.totalMemberContributionsPence,
    standardAnnualAllowancePence: income.standardAnnualAllowancePence,
    taperedAnnualAllowancePence: income.taperedAnnualAllowancePence,
    taperApplied: income.taperApplied,
    taperReductionPence: income.taperReductionPence,
    carryForward: {
      availablePence: availableCarryForwardPence,
      usedPence: carryUsedPence,
      years: consumedYears,
    },
    moneyPurchase: moneyPurchase.value,
    tests: {
      selected: tests.selected,
      defaultChargeablePence: tests.defaultChargeablePence,
      alternativeChargeablePence: tests.alternativeChargeablePence,
      chargeablePence: tests.chargeablePence,
    },
    annualAllowanceCharge: {
      amountPence: charges.value.annualCharge.amountPence,
      defaultTestAmountPence: charges.value.defaultTestCharge.amountPence,
      slices: charges.value.annualCharge.slices,
    },
    schemePays: schemePays.value,
    explanation: [
      `Threshold income is ${income.thresholdIncomePence} pence after statutory add-backs and relief-at-source grossing.`,
      `Adjusted income is ${income.adjustedIncomePence} pence after member-contribution and total-pension-input adjustments.`,
      `The ${tests.selected} test produces ${tests.chargeablePence} pence subject to the annual allowance charge.`,
      schemePays.value.basis === "none"
        ? "The member remains responsible for the charge; no Scheme Pays election is recorded."
        : `Scheme Pays is recorded on a ${schemePays.value.basis} basis from ${schemePays.value.electionEvidence} evidence.`,
    ],
    sources: pensionAnnualAllowanceSources,
  };
}
