import { ruleDataset } from "./data";
import type { Jurisdiction, PensionContributionMethod } from "./schema";

export type TaxEvidence = {
  kind: "observed" | "assumption";
  sourceRecordId: string;
  detail: string;
};

export type HouseholdTaxPerson = {
  memberId: string;
  displayName: string;
  jurisdiction: Jurisdiction;
  residence: "full-year-uk" | "partial-year" | "non-uk";
  hasTaxableBenefits: boolean;
  nationalInsuranceCategory: string;
  isCompanyDirector: boolean;
  flexiblyAccessedPension: boolean;
  evidence: TaxEvidence;
};

export type HouseholdTaxAccount = {
  id: string;
  memberId: string;
  name: string;
  wrapper: "taxable" | "isa" | "pension";
  holdingRecordIds: string[];
};

export type HouseholdTaxIncome = {
  id: string;
  memberId: string;
  accountId?: string;
  employmentId?: string;
  kind: "employment" | "savings-interest" | "dividend";
  amountPence: number;
  evidence: TaxEvidence;
  correctsId?: string;
};

export type HouseholdTaxDisposal = {
  id: string;
  memberId: string;
  accountId: string;
  proceedsPence: number;
  allowableCostPence: number;
  lossesAppliedPence: number;
  claimsRelief: boolean;
  evidence: TaxEvidence;
  correctsId?: string;
};

export type HouseholdTaxContribution = {
  id: string;
  memberId: string;
  accountId: string;
  kind: "isa" | "pension";
  amountPence: number;
  pensionMethod?: PensionContributionMethod;
  employerContribution?: boolean;
  evidence: TaxEvidence;
  correctsId?: string;
};

export type HouseholdTaxRequest = {
  taxYear: string;
  people: HouseholdTaxPerson[];
  accounts: HouseholdTaxAccount[];
  incomes: HouseholdTaxIncome[];
  disposals: HouseholdTaxDisposal[];
  contributions: HouseholdTaxContribution[];
  unsupportedCases: Array<{ code: string; detail: string }>;
};

type TaxComponent = {
  amountPence: number;
  explanation: string;
  recordIds: string[];
  ruleIds: string[];
};

export type TaxBandConsumption = {
  id: string;
  label: string;
  rateBasisPoints: number;
  widthPence: number | null;
  usedPence: number;
  employmentPence: number;
  savingsPence: number;
  dividendsPence: number;
  capitalGainsPence: number;
};

export type TaxBandScenario = {
  personalAllowancePence: number;
  personalAllowanceUsedPence: number;
  personalAllowanceByIncome: {
    employmentPence: number;
    savingsPence: number;
    dividendsPence: number;
  };
  taxableIncomePence: number;
  taxableGainPence: number;
  bands: TaxBandConsumption[];
};

export type PersonTaxEstimate = {
  memberId: string;
  displayName: string;
  available: boolean;
  unsupported: Array<{ code: string; detail: string }>;
  totalTaxPence: number | null;
  incomeTax: TaxComponent;
  savingsTax: TaxComponent;
  dividendTax: TaxComponent;
  nationalInsurance: TaxComponent;
  capitalGainsTax: TaxComponent;
  bandConsumption: {
    observed: TaxBandScenario;
    projected: TaxBandScenario;
  };
  allowances: {
    personalAllowancePence: number;
    startingRateForSavingsPence: number;
    personalSavingsAllowancePence: number;
    dividendAllowancePence: number;
    capitalGainsAnnualExemptAmountPence: number;
    isaAllowancePence: number;
    isaObservedContributionsPence: number;
    isaContributionsPence: number;
    pensionAllowancePence: number;
    pensionObservedContributionsPence: number;
    pensionContributionsPence: number;
  };
  excludedWrapperRecordIds: string[];
};

export type HouseholdTaxEstimate = {
  kind: "uk-household-tax-estimate";
  calculationVersion: "1";
  taxYear: string;
  isEstimate: true;
  available: boolean;
  totalTaxPence: number | null;
  people: PersonTaxEstimate[];
  unsupported: Array<{ code: string; detail: string }>;
  lineage: {
    ruleDatasetVersion: string;
    ruleIds: string[];
    sources: Array<{ id: string; title: string; url: string }>;
    observedRecordIds: string[];
    assumptionRecordIds: string[];
    holdingRecordIds: string[];
    rounding: string;
  };
};

const roundTax = (amountPence: number, rateBasisPoints: number) =>
  Math.round((amountPence * rateBasisPoints) / 10_000);

const sum = (values: readonly number[]) =>
  values.reduce((total, value) => total + value, 0);

const jurisdictionLabel = (jurisdiction: Jurisdiction): string =>
  ({
    "england-and-northern-ireland": "England and Northern Ireland",
    scotland: "Scotland",
    wales: "Wales",
  })[jurisdiction];

const bandLabel = (index: number): string => {
  if (index === 0) return "Basic-rate band";
  if (index === 1) return "Higher-rate band";
  if (index === 2) return "Additional-rate band";
  return `Tax band ${index + 1}`;
};

function effectiveRecords<T extends { id: string; correctsId?: string }>(
  records: readonly T[],
): T[] {
  const correctedIds = new Set(
    records.flatMap(({ correctsId }) =>
      correctsId == null ? [] : [correctsId],
    ),
  );
  return records.filter(({ id }) => !correctedIds.has(id));
}

function taxAcrossBands(
  amountPence: number,
  bands: ReadonlyArray<{
    rateBasisPoints: number;
    widthPence: number | null;
  }>,
): number {
  let remaining = amountPence;
  let tax = 0;
  for (const band of bands) {
    const inBand =
      band.widthPence == null
        ? remaining
        : Math.min(remaining, band.widthPence);
    tax += roundTax(inBand, band.rateBasisPoints);
    remaining -= inBand;
    if (remaining <= 0) break;
  }
  return tax;
}

function dividendTaxAcrossBands(
  amountPence: number,
  allowancePence: number,
  occupiedPence: number,
  basicBandWidthPence: number,
  higherBandWidthPence: number,
  rates: {
    basicBasisPoints: number;
    higherBasisPoints: number;
    additionalBasisPoints: number;
  },
): number {
  let remaining = amountPence;
  let allowance = allowancePence;
  let position = occupiedPence;
  let tax = 0;
  const thresholds = [
    { end: basicBandWidthPence, rate: rates.basicBasisPoints },
    {
      end: basicBandWidthPence + higherBandWidthPence,
      rate: rates.higherBasisPoints,
    },
    { end: Number.POSITIVE_INFINITY, rate: rates.additionalBasisPoints },
  ];
  for (const band of thresholds) {
    const capacity = Math.max(0, band.end - position);
    const inBand = Math.min(remaining, capacity);
    const atZeroRate = Math.min(inBand, allowance);
    tax += roundTax(inBand - atZeroRate, band.rate);
    allowance -= atZeroRate;
    remaining -= inBand;
    position += inBand;
    if (remaining <= 0) break;
  }
  return tax;
}

function annualNationalInsurance(
  annualPayPence: number,
  rule: (typeof ruleDataset.nationalInsurance)[number],
): number {
  const monthlyPay = annualPayPence / 12;
  const primary = rule.thresholds.primaryThresholdPence.monthly;
  const upper = rule.thresholds.upperEarningsLimitPence.monthly;
  const main = Math.max(0, Math.min(monthlyPay, upper) - primary);
  const above = Math.max(0, monthlyPay - upper);
  return (
    roundTax(main, rule.rates.primaryToUpperBasisPoints) * 12 +
    roundTax(above, rule.rates.aboveUpperBasisPoints) * 12
  );
}

function unsupportedForPerson(
  person: HouseholdTaxPerson,
  request: HouseholdTaxRequest,
): Array<{ code: string; detail: string }> {
  const unsupported = [...request.unsupportedCases];
  if (person.residence !== "full-year-uk") {
    unsupported.push({
      code: "unsupported-residence",
      detail: `${person.displayName} is not recorded as UK resident for the full tax year.`,
    });
  }
  if (person.hasTaxableBenefits) {
    unsupported.push({
      code: "unsupported-benefits",
      detail: `${person.displayName} has taxable benefits that this estimate does not model.`,
    });
  }
  if (person.jurisdiction === "scotland") {
    unsupported.push({
      code: "unsupported-scottish-position",
      detail: `${person.displayName} is a Scottish taxpayer. The employment rule exists, but this household calculation does not combine Scottish bands with dividends and gains.`,
    });
  }
  if (person.nationalInsuranceCategory !== "A") {
    unsupported.push({
      code: "unsupported-ni-category",
      detail: `${person.displayName} uses National Insurance category ${person.nationalInsuranceCategory}; only category A is supported.`,
    });
  }
  if (person.isCompanyDirector) {
    unsupported.push({
      code: "unsupported-director-ni",
      detail: `${person.displayName} is a company director, which needs an annual National Insurance method.`,
    });
  }
  return unsupported;
}

function resolvePersonRules(
  person: HouseholdTaxPerson,
  request: HouseholdTaxRequest,
  unsupported: Array<{ code: string; detail: string }>,
) {
  const rules = {
    incomeRule: ruleDataset.incomeTax.find(
      (rule) =>
        rule.taxYear === request.taxYear &&
        rule.jurisdictions.includes(person.jurisdiction),
    ),
    niRule: ruleDataset.nationalInsurance.find(
      (rule) => rule.taxYear === request.taxYear,
    ),
    pensionRule: ruleDataset.pensions.find(
      (rule) => rule.taxYear === request.taxYear,
    ),
    householdRule: ruleDataset.householdTax.find(
      (rule) => rule.taxYear === request.taxYear,
    ),
  };
  if (
    !(
      rules.incomeRule &&
      rules.niRule &&
      rules.pensionRule &&
      rules.householdRule
    )
  ) {
    unsupported.push({
      code: "unsupported-tax-year",
      detail: `${request.taxYear} does not have a complete reviewed household rule set.`,
    });
  }
  return rules;
}

function calculatePersonalAllowance(
  employmentPence: number,
  savingsPence: number,
  dividendPence: number,
  reliefAtSourcePence: number,
  incomeRule: (typeof ruleDataset.incomeTax)[number] | undefined,
): number {
  if (incomeRule == null) return 0;
  const excessIncome = Math.max(
    0,
    employmentPence +
      savingsPence +
      dividendPence -
      reliefAtSourcePence -
      incomeRule.personalAllowanceTaper.adjustedNetIncomeStartsAtPence,
  );
  const reduction =
    Math.ceil(
      excessIncome /
        incomeRule.personalAllowanceTaper.perExcessIncomePence,
    ) * incomeRule.personalAllowanceTaper.allowanceReductionPence;
  return Math.max(0, incomeRule.standardPersonalAllowancePence - reduction);
}

function calculatePensionAllowance(
  person: HouseholdTaxPerson,
  employmentPence: number,
  savingsPence: number,
  dividendPence: number,
  reliefAtSourcePence: number,
  employerPensionContributions: number,
  pensionRule: (typeof ruleDataset.pensions)[number] | undefined,
): number {
  if (pensionRule == null) return 0;
  const thresholdIncome =
    employmentPence + savingsPence + dividendPence - reliefAtSourcePence;
  const adjustedIncome =
    employmentPence +
    savingsPence +
    dividendPence +
    employerPensionContributions;
  let allowance = pensionRule.annualAllowancePence;
  const taperedAllowance = pensionRule.taperedAnnualAllowance;
  if (
    taperedAllowance != null &&
    thresholdIncome > taperedAllowance.thresholdIncomeLimitPence &&
    adjustedIncome > taperedAllowance.adjustedIncomeLimitPence
  ) {
    allowance = Math.max(
      taperedAllowance.minimumAllowancePence,
      allowance -
        Math.floor(
          (adjustedIncome - taperedAllowance.adjustedIncomeLimitPence) / 2,
        ),
    );
  }
  return person.flexiblyAccessedPension
    ? Math.min(allowance, pensionRule.moneyPurchaseAnnualAllowancePence)
    : allowance;
}

function selectPersonRecords(
  person: HouseholdTaxPerson,
  request: HouseholdTaxRequest,
  unsupported: Array<{ code: string; detail: string }>,
) {
  const accounts = new Map(
    request.accounts
      .filter(({ memberId }) => memberId === person.memberId)
      .map((account) => [account.id, account]),
  );
  const allIncome = effectiveRecords(request.incomes).filter(
    ({ memberId }) => memberId === person.memberId,
  );
  const taxableIncome = allIncome.filter(
    ({ accountId }) =>
      accountId == null || accounts.get(accountId)?.wrapper === "taxable",
  );
  const excludedIncome = allIncome.filter(
    ({ accountId }) =>
      accountId != null && accounts.get(accountId)?.wrapper !== "taxable",
  );
  const allDisposals = effectiveRecords(request.disposals).filter(
    ({ memberId }) => memberId === person.memberId,
  );
  const taxableDisposals = allDisposals.filter(
    ({ accountId }) => accounts.get(accountId)?.wrapper === "taxable",
  );
  const excludedDisposals = allDisposals.filter(
    ({ accountId }) => accounts.get(accountId)?.wrapper !== "taxable",
  );
  if (taxableDisposals.some(({ claimsRelief }) => claimsRelief)) {
    unsupported.push({
      code: "unsupported-cgt-relief",
      detail: `${person.displayName} has a disposal with a Capital Gains Tax relief or election.`,
    });
  }
  return {
    contributions: effectiveRecords(request.contributions).filter(
      ({ memberId }) => memberId === person.memberId,
    ),
    excludedDisposals,
    excludedIncome,
    taxableDisposals,
    taxableIncome,
  };
}

function buildBandScenario({
  dividendPence,
  employmentPence,
  incomeRule,
  netGainPence,
  reliefAtSourcePence,
  savingsPence,
  annualExemptAmountPence,
}: {
  dividendPence: number;
  employmentPence: number;
  incomeRule: (typeof ruleDataset.incomeTax)[number] | undefined;
  netGainPence: number;
  reliefAtSourcePence: number;
  savingsPence: number;
  annualExemptAmountPence: number;
}): TaxBandScenario {
  const personalAllowance = calculatePersonalAllowance(
    employmentPence,
    savingsPence,
    dividendPence,
    reliefAtSourcePence,
    incomeRule,
  );
  let remainingAllowance = personalAllowance;
  const personalAllowanceByIncome = {
    employmentPence: 0,
    savingsPence: 0,
    dividendsPence: 0,
  };
  const afterAllowance = (
    key: keyof typeof personalAllowanceByIncome,
    amountPence: number,
  ) => {
    const covered = Math.min(amountPence, remainingAllowance);
    personalAllowanceByIncome[key] = covered;
    remainingAllowance -= covered;
    return amountPence - covered;
  };
  const taxableAmounts = {
    employmentPence: afterAllowance("employmentPence", employmentPence),
    savingsPence: afterAllowance("savingsPence", savingsPence),
    dividendsPence: afterAllowance("dividendsPence", dividendPence),
    capitalGainsPence: Math.max(0, netGainPence - annualExemptAmountPence),
  };
  const bands: TaxBandConsumption[] =
    incomeRule?.bands.map((band, index) => ({
      id: `${incomeRule.id}-band-${index + 1}`,
      label: bandLabel(index),
      rateBasisPoints: band.rateBasisPoints,
      widthPence:
        index === 0 && band.widthPence != null
          ? band.widthPence + reliefAtSourcePence
          : band.widthPence,
      usedPence: 0,
      employmentPence: 0,
      savingsPence: 0,
      dividendsPence: 0,
      capitalGainsPence: 0,
    })) ?? [];
  let bandIndex = allocateToTaxBands(
    bands,
    "employmentPence",
    taxableAmounts.employmentPence,
    0,
  );
  bandIndex = allocateToTaxBands(
    bands,
    "savingsPence",
    taxableAmounts.savingsPence,
    bandIndex,
  );
  bandIndex = allocateToTaxBands(
    bands,
    "dividendsPence",
    taxableAmounts.dividendsPence,
    bandIndex,
  );
  allocateToTaxBands(
    bands,
    "capitalGainsPence",
    taxableAmounts.capitalGainsPence,
    bandIndex,
  );

  return {
    personalAllowancePence: personalAllowance,
    personalAllowanceUsedPence:
      personalAllowance - remainingAllowance,
    personalAllowanceByIncome,
    taxableIncomePence:
      taxableAmounts.employmentPence +
      taxableAmounts.savingsPence +
      taxableAmounts.dividendsPence,
    taxableGainPence: taxableAmounts.capitalGainsPence,
    bands,
  };
}

type TaxBandAmountKey =
  | "employmentPence"
  | "savingsPence"
  | "dividendsPence"
  | "capitalGainsPence";

function allocateToTaxBands(
  bands: TaxBandConsumption[],
  key: TaxBandAmountKey,
  amountPence: number,
  startingBandIndex: number,
): number {
  let bandIndex = startingBandIndex;
  let remaining = amountPence;
  while (remaining > 0 && bandIndex < bands.length) {
    const band = bands[bandIndex];
    if (band == null) break;
    const capacity =
      band.widthPence == null
        ? remaining
        : Math.max(0, band.widthPence - band.usedPence);
    const allocated = Math.min(remaining, capacity);
    band[key] += allocated;
    band.usedPence += allocated;
    remaining -= allocated;
    if (
      allocated === 0 ||
      (band.widthPence != null && band.usedPence >= band.widthPence)
    ) {
      bandIndex += 1;
    }
  }
  return bandIndex;
}

type HouseholdRule = (typeof ruleDataset.householdTax)[number] | undefined;
type NationalInsuranceRule =
  | (typeof ruleDataset.nationalInsurance)[number]
  | undefined;

function employmentNationalInsurance(
  employment: HouseholdTaxIncome[],
  rule: NationalInsuranceRule,
): number {
  if (rule == null) return 0;
  const employmentByJob = new Map<string, number>();
  for (const record of employment) {
    const employmentId = record.employmentId ?? record.id;
    employmentByJob.set(
      employmentId,
      (employmentByJob.get(employmentId) ?? 0) + record.amountPence,
    );
  }
  return sum(
    [...employmentByJob.values()].map((pay) =>
      annualNationalInsurance(pay, rule),
    ),
  );
}

function personalSavingsAllowanceFor(
  rule: HouseholdRule,
  totalTaxableIncome: number,
  basicBandWidth: number,
  higherBandWidth: number,
): number {
  if (rule == null) return 0;
  if (totalTaxableIncome <= basicBandWidth) {
    return rule.savings.personalSavingsAllowancePence.basic;
  }
  if (totalTaxableIncome <= basicBandWidth + higherBandWidth) {
    return rule.savings.personalSavingsAllowancePence.higher;
  }
  return rule.savings.personalSavingsAllowancePence.additional;
}

function startingRateForSavings(
  rule: HouseholdRule,
  savingsPence: number,
  employmentPence: number,
): number {
  if (rule == null) return 0;
  return Math.min(
    savingsPence,
    Math.max(0, rule.savings.startingRateLimitPence - employmentPence),
  );
}

function savingsTax(
  rule: HouseholdRule,
  savingsPence: number,
  zeroRateAllowancePence: number,
  employmentPence: number,
  basicBandWidth: number,
  higherBandWidth: number,
): number {
  if (rule == null) return 0;
  return dividendTaxAcrossBands(
    savingsPence,
    zeroRateAllowancePence,
    employmentPence,
    basicBandWidth,
    higherBandWidth,
    rule.savings.rates,
  );
}

function dividendTax(
  rule: HouseholdRule,
  dividendPence: number,
  priorTaxableIncomePence: number,
  basicBandWidth: number,
  higherBandWidth: number,
): number {
  if (rule == null) return 0;
  return dividendTaxAcrossBands(
    dividendPence,
    rule.dividendAllowancePence,
    priorTaxableIncomePence,
    basicBandWidth,
    higherBandWidth,
    rule.dividendRates,
  );
}

function flagMissingPensionMethod(
  person: HouseholdTaxPerson,
  contributions: HouseholdTaxContribution[],
  unsupported: Array<{ code: string; detail: string }>,
): void {
  if (!contributions.some(({ pensionMethod }) => pensionMethod == null)) return;
  unsupported.push({
    code: "missing-pension-method",
    detail: `${person.displayName} has a pension contribution without a contribution method.`,
  });
}

function flagExceededContributionAllowances({
  householdRule,
  isaContributionTotal,
  pensionAllowance,
  person,
  totalPensionContributions,
  unsupported,
}: {
  householdRule: HouseholdRule;
  isaContributionTotal: number;
  pensionAllowance: number;
  person: HouseholdTaxPerson;
  totalPensionContributions: number;
  unsupported: Array<{ code: string; detail: string }>;
}): void {
  if (
    householdRule != null &&
    isaContributionTotal > householdRule.isaAnnualAllowancePence
  ) {
    unsupported.push({
      code: "isa-allowance-exceeded",
      detail: `${person.displayName}'s recorded ISA subscriptions exceed the annual allowance.`,
    });
  }
  if (totalPensionContributions <= pensionAllowance) return;
  unsupported.push({
    code: "pension-annual-allowance-charge",
    detail: `${person.displayName}'s recorded pension input exceeds the available allowance. Carry forward and the annual allowance charge are not included.`,
  });
}

function calculatePerson(
  person: HouseholdTaxPerson,
  request: HouseholdTaxRequest,
): PersonTaxEstimate {
  const unsupported = unsupportedForPerson(person, request);
  const { householdRule, incomeRule, niRule, pensionRule } =
    resolvePersonRules(person, request, unsupported);

  const {
    contributions,
    excludedDisposals,
    excludedIncome,
    taxableDisposals,
    taxableIncome,
  } = selectPersonRecords(person, request, unsupported);
  const isaContributions = contributions.filter(({ kind }) => kind === "isa");
  const pensionContributions = contributions.filter(
    ({ kind }) => kind === "pension",
  );
  flagMissingPensionMethod(person, pensionContributions, unsupported);
  const employment = taxableIncome.filter(({ kind }) => kind === "employment");
  const savings = taxableIncome.filter(
    ({ kind }) => kind === "savings-interest",
  );
  const dividends = taxableIncome.filter(({ kind }) => kind === "dividend");
  const employmentPence = sum(employment.map(({ amountPence }) => amountPence));
  const savingsPence = sum(savings.map(({ amountPence }) => amountPence));
  const dividendPence = sum(dividends.map(({ amountPence }) => amountPence));
  const reliefAtSourcePence = sum(
    pensionContributions
      .filter(({ pensionMethod }) => pensionMethod === "relief-at-source")
      .map(({ amountPence }) => amountPence),
  );

  const personalAllowance = calculatePersonalAllowance(
    employmentPence,
    savingsPence,
    dividendPence,
    reliefAtSourcePence,
    incomeRule,
  );
  const employmentAfterAllowance = Math.max(0, employmentPence - personalAllowance);
  const remainingPersonalAllowance = Math.max(
    0,
    personalAllowance - employmentPence,
  );
  const savingsAfterPersonalAllowance = Math.max(
    0,
    savingsPence - remainingPersonalAllowance,
  );
  const remainingPersonalAllowanceAfterSavings = Math.max(
    0,
    remainingPersonalAllowance - savingsPence,
  );
  const dividendsAfterPersonalAllowance = Math.max(
    0,
    dividendPence - remainingPersonalAllowanceAfterSavings,
  );
  const bands = incomeRule?.bands.map((band, index) => ({
    ...band,
    widthPence:
      index === 0 && band.widthPence != null
        ? band.widthPence + reliefAtSourcePence
        : band.widthPence,
  })) ?? [];
  const incomeTaxPence = taxAcrossBands(employmentAfterAllowance, bands);
  const basicBandWidth = bands[0]?.widthPence ?? 0;
  const higherBandWidth = bands[1]?.widthPence ?? 0;
  const totalTaxableIncome =
    employmentAfterAllowance +
    savingsAfterPersonalAllowance +
    dividendsAfterPersonalAllowance;
  const personalSavingsAllowance = personalSavingsAllowanceFor(
    householdRule,
    totalTaxableIncome,
    basicBandWidth,
    higherBandWidth,
  );
  const startingRateForSavingsPence = startingRateForSavings(
    householdRule,
    savingsAfterPersonalAllowance,
    employmentAfterAllowance,
  );
  const savingsTaxPence = savingsTax(
    householdRule,
    savingsAfterPersonalAllowance,
    startingRateForSavingsPence + personalSavingsAllowance,
    employmentAfterAllowance,
    basicBandWidth,
    higherBandWidth,
  );
  const dividendTaxPence = dividendTax(
    householdRule,
    dividendsAfterPersonalAllowance,
    employmentAfterAllowance + savingsAfterPersonalAllowance,
    basicBandWidth,
    higherBandWidth,
  );

  const nationalInsurancePence = employmentNationalInsurance(
    employment,
    niRule,
  );

  const netGainPence = Math.max(
    0,
    sum(
      taxableDisposals.map(
        ({ proceedsPence, allowableCostPence, lossesAppliedPence }) =>
          proceedsPence - allowableCostPence - lossesAppliedPence,
      ),
    ),
  );
  const observedEmploymentPence = sum(
    employment
      .filter(({ evidence }) => evidence.kind === "observed")
      .map(({ amountPence }) => amountPence),
  );
  const observedSavingsPence = sum(
    savings
      .filter(({ evidence }) => evidence.kind === "observed")
      .map(({ amountPence }) => amountPence),
  );
  const observedDividendPence = sum(
    dividends
      .filter(({ evidence }) => evidence.kind === "observed")
      .map(({ amountPence }) => amountPence),
  );
  const observedReliefAtSourcePence = sum(
    pensionContributions
      .filter(
        ({ evidence, pensionMethod }) =>
          evidence.kind === "observed" && pensionMethod === "relief-at-source",
      )
      .map(({ amountPence }) => amountPence),
  );
  const observedNetGainPence = Math.max(
    0,
    sum(
      taxableDisposals
        .filter(({ evidence }) => evidence.kind === "observed")
        .map(
          ({ proceedsPence, allowableCostPence, lossesAppliedPence }) =>
            proceedsPence - allowableCostPence - lossesAppliedPence,
        ),
    ),
  );
  const annualExemptAmountPence =
    householdRule?.capitalGains.annualExemptAmountPence ?? 0;
  const bandConsumption = {
    observed: buildBandScenario({
      dividendPence: observedDividendPence,
      employmentPence: observedEmploymentPence,
      incomeRule,
      netGainPence: observedNetGainPence,
      reliefAtSourcePence: observedReliefAtSourcePence,
      savingsPence: observedSavingsPence,
      annualExemptAmountPence,
    }),
    projected: buildBandScenario({
      dividendPence,
      employmentPence,
      incomeRule,
      netGainPence,
      reliefAtSourcePence,
      savingsPence,
      annualExemptAmountPence,
    }),
  };
  const taxableGainPence = Math.max(
    0,
    netGainPence - annualExemptAmountPence,
  );
  const taxableIncomeForBands =
    employmentAfterAllowance +
    savingsAfterPersonalAllowance +
    dividendsAfterPersonalAllowance;
  const unusedBasicBand = Math.max(0, basicBandWidth - taxableIncomeForBands);
  const basicRateGain = Math.min(taxableGainPence, unusedBasicBand);
  const higherRateGain = taxableGainPence - basicRateGain;
  const capitalGainsTaxPence = householdRule
    ? roundTax(
        basicRateGain,
        householdRule.capitalGains.basicRateBasisPoints,
      ) +
      roundTax(
        higherRateGain,
        householdRule.capitalGains.higherRateBasisPoints,
      )
    : 0;

  const totalPensionContributions = sum(
    pensionContributions.map(({ amountPence }) => amountPence),
  );
  const observedPensionContributions = sum(
    pensionContributions
      .filter(({ evidence }) => evidence.kind === "observed")
      .map(({ amountPence }) => amountPence),
  );
  const employerPensionContributions = sum(
    pensionContributions
      .filter(({ employerContribution }) => employerContribution)
      .map(({ amountPence }) => amountPence),
  );
  const pensionAllowance = calculatePensionAllowance(
    person,
    employmentPence,
    savingsPence,
    dividendPence,
    reliefAtSourcePence,
    employerPensionContributions,
    pensionRule,
  );
  const isaContributionTotal = sum(
    isaContributions.map(({ amountPence }) => amountPence),
  );
  const observedIsaContributions = sum(
    isaContributions
      .filter(({ evidence }) => evidence.kind === "observed")
      .map(({ amountPence }) => amountPence),
  );
  flagExceededContributionAllowances({
    householdRule,
    isaContributionTotal,
    pensionAllowance,
    person,
    totalPensionContributions,
    unsupported,
  });

  const available = unsupported.length === 0;
  const totalTaxPence = available
    ? incomeTaxPence +
      savingsTaxPence +
      dividendTaxPence +
      nationalInsurancePence +
      capitalGainsTaxPence
    : null;
  return {
    memberId: person.memberId,
    displayName: person.displayName,
    available,
    unsupported,
    totalTaxPence,
    incomeTax: {
      amountPence: incomeTaxPence,
      explanation: `Applied the Personal Allowance and ${jurisdictionLabel(person.jurisdiction)} non-savings bands to recorded employment income.`,
      recordIds: employment.map(({ id }) => id),
      ruleIds: incomeRule ? [incomeRule.id] : [],
    },
    savingsTax: {
      amountPence: savingsTaxPence,
      explanation:
        "Applied remaining Personal Allowance, the starting rate for savings, the band-dependent Personal Savings Allowance, then savings rates in band order.",
      recordIds: savings.map(({ id }) => id),
      ruleIds: householdRule ? [householdRule.id] : [],
    },
    dividendTax: {
      amountPence: dividendTaxPence,
      explanation: "Applied remaining Personal Allowance, the Dividend Allowance, then dividend rates in band order.",
      recordIds: dividends.map(({ id }) => id),
      ruleIds: householdRule ? [householdRule.id] : [],
    },
    nationalInsurance: {
      amountPence: nationalInsurancePence,
      explanation: "Estimated employee Class 1 category A contributions as twelve equal monthly pay periods for each employment.",
      recordIds: employment.map(({ id }) => id),
      ruleIds: niRule ? [niRule.id] : [],
    },
    capitalGainsTax: {
      amountPence: capitalGainsTaxPence,
      explanation: "Applied recorded costs and losses, the annual exempt amount, and remaining basic-rate band to taxable-account disposals.",
      recordIds: taxableDisposals.map(({ id }) => id),
      ruleIds: householdRule ? [householdRule.id] : [],
    },
    bandConsumption,
    allowances: {
      personalAllowancePence: personalAllowance,
      startingRateForSavingsPence,
      personalSavingsAllowancePence: personalSavingsAllowance,
      dividendAllowancePence: householdRule?.dividendAllowancePence ?? 0,
      capitalGainsAnnualExemptAmountPence: annualExemptAmountPence,
      isaAllowancePence: householdRule?.isaAnnualAllowancePence ?? 0,
      isaObservedContributionsPence: observedIsaContributions,
      isaContributionsPence: isaContributionTotal,
      pensionAllowancePence: pensionAllowance,
      pensionObservedContributionsPence: observedPensionContributions,
      pensionContributionsPence: totalPensionContributions,
    },
    excludedWrapperRecordIds: [
      ...excludedIncome.map(({ id }) => id),
      ...excludedDisposals.map(({ id }) => id),
    ],
  };
}

export function calculateHouseholdTaxPosition(
  request: HouseholdTaxRequest,
): HouseholdTaxEstimate {
  const people = request.people.map((person) => calculatePerson(person, request));
  const available = people.length > 0 && people.every((person) => person.available);
  const unsupportedByKey = new Map(
    [
      ...request.unsupportedCases,
      ...people.flatMap(({ unsupported }) => unsupported),
    ].map((issue) => [`${issue.code}\0${issue.detail}`, issue]),
  );
  const records = [
    ...request.people,
    ...request.incomes,
    ...request.disposals,
    ...request.contributions,
  ];
  const ruleIds = [
    ...new Set(
      people.flatMap((person) => [
        ...person.incomeTax.ruleIds,
        ...person.savingsTax.ruleIds,
        ...person.dividendTax.ruleIds,
        ...person.nationalInsurance.ruleIds,
        ...person.capitalGainsTax.ruleIds,
      ]),
    ),
    ...ruleDataset.pensions
      .filter(({ taxYear }) => taxYear === request.taxYear)
      .map(({ id }) => id),
  ];
  const sourceIds = new Set(
    [
      ...ruleDataset.incomeTax,
      ...ruleDataset.nationalInsurance,
      ...ruleDataset.pensions,
      ...ruleDataset.householdTax,
    ]
      .filter(({ id }) => ruleIds.includes(id))
      .flatMap(({ provenance }) => provenance.sourceIds),
  );
  return {
    kind: "uk-household-tax-estimate",
    calculationVersion: "1",
    taxYear: request.taxYear,
    isEstimate: true,
    available,
    totalTaxPence: available
      ? sum(people.map(({ totalTaxPence }) => totalTaxPence ?? 0))
      : null,
    people,
    unsupported: [...unsupportedByKey.values()],
    lineage: {
      ruleDatasetVersion: ruleDataset.datasetVersion,
      ruleIds,
      sources: ruleDataset.sources
        .filter(({ id }) => sourceIds.has(id))
        .map(({ id, title, url }) => ({ id, title, url })),
      observedRecordIds: records
        .filter(({ evidence }) => evidence.kind === "observed")
        .map(({ evidence }) => evidence.sourceRecordId),
      assumptionRecordIds: records
        .filter(({ evidence }) => evidence.kind === "assumption")
        .map(({ evidence }) => evidence.sourceRecordId),
      holdingRecordIds: request.accounts.flatMap(
        ({ holdingRecordIds }) => holdingRecordIds,
      ),
      rounding: "Each tax component is rounded to the nearest penny after applying its rate.",
    },
  };
}
