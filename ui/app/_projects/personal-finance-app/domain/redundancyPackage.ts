import {
  calculateTerminationPayment,
  type TERMINATION_PAYMENT_RULESET,
  TerminationPaymentComponentKindSchema,
  type TerminationPaymentTreatment,
} from "finance-tax-rules/termination-payment";
import { z } from "zod";
import { AccountIdSchema } from "./account";
import { CurrencySchema } from "./currency";
import {
  type CashFlowAmountBreakdown,
  type Commitment,
  CommitmentSchema,
} from "./futureCashFlow";

const EvidenceBasisSchema = z.enum(["observed", "assumed"]);

function evidenced<T extends z.ZodType>(valueSchema: T) {
  return z.object({
    value: valueSchema,
    basis: EvidenceBasisSchema,
  });
}

const EvidencedDateSchema = evidenced(z.iso.date());
const EvidencedMoneySchema = evidenced(z.number().positive());
const EvidencedBooleanSchema = evidenced(z.boolean());

const RedundancyPackageSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("document"),
    title: z.string().trim().min(1),
    reference: z.string().trim().min(1),
    url: z.url().optional(),
  }),
  z.object({
    kind: z.literal("note"),
    title: z.string().trim().min(1),
    note: z.string().trim().min(1),
  }),
]);

const RedundancyGrossComponentSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  kind: TerminationPaymentComponentKindSchema,
  amount: EvidencedMoneySchema,
});

const RedundancyDeductionSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  kind: z.enum(["income-tax", "employee-national-insurance", "fee", "other"]),
  amount: EvidencedMoneySchema,
});

const RedundancyPaymentSchema = z
  .object({
    id: z.string().trim().min(1),
    paymentDate: EvidencedDateSchema,
    destinationAccountId: evidenced(AccountIdSchema),
    pensionDestinationAccountId: evidenced(AccountIdSchema).optional(),
    grossComponents: z.array(RedundancyGrossComponentSchema).min(1),
    deductions: z.array(RedundancyDeductionSchema).default([]),
    netAmount: EvidencedMoneySchema.optional(),
  })
  .superRefine((payment, context) => {
    const componentIds = payment.grossComponents.map(({ id }) => id);
    if (new Set(componentIds).size !== componentIds.length) {
      context.addIssue({
        code: "custom",
        path: ["grossComponents"],
        message: "Gross component IDs must be unique within a payment",
      });
    }
    const deductionIds = payment.deductions.map(({ id }) => id);
    if (new Set(deductionIds).size !== deductionIds.length) {
      context.addIssue({
        code: "custom",
        path: ["deductions"],
        message: "Deduction IDs must be unique within a payment",
      });
    }
    if (
      payment.grossComponents.some(
        ({ kind }) => kind === "employer-pension-contribution",
      ) &&
      payment.pensionDestinationAccountId == null
    ) {
      context.addIssue({
        code: "custom",
        path: ["pensionDestinationAccountId"],
        message: "Employer pension contributions need a destination account",
      });
    }
  });

const RedundancyCalculationFactsSchema = z.object({
  jurisdiction: evidenced(z.string().trim().min(1)),
  residence: evidenced(z.enum(["full-year-uk", "partial-year", "non-uk"])),
  noticeTreatment: evidenced(
    z.enum([
      "worked-or-paid-in-full",
      "employer-confirmed-no-penp",
      "reduced-or-unknown",
    ]),
  ),
  priorSection403Awards: evidenced(z.number().nonnegative()).default({
    value: 0,
    basis: "assumed",
  }),
  hasOtherTaxInteractions: EvidencedBooleanSchema.default({
    value: false,
    basis: "assumed",
  }),
});

export const RedundancyPackageSchema = z
  .object({
    id: z.string().trim().min(1),
    version: z.number().int().positive(),
    correctsVersion: z.number().int().positive().optional(),
    recordedAt: z.iso.datetime({ offset: true }),
    name: z.string().trim().min(1),
    employer: z.string().trim().min(1),
    offerDate: EvidencedDateSchema,
    leavingDate: EvidencedDateSchema,
    currency: evidenced(CurrencySchema),
    source: RedundancyPackageSourceSchema,
    calculationFacts: RedundancyCalculationFactsSchema,
    payments: z.array(RedundancyPaymentSchema).min(1),
  })
  .superRefine((record, context) => {
    if (record.leavingDate.value < record.offerDate.value) {
      context.addIssue({
        code: "custom",
        path: ["leavingDate"],
        message: "Leaving date cannot be before the offer date",
      });
    }
    if (
      (record.version === 1 && record.correctsVersion != null) ||
      (record.version > 1 && record.correctsVersion !== record.version - 1)
    ) {
      context.addIssue({
        code: "custom",
        path: ["correctsVersion"],
        message: "A correction must identify the immediately preceding version",
      });
    }
    const paymentIds = record.payments.map(({ id }) => id);
    if (new Set(paymentIds).size !== paymentIds.length) {
      context.addIssue({
        code: "custom",
        path: ["payments"],
        message: "Payment IDs must be unique",
      });
    }
    for (const [index, payment] of record.payments.entries()) {
      if (payment.paymentDate.value < record.offerDate.value) {
        context.addIssue({
          code: "custom",
          path: ["payments", index, "paymentDate"],
          message: "Payment date cannot be before the offer date",
        });
      }
    }
  });
export type RedundancyPackage = z.infer<typeof RedundancyPackageSchema>;

export type RedundancyPackageComponentTreatment =
  TerminationPaymentTreatment & {
    paymentId: string;
    label: string;
    amount: number;
  };

type RedundancyPackageAdapterBase = {
  record: RedundancyPackage;
  treatments: RedundancyPackageComponentTreatment[];
  reasons: string[];
  lineage: {
    calculationVersion: "termination-payment-v1";
    ruleSetId: typeof TERMINATION_PAYMENT_RULESET.id;
    ruleSetVersion: typeof TERMINATION_PAYMENT_RULESET.version;
    sourceIds: string[];
  };
};

export type RedundancyPackageAdapterResult =
  | (RedundancyPackageAdapterBase & {
      available: true;
      mode: "employer-net" | "reviewed-rules" | "mixed";
      futureCashFlows: Commitment[];
    })
  | (RedundancyPackageAdapterBase & {
      available: false;
      manualNetRequiredForPaymentIds: string[];
      futureCashFlows: [];
    });

const toPence = (amount: number) => Math.round(amount * 100);
const sum = (amounts: readonly number[]) =>
  amounts.reduce((total, amount) => total + amount, 0);

function sourceDescription(source: RedundancyPackage["source"]): string {
  return source.kind === "document"
    ? `${source.title} (${source.reference})`
    : `${source.title}: ${source.note}`;
}

function cashComponentAmount(payment: RedundancyPackage["payments"][number]) {
  return sum(
    payment.grossComponents
      .filter(
        ({ kind }) =>
          kind !== "employer-pension-contribution" &&
          kind !== "employer-paid-legal-costs" &&
          kind !== "non-cash-benefit",
      )
      .map(({ amount }) => amount.value),
  );
}

function amountBreakdown(
  payment: RedundancyPackage["payments"][number],
  netAmount: number,
  lineage: string[],
  source: string,
): CashFlowAmountBreakdown | undefined {
  const grossAmount = cashComponentAmount(payment);
  if (grossAmount <= 0) return undefined;
  const taxAmount = sum(
    payment.deductions
      .filter(({ kind }) => kind === "income-tax")
      .map(({ amount }) => amount.value),
  );
  const feeAmount = sum(
    payment.deductions
      .filter(({ kind }) => kind === "fee")
      .map(({ amount }) => amount.value),
  );
  const deductions = payment.deductions
    .filter(({ kind }) => kind !== "income-tax" && kind !== "fee")
    .map(({ label, amount }) => ({ label, amount: amount.value }));
  const knownNet =
    grossAmount -
    taxAmount -
    feeAmount -
    sum(deductions.map(({ amount }) => amount));
  if (knownNet + 0.005 < netAmount) return undefined;
  if (knownNet - netAmount > 0.005) {
    deductions.push({
      label: "Unitemised deduction in employer net amount",
      amount: knownNet - netAmount,
    });
  }
  return {
    grossAmount,
    taxAmount,
    feeAmount,
    deductions,
    netAmount,
    sourceNotes: source,
    calculationLineage: lineage,
  };
}

function commitmentNotes(
  record: RedundancyPackage,
  mode: "employer-net" | "reviewed-rules" | "mixed",
) {
  return [
    `Source: ${sourceDescription(record.source)}.`,
    `Offer ${record.offerDate.value}; leaving ${record.leavingDate.value}.`,
    `Net mode: ${mode}. Package record ${record.id} version ${record.version}.`,
  ].join(" ");
}

export function adaptRedundancyPackage(
  input: RedundancyPackage,
): RedundancyPackageAdapterResult {
  const record = RedundancyPackageSchema.parse(input);
  const components = record.payments.flatMap((payment) =>
    payment.grossComponents.map((component) => ({
      id: `${payment.id}:${component.id}`,
      kind: component.kind,
      amountPence: toPence(component.amount.value),
    })),
  );
  const calculation = calculateTerminationPayment({
    effectiveDate: record.payments
      .map(({ paymentDate }) => paymentDate.value)
      .sort()[0] as string,
    currency: record.currency.value,
    jurisdiction: record.calculationFacts.jurisdiction.value,
    residence: record.calculationFacts.residence.value,
    noticeTreatment: record.calculationFacts.noticeTreatment.value,
    priorSection403AwardsPence: toPence(
      record.calculationFacts.priorSection403Awards.value,
    ),
    hasOtherTaxInteractions:
      record.calculationFacts.hasOtherTaxInteractions.value,
    components,
    knownDeductionsPence: sum(
      record.payments.flatMap(({ deductions }) =>
        deductions.map(({ amount }) => toPence(amount.value)),
      ),
    ),
  });
  const treatmentById = new Map(
    calculation.treatments.map((treatment) => [
      treatment.componentId,
      treatment,
    ]),
  );
  const treatments = record.payments.flatMap((payment) =>
    payment.grossComponents.map((component) => ({
      ...(treatmentById.get(
        `${payment.id}:${component.id}`,
      ) as TerminationPaymentTreatment),
      paymentId: payment.id,
      label: component.label,
      amount: component.amount.value,
    })),
  );
  const manualNetRequiredForPaymentIds = record.payments
    .filter(
      (payment) =>
        cashComponentAmount(payment) > 0 && payment.netAmount == null,
    )
    .map(({ id }) => id);
  if (!calculation.available && manualNetRequiredForPaymentIds.length > 0) {
    return {
      available: false,
      record,
      treatments,
      reasons: calculation.reasons,
      lineage: calculation.lineage,
      manualNetRequiredForPaymentIds,
      futureCashFlows: [],
    };
  }

  const manualCount = record.payments.filter(
    ({ netAmount }) => netAmount != null,
  ).length;
  const autoCount = record.payments.filter(
    (payment) => payment.netAmount == null && cashComponentAmount(payment) > 0,
  ).length;
  const mode =
    manualCount > 0 && autoCount > 0
      ? "mixed"
      : manualCount > 0
        ? "employer-net"
        : "reviewed-rules";
  const source = sourceDescription(record.source);
  const commonLineage = [
    calculation.lineage.calculationVersion,
    `${calculation.lineage.ruleSetId}@${calculation.lineage.ruleSetVersion}`,
    ...calculation.lineage.sourceIds,
  ];
  const cashStages = record.payments.flatMap((payment) => {
    const gross = cashComponentAmount(payment);
    if (gross <= 0) return [];
    const deductions = sum(
      payment.deductions.map(({ amount }) => amount.value),
    );
    const netAmount = payment.netAmount?.value ?? gross - deductions;
    return [
      {
        id: payment.id,
        name: `Payment ${payment.paymentDate.value}`,
        direction: "receipt" as const,
        toAccountId: payment.destinationAccountId.value,
        dueDate: payment.paymentDate.value,
        amount: netAmount,
        actuals: [],
        amountBreakdown: amountBreakdown(
          payment,
          netAmount,
          payment.netAmount == null
            ? commonLineage
            : [
                `employer-net:${record.id}:v${record.version}`,
                ...commonLineage,
              ],
          source,
        ),
      },
    ];
  });
  const futureCashFlows: Commitment[] = [];
  if (cashStages.length > 0) {
    futureCashFlows.push(
      CommitmentSchema.parse({
        id: `${record.id}:cash-receipt`,
        name: record.name,
        description: `Employment exit payment from ${record.employer}`,
        labels: ["redundancy-package"],
        currency: record.currency.value,
        kind: "commitment",
        counterparty: record.employer,
        status: "active",
        changeability: "fixed",
        refundable: false,
        notes: commitmentNotes(record, mode),
        stages: cashStages,
      }),
    );
  }

  const pensionStages = record.payments.flatMap((payment) => {
    const pensionAmount = sum(
      payment.grossComponents
        .filter(({ kind }) => kind === "employer-pension-contribution")
        .map(({ amount }) => amount.value),
    );
    if (pensionAmount <= 0 || payment.pensionDestinationAccountId == null) {
      return [];
    }
    return [
      {
        id: `${payment.id}:pension`,
        name: `Pension contribution ${payment.paymentDate.value}`,
        direction: "receipt" as const,
        toAccountId: payment.pensionDestinationAccountId.value,
        dueDate: payment.paymentDate.value,
        amount: pensionAmount,
        actuals: [],
        amountBreakdown: {
          grossAmount: pensionAmount,
          taxAmount: 0,
          feeAmount: 0,
          deductions: [],
          netAmount: pensionAmount,
          sourceNotes: source,
          calculationLineage: commonLineage,
        },
      },
    ];
  });
  if (pensionStages.length > 0) {
    futureCashFlows.push(
      CommitmentSchema.parse({
        id: `${record.id}:pension-receipt`,
        name: `${record.name} pension contribution`,
        description: `Employer pension contribution from ${record.employer}`,
        labels: ["redundancy-package", "employer-pension"],
        currency: record.currency.value,
        kind: "commitment",
        counterparty: record.employer,
        status: "active",
        changeability: "fixed",
        refundable: false,
        notes: commitmentNotes(record, mode),
        stages: pensionStages,
      }),
    );
  }

  return {
    available: true,
    record,
    treatments,
    reasons: calculation.reasons,
    lineage: calculation.lineage,
    mode,
    futureCashFlows,
  };
}
