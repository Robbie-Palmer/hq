import { z } from "zod";
import type { AssetTrackerRepository } from "./assetTrackerRepository";
import { CurrencySchema } from "./currency";
import type { DecisionScenarioComparison } from "./decisionScenario";
import { settledCashFlowAmount } from "./futureCashFlow";
import { convertAccountAmountAtDate } from "./portfolioValuation";

export const DecisionLineageKindSchema = z.enum([
  "financial-fact",
  "rate",
  "tax-rule",
  "assumption",
]);
export type DecisionLineageKind = z.infer<typeof DecisionLineageKindSchema>;

export const DecisionLineageItemSchema = z.object({
  id: z.string().min(1),
  kind: DecisionLineageKindSchema,
  label: z.string().trim().min(1),
  value: z.string().trim().min(1),
  source: z.string().trim().min(1),
  validAt: z.iso.date(),
  version: z.string().trim().min(1).optional(),
});
export type DecisionLineageItem = z.infer<typeof DecisionLineageItemSchema>;

export const DecisionForecastCheckpointSchema = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1),
  dueDate: z.iso.date(),
  expectedAmount: z.number(),
  currency: CurrencySchema,
});
export type DecisionForecastCheckpoint = z.infer<
  typeof DecisionForecastCheckpointSchema
>;

const DecisionForecastSnapshotBaseSchema = z.object({
  capturedAt: z.iso.datetime({ offset: true }),
  calculationVersion: z.string().trim().min(1),
  lineage: z.array(DecisionLineageItemSchema).min(4),
  checkpoints: z.array(DecisionForecastCheckpointSchema).min(1),
});

function validateForecastLineage(
  forecast: { lineage: DecisionLineageItem[] },
  context: z.core.$RefinementCtx,
) {
  for (const kind of DecisionLineageKindSchema.options) {
    if (!forecast.lineage.some((item) => item.kind === kind)) {
      context.addIssue({
        code: "custom",
        message: `Forecast lineage must include a ${kind}`,
        path: ["lineage"],
      });
    }
  }
}

export const DecisionForecastSnapshotSchema =
  DecisionForecastSnapshotBaseSchema.superRefine(validateForecastLineage);
export type DecisionForecastSnapshot = z.infer<
  typeof DecisionForecastSnapshotSchema
>;

export const DecisionDivergenceSourceSchema = z.object({
  kind: z.enum(["changed-assumption", "changed-reality"]),
  label: z.string().trim().min(1),
  impactAmount: z.number(),
});
export type DecisionDivergenceSource = z.infer<
  typeof DecisionDivergenceSourceSchema
>;

export const DecisionObservationSchema = z.object({
  id: z.string().min(1),
  checkpointId: z.string().min(1),
  observedAt: z.iso.datetime({ offset: true }),
  actualAmount: z.number(),
  note: z.string().trim().min(1),
  divergenceSources: z.array(DecisionDivergenceSourceSchema),
});
export type DecisionObservation = z.infer<typeof DecisionObservationSchema>;

export const DecisionInterpretationSchema = z.object({
  id: z.string().min(1),
  createdAt: z.iso.datetime({ offset: true }),
  reason: z.string().trim().min(1),
  revisedRationale: z.string().trim().min(1),
  assumptionChanges: z
    .array(
      z.object({
        label: z.string().trim().min(1),
        previousValue: z.string().trim().min(1),
        revisedValue: z.string().trim().min(1),
      }),
    )
    .min(1),
});
export type DecisionInterpretation = z.infer<
  typeof DecisionInterpretationSchema
>;

export const TrackedFinancialDecisionRecordSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("tracked"),
  question: z.string().trim().min(1),
  decisionDate: z.iso.date(),
  selectedScenario: z.object({
    id: z.string().min(1),
    label: z.string().trim().min(1),
  }),
  rationale: z.string().trim().min(1),
  action: z.string().trim().min(1),
  forecast: DecisionForecastSnapshotSchema,
  observations: z.array(DecisionObservationSchema).default([]),
  interpretations: z.array(DecisionInterpretationSchema).default([]),
});
export type TrackedFinancialDecisionRecord = z.infer<
  typeof TrackedFinancialDecisionRecordSchema
>;

const AdoptedDecisionReferenceSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  planningCaseId: z.string().min(1).optional(),
});

const AdoptedPlanningCaseReferenceSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
});

const AdoptedCommitmentReferenceSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
});

const AdoptedSourceBalanceSchema = z.object({
  accountId: z.string().min(1),
  accountName: z.string().trim().min(1),
  date: z.iso.date(),
  balance: z.number(),
  currency: CurrencySchema,
});

const AdoptedAssumptionSetReferenceSchema = z.object({
  id: z.string().min(1),
  seriesId: z.string().min(1),
  name: z.string().trim().min(1),
  version: z.number().int().positive(),
  incomeAssumptionIds: z.array(z.string().min(1)),
  expenditureAssumptionIds: z.array(z.string().min(1)),
});

const AdoptedRateReferenceSchema = z.object({
  accountId: z.string().min(1),
  accountName: z.string().trim().min(1),
  annualRate: z.number().gt(-1),
  effectiveDate: z.iso.date(),
});

export const AdoptedForecastActionSchema = z.object({
  id: z.string().min(1),
  sourceDecisionId: z.string().min(1),
  sourceStageId: z.string().min(1),
  accountId: z.string().min(1),
  date: z.iso.date(),
  cadence: z.enum(["once", "monthly"]),
  kind: z.enum(["saving", "transfer", "payment", "receipt"]),
  name: z.string().trim().min(1),
  accountName: z.string().trim().min(1),
  amount: z.number().nonnegative(),
  currency: CurrencySchema,
});
export type AdoptedForecastAction = z.infer<typeof AdoptedForecastActionSchema>;

const AdoptedBalanceCheckpointSchema = z.object({
  date: z.iso.date(),
  accounts: z.array(
    z.object({
      accountId: z.string().min(1),
      accountName: z.string().trim().min(1),
      expectedBalance: z.number(),
      currency: CurrencySchema,
    }),
  ),
});

const AdoptedDecisionReviewSchema = z.object({
  id: z.string().min(1),
  decisionId: z.string().min(1),
  requestedAt: z.iso.datetime({ offset: true }),
  reason: z.string().trim().min(1),
});

export const AdoptedDecisionForecastRecordSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("adopted-forecast"),
  title: z.string().trim().min(1),
  adoptedAt: z.iso.datetime({ offset: true }),
  calculationVersion: z.string().trim().min(1),
  selectedDecisions: z.array(AdoptedDecisionReferenceSchema).min(1),
  undecidedDecisions: z.array(AdoptedDecisionReferenceSchema),
  planningCases: z.array(AdoptedPlanningCaseReferenceSchema),
  commitments: z.array(AdoptedCommitmentReferenceSchema),
  sourceBalances: z.array(AdoptedSourceBalanceSchema).min(1),
  assumptionSets: z.array(AdoptedAssumptionSetReferenceSchema),
  reservePreference: z.object({
    emergencyFundPlanId: z.string().min(1).optional(),
    coverageMonths: z.number().nonnegative().nullable(),
  }),
  rates: z.array(AdoptedRateReferenceSchema),
  actions: z.array(AdoptedForecastActionSchema),
  balanceCheckpoints: z.array(AdoptedBalanceCheckpointSchema).min(1),
  reviews: z.array(AdoptedDecisionReviewSchema).default([]),
});
export type AdoptedDecisionForecastRecord = z.infer<
  typeof AdoptedDecisionForecastRecordSchema
>;

export const AdoptDecisionForecastInputSchema =
  AdoptedDecisionForecastRecordSchema.omit({
    id: true,
    kind: true,
    adoptedAt: true,
    reviews: true,
  });
export type AdoptDecisionForecastInput = z.input<
  typeof AdoptDecisionForecastInputSchema
>;

export const RevisitAdoptedDecisionInputSchema = z.object({
  forecastId: z.string().min(1),
  decisionId: z.string().min(1),
  reason: z.string().trim().min(1),
});
export type RevisitAdoptedDecisionInput = z.input<
  typeof RevisitAdoptedDecisionInputSchema
>;

export const LegacyMortgageDecisionRecordSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("mortgage"),
  title: z.string().trim().min(1),
  scenarioId: z.string().min(1),
  recordedAt: z.iso.date(),
  status: z.literal("recorded"),
});

export const FinancialDecisionRecordSchema = z.discriminatedUnion("kind", [
  LegacyMortgageDecisionRecordSchema,
  TrackedFinancialDecisionRecordSchema,
  AdoptedDecisionForecastRecordSchema,
]);
export type FinancialDecisionRecord = z.infer<
  typeof FinancialDecisionRecordSchema
>;

export const CreateDecisionRecordInputSchema =
  TrackedFinancialDecisionRecordSchema.omit({
    id: true,
    kind: true,
    observations: true,
    interpretations: true,
    forecast: true,
  }).extend({
    forecast: DecisionForecastSnapshotBaseSchema.omit({
      capturedAt: true,
    }).superRefine(validateForecastLineage),
  });
export type CreateDecisionRecordInput = z.input<
  typeof CreateDecisionRecordInputSchema
>;

export const RecordDecisionObservationInputSchema = z.object({
  decisionId: z.string().min(1),
  checkpointId: z.string().min(1),
  actualAmount: z.number(),
  note: z.string().trim().min(1),
  divergenceSources: z.array(DecisionDivergenceSourceSchema),
});
export type RecordDecisionObservationInput = z.input<
  typeof RecordDecisionObservationInputSchema
>;

export const AddDecisionInterpretationInputSchema = z.object({
  decisionId: z.string().min(1),
  reason: z.string().trim().min(1),
  revisedRationale: z.string().trim().min(1),
  assumptionChanges: DecisionInterpretationSchema.shape.assumptionChanges,
});
export type AddDecisionInterpretationInput = z.input<
  typeof AddDecisionInterpretationInputSchema
>;

export type DecisionReconciliation = {
  checkpoint: DecisionForecastCheckpoint;
  observation: DecisionObservation | null;
  variance: number | null;
  largestDivergenceSources: DecisionDivergenceSource[];
};

export function reconcileDecisionRecord(
  decision: TrackedFinancialDecisionRecord,
): DecisionReconciliation[] {
  const observations = new Map(
    decision.observations.map((observation) => [
      observation.checkpointId,
      observation,
    ]),
  );
  return decision.forecast.checkpoints.map((checkpoint) => {
    const observation = observations.get(checkpoint.id) ?? null;
    return {
      checkpoint,
      observation,
      variance:
        observation == null
          ? null
          : observation.actualAmount - checkpoint.expectedAmount,
      largestDivergenceSources:
        observation?.divergenceSources
          .toSorted(
            (left, right) =>
              Math.abs(right.impactAmount) - Math.abs(left.impactAmount),
          )
          .slice(0, 3) ?? [],
    };
  });
}

export function buildAdoptDecisionForecastInput(
  repository: AssetTrackerRepository,
  comparison: DecisionScenarioComparison,
  input: {
    title: string;
    calculationVersion: string;
    reserveMonths: number | null;
  },
): AdoptDecisionForecastInput {
  const selectedIds = new Set(comparison.includedDecisionIds);
  const selectedDecisions = repository.futureCashFlows.flatMap((record) =>
    record.kind === "decision" && selectedIds.has(record.id)
      ? [
          {
            id: record.id,
            name: record.name,
            ...(record.planningCaseId == null
              ? {}
              : { planningCaseId: record.planningCaseId }),
          },
        ]
      : [],
  );
  const undecidedDecisions = repository.futureCashFlows.flatMap((record) =>
    record.kind === "decision" &&
    record.status === "considering" &&
    !selectedIds.has(record.id)
      ? [
          {
            id: record.id,
            name: record.name,
            ...(record.planningCaseId == null
              ? {}
              : { planningCaseId: record.planningCaseId }),
          },
        ]
      : [],
  );
  const commitments = repository.futureCashFlows.flatMap((record) =>
    record.kind === "commitment" && record.status === "active"
      ? [{ id: record.id, name: record.name }]
      : [],
  );
  const planningCaseIds = new Set(
    repository.futureCashFlows.flatMap((record) => {
      const included =
        (record.kind === "commitment" && record.status === "active") ||
        selectedIds.has(record.id);
      return included && record.planningCaseId != null
        ? [record.planningCaseId]
        : [];
    }),
  );
  const planningCases = repository.planningCases.flatMap((planningCase) =>
    planningCaseIds.has(planningCase.id)
      ? [{ id: planningCase.id, name: planningCase.name }]
      : [],
  );
  const latestBalances = new Map<
    string,
    (typeof repository.snapshots)[number]
  >();
  for (const snapshot of repository.snapshots) {
    const latest = latestBalances.get(snapshot.accountId);
    if (latest == null || latest.date < snapshot.date) {
      latestBalances.set(snapshot.accountId, snapshot);
    }
  }
  const sourceBalances = Array.from(latestBalances.values()).flatMap(
    (snapshot) => {
      const account = repository.accounts.get(snapshot.accountId);
      return account == null
        ? []
        : [
            {
              accountId: account.id,
              accountName: account.name,
              date: snapshot.date,
              balance: snapshot.balance,
              currency: account.currency,
            },
          ];
    },
  );
  const assumptionSets = repository.forecastAssumptionSets
    .filter(({ status }) => status === "active")
    .map((set) => ({
      id: set.id,
      seriesId: set.seriesId,
      name: set.name,
      version: set.version,
      incomeAssumptionIds: set.assumptions
        .filter(({ kind }) => kind === "income")
        .map(({ id }) => id),
      expenditureAssumptionIds: set.assumptions
        .filter(({ kind }) => kind === "expenditure")
        .map(({ id }) => id),
    }));
  const activeReservePlan = repository.emergencyFundPlans.find(
    ({ status }) => status === "active",
  );
  const rates = Array.from(
    new Map(
      comparison.fundingMechanics.map((mechanic) => [
        `${mechanic.accountId}:${mechanic.annualReturn}`,
        {
          accountId: mechanic.accountId,
          accountName: mechanic.accountName,
          annualRate: mechanic.annualReturn,
          effectiveDate:
            comparison.actions.find(
              (action) => action.accountId === mechanic.accountId,
            )?.date ??
            comparison.timeline[0]?.date ??
            "1970-01-01",
        },
      ]),
    ).values(),
  );
  const actions = comparison.actions.map((action) => {
    const kind = action.kind === "asset-sale" ? "transfer" : action.kind;
    return {
      id: action.id,
      sourceDecisionId: action.sourceDecisionId,
      sourceStageId: action.sourceStageId,
      accountId: action.accountId,
      date: action.date,
      cadence: action.cadence,
      kind,
      name: action.name,
      accountName: action.accountName,
      amount: action.amount,
      currency: action.currency,
    };
  });
  const balanceCheckpoints = comparison.timeline
    .filter(({ isMaterialDate }) => isMaterialDate)
    .map((point) => ({
      date: point.date,
      accounts: point.accountEffects.map((account) => ({
        accountId: account.accountId,
        accountName: account.accountName,
        expectedBalance: account.expectedBalance,
        currency: repository.settings.baseCurrency,
      })),
    }));
  return AdoptDecisionForecastInputSchema.parse({
    title: input.title,
    calculationVersion: input.calculationVersion,
    selectedDecisions,
    undecidedDecisions,
    planningCases,
    commitments,
    sourceBalances,
    assumptionSets,
    reservePreference: {
      ...(activeReservePlan == null
        ? {}
        : { emergencyFundPlanId: activeReservePlan.id }),
      coverageMonths: input.reserveMonths,
    },
    rates,
    actions,
    balanceCheckpoints,
  });
}

export type AdoptedActionReconciliation = {
  action: AdoptedForecastAction;
  actualAmount: number | null;
  actualDate: string | null;
  amountVariance: number | null;
  timingVarianceDays: number | null;
};

export type AdoptedBalanceReconciliation = {
  checkpointDate: string;
  accountId: string;
  accountName: string;
  currency: z.infer<typeof CurrencySchema>;
  expectedBalance: number;
  observedBalance: number | null;
  observedAt: string | null;
  variance: number | null;
};

export type AdoptedForecastVarianceSource = {
  kind:
    | "changed-amount"
    | "changed-timing"
    | "household-cash-flow"
    | "market-or-currency"
    | "revised-assumption";
  label: string;
  amount: number | null;
  decisionId: string | null;
};

export type AdoptedForecastReconciliation = {
  actions: AdoptedActionReconciliation[];
  balances: AdoptedBalanceReconciliation[];
  varianceSources: AdoptedForecastVarianceSource[];
};

function calendarDayDifference(left: string, right: string): number {
  return Math.round(
    (Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) /
      86_400_000,
  );
}

function actualsForAction(
  repository: AssetTrackerRepository,
  action: AdoptedForecastAction,
) {
  const record = repository.futureCashFlows.find(
    ({ id }) => id === action.sourceDecisionId,
  );
  const stage = record?.stages.find(({ id }) => id === action.sourceStageId);
  return stage?.actuals ?? [];
}

function firstBalanceOnOrAfter(
  repository: AssetTrackerRepository,
  accountId: string,
  date: string,
) {
  return repository.snapshots
    .filter(
      (snapshot) => snapshot.accountId === accountId && snapshot.date >= date,
    )
    .toSorted((left, right) => left.date.localeCompare(right.date))[0];
}

function reconcileAdoptedActions(
  forecast: AdoptedDecisionForecastRecord,
  repository: AssetTrackerRepository,
): AdoptedActionReconciliation[] {
  return forecast.actions.map((action) => {
    if (action.kind === "saving") {
      return {
        action,
        actualAmount: null,
        actualDate: null,
        amountVariance: null,
        timingVarianceDays: null,
      };
    }
    const actuals = actualsForAction(repository, action);
    const actualAmount =
      actuals.length === 0 ? null : settledCashFlowAmount(actuals);
    const actualDate = actuals.at(-1)?.date ?? null;
    return {
      action,
      actualAmount,
      actualDate,
      amountVariance:
        actualAmount == null ? null : actualAmount - action.amount,
      timingVarianceDays:
        actualDate == null
          ? null
          : calendarDayDifference(actualDate, action.date),
    };
  });
}

function reconcileAdoptedBalances(
  forecast: AdoptedDecisionForecastRecord,
  repository: AssetTrackerRepository,
): AdoptedBalanceReconciliation[] {
  return forecast.balanceCheckpoints.flatMap((checkpoint) =>
    checkpoint.accounts.map((account) => {
      const observation = firstBalanceOnOrAfter(
        repository,
        account.accountId,
        checkpoint.date,
      );
      const observedBalance =
        observation == null
          ? null
          : convertAccountAmountAtDate(
              repository,
              account.accountId,
              observation.balance,
              observation.date,
            );
      return {
        checkpointDate: checkpoint.date,
        accountId: account.accountId,
        accountName: account.accountName,
        currency: account.currency,
        expectedBalance: account.expectedBalance,
        observedBalance,
        observedAt: observation?.date ?? null,
        variance:
          observedBalance == null
            ? null
            : observedBalance - account.expectedBalance,
      };
    }),
  );
}

function actionVarianceSources(
  actions: readonly AdoptedActionReconciliation[],
): AdoptedForecastVarianceSource[] {
  return actions.flatMap((action) => {
    const sources: AdoptedForecastVarianceSource[] = [];
    if (
      action.amountVariance != null &&
      Math.abs(action.amountVariance) >= 0.01
    ) {
      sources.push({
        kind: "changed-amount",
        label: `${action.action.name} differed from the adopted amount`,
        amount: action.amountVariance,
        decisionId: action.action.sourceDecisionId,
      });
    }
    if (action.timingVarianceDays != null && action.timingVarianceDays !== 0) {
      sources.push({
        kind: "changed-timing",
        label: `${action.action.name} occurred ${Math.abs(action.timingVarianceDays)} days ${action.timingVarianceDays > 0 ? "late" : "early"}`,
        amount: null,
        decisionId: action.action.sourceDecisionId,
      });
    }
    return sources;
  });
}

function householdCashFlowSources(
  forecast: AdoptedDecisionForecastRecord,
  repository: AssetTrackerRepository,
): AdoptedForecastVarianceSource[] {
  const sourceBalanceDates = new Map(
    forecast.sourceBalances.map((balance) => [balance.accountId, balance.date]),
  );
  const lastCheckpointDate = forecast.balanceCheckpoints.at(-1)?.date;
  return repository.capitalFlows.flatMap((flow) => {
    const sourceDate = sourceBalanceDates.get(flow.accountId);
    if (
      sourceDate == null ||
      flow.date <= sourceDate ||
      (lastCheckpointDate != null && flow.date > lastCheckpointDate)
    ) {
      return [];
    }
    return [
      {
        kind: "household-cash-flow" as const,
        label: `Recorded household cash flow on ${repository.accounts.get(flow.accountId)?.name ?? flow.accountId}`,
        amount: flow.amount,
        decisionId: null,
      },
    ];
  });
}

function balanceVarianceSources(
  balances: readonly AdoptedBalanceReconciliation[],
): AdoptedForecastVarianceSource[] {
  return balances.flatMap((balance) =>
    balance.variance == null || Math.abs(balance.variance) < 0.01
      ? []
      : [
          {
            kind: "market-or-currency" as const,
            label: `${balance.accountName} moved away from its adopted trajectory`,
            amount: balance.variance,
            decisionId: null,
          },
        ],
  );
}

function assumptionVarianceSources(
  forecast: AdoptedDecisionForecastRecord,
  repository: AssetTrackerRepository,
): AdoptedForecastVarianceSource[] {
  const currentSets = new Map(
    repository.forecastAssumptionSets
      .filter(({ status }) => status === "active")
      .map((set) => [set.seriesId, set]),
  );
  return forecast.assumptionSets.flatMap((assumed) => {
    const current = currentSets.get(assumed.seriesId);
    if (current?.id === assumed.id) return [];
    return [
      {
        kind: "revised-assumption" as const,
        label:
          current == null
            ? `${assumed.name} is no longer active`
            : `${assumed.name} changed from version ${assumed.version} to ${current.version}`,
        amount: null,
        decisionId: null,
      },
    ];
  });
}

export function reconcileAdoptedDecisionForecast(
  forecast: AdoptedDecisionForecastRecord,
  repository: AssetTrackerRepository,
): AdoptedForecastReconciliation {
  const actions = reconcileAdoptedActions(forecast, repository);
  const balances = reconcileAdoptedBalances(forecast, repository);
  const varianceSources = [
    ...actionVarianceSources(actions),
    ...householdCashFlowSources(forecast, repository),
    ...balanceVarianceSources(balances),
    ...assumptionVarianceSources(forecast, repository),
  ];
  return { actions, balances, varianceSources };
}
