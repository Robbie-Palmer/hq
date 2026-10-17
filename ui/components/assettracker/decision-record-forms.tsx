"use client";

import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { todayIsoDate } from "@/lib/assettracker";
import type {
  Currency,
  TrackedFinancialDecisionRecord,
} from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";
import { DecisionTextArea, DecisionTextInput } from "./decision-record-fields";

function useFormState<T extends Record<string, string>>(initial: T) {
  const [values, setValues] = useState(initial);
  function set<K extends keyof T>(key: K, value: T[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }
  return { values, set, reset: setValues };
}

function useObservationForm(decisionId: string, checkpointId: string) {
  const { recordDecisionObservation } = useAssetTracker();
  const form = useFormState({
    actual: "",
    note: "",
    assumptionLabel: "",
    assumptionImpact: "",
    realityLabel: "",
    realityImpact: "",
  });
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const v = form.values;
    const divergenceSources = [
      ...(v.assumptionLabel.trim() === "" || v.assumptionImpact === ""
        ? []
        : [
            {
              kind: "changed-assumption" as const,
              label: v.assumptionLabel.trim(),
              impactAmount: Number(v.assumptionImpact),
            },
          ]),
      ...(v.realityLabel.trim() === "" || v.realityImpact === ""
        ? []
        : [
            {
              kind: "changed-reality" as const,
              label: v.realityLabel.trim(),
              impactAmount: Number(v.realityImpact),
            },
          ]),
    ];
    setSaving(true);
    try {
      await recordDecisionObservation({
        decisionId,
        checkpointId,
        actualAmount: Number(v.actual),
        note: v.note,
        divergenceSources,
      });
    } finally {
      setSaving(false);
    }
  }
  return { ...form, saving, submit };
}

export function ObservationForm({
  decisionId,
  checkpointId,
}: Readonly<{ decisionId: string; checkpointId: string }>) {
  const { values, set, saving, submit } = useObservationForm(
    decisionId,
    checkpointId,
  );
  const fields = [
    ["actual", "Actual amount", undefined, "decimal"],
    ["note", "What happened", undefined, undefined],
    [
      "assumptionLabel",
      "Changed assumption",
      "Return was lower than assumed",
      undefined,
    ],
    ["assumptionImpact", "Assumption impact", "-1200", "decimal"],
    [
      "realityLabel",
      "Changed reality",
      "Contribution paused for two months",
      undefined,
    ],
    ["realityImpact", "Reality impact", "-2000", "decimal"],
  ] as const;
  return (
    <form
      className="mt-3 grid gap-3 rounded-md bg-muted/40 p-3"
      onSubmit={submit}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map(([key, label, placeholder, inputMode]) => (
          <DecisionTextInput
            key={key}
            inputMode={inputMode}
            label={label}
            placeholder={placeholder}
            required={key === "actual" || key === "note"}
            value={values[key]}
            onChange={(value) => set(key, value)}
          />
        ))}
      </div>
      <Button className="justify-self-start" disabled={saving} type="submit">
        {saving ? "Saving…" : "Record checkpoint"}
      </Button>
    </form>
  );
}

function useInterpretationForm(decision: TrackedFinancialDecisionRecord) {
  const { addDecisionInterpretation } = useAssetTracker();
  const initial = {
    reason: "",
    rationale: decision.rationale,
    label: "",
    previousValue: "",
    revisedValue: "",
  };
  const form = useFormState(initial);
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const v = form.values;
    setSaving(true);
    try {
      await addDecisionInterpretation({
        decisionId: decision.id,
        reason: v.reason,
        revisedRationale: v.rationale,
        assumptionChanges: [
          {
            label: v.label,
            previousValue: v.previousValue,
            revisedValue: v.revisedValue,
          },
        ],
      });
      form.reset(initial);
    } finally {
      setSaving(false);
    }
  }
  return { ...form, saving, submit };
}

export function InterpretationForm({
  decision,
}: Readonly<{ decision: TrackedFinancialDecisionRecord }>) {
  const { values, set, saving, submit } = useInterpretationForm(decision);
  const fields = [
    ["label", "Assumption"],
    ["previousValue", "Value known then"],
    ["revisedValue", "Corrected value"],
  ] as const;
  return (
    <details className="mt-4 rounded-md border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Add corrected interpretation
      </summary>
      <form className="mt-3 grid gap-3" onSubmit={submit}>
        <DecisionTextInput
          label="Reason for correction"
          value={values.reason}
          onChange={(value) => set("reason", value)}
        />
        <DecisionTextArea
          label="Revised rationale"
          value={values.rationale}
          onChange={(value) => set("rationale", value)}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          {fields.map(([key, label]) => (
            <DecisionTextInput
              key={key}
              label={label}
              value={values[key]}
              onChange={(value) => set(key, value)}
            />
          ))}
        </div>
        <Button className="justify-self-start" disabled={saving} type="submit">
          {saving ? "Saving…" : "Save interpretation"}
        </Button>
      </form>
    </details>
  );
}

type CreateFormValues = ReturnType<typeof createInitialValues>;

function createInitialValues() {
  return {
    question: "",
    decisionDate: todayIsoDate(),
    scenario: "",
    rationale: "",
    action: "",
    checkpointLabel: "",
    checkpointDate: todayIsoDate(),
    expectedAmount: "",
    fact: "",
    rate: "",
    taxRule: "",
    assumption: "",
    source: "",
    calculationVersion: "",
  };
}

function decisionSlug(question: string) {
  return (
    question
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/^-|-$/g, "") || "decision"
  );
}

function buildDecisionInput(values: CreateFormValues, baseCurrency: Currency) {
  const slug = decisionSlug(values.question);
  const lineage = [
    ["fact", "financial-fact", "Decision facts"],
    ["rate", "rate", "Rates"],
    ["taxRule", "tax-rule", "Tax rules"],
    ["assumption", "assumption", "Assumptions"],
  ] as const;
  return {
    question: values.question,
    decisionDate: values.decisionDate,
    selectedScenario: { id: `${slug}-scenario`, label: values.scenario },
    rationale: values.rationale,
    action: values.action,
    forecast: {
      calculationVersion: values.calculationVersion,
      lineage: lineage.map(([key, kind, label]) => ({
        id: `${slug}-${kind}`,
        kind,
        label,
        value: values[key],
        source: values.source,
        validAt: values.decisionDate,
      })),
      checkpoints: [
        {
          id: `${slug}-checkpoint-1`,
          label: values.checkpointLabel,
          dueDate: values.checkpointDate,
          expectedAmount: Number(values.expectedAmount),
          currency: baseCurrency,
        },
      ],
    },
  };
}

function useCreateDecisionForm() {
  const { baseCurrency, createDecisionRecord } = useAssetTracker();
  const form = useFormState(createInitialValues());
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      await createDecisionRecord(buildDecisionInput(form.values, baseCurrency));
      form.reset(createInitialValues());
    } finally {
      setSaving(false);
    }
  }
  return { ...form, baseCurrency, saving, submit };
}

function DecisionBasicsFields({
  values,
  set,
}: Readonly<{
  values: CreateFormValues;
  set: ReturnType<typeof useCreateDecisionForm>["set"];
}>) {
  const fields = [
    ["question", "Question", undefined],
    ["decisionDate", "Decision date", "date"],
    ["scenario", "Selected scenario", undefined],
    ["action", "Action taken", undefined],
  ] as const;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map(([key, label, type]) => (
          <DecisionTextInput
            key={key}
            label={label}
            type={type}
            value={values[key]}
            onChange={(value) => set(key, value)}
          />
        ))}
      </div>
      <DecisionTextArea
        label="Household-visible rationale"
        value={values.rationale}
        onChange={(value) => set("rationale", value)}
      />
    </>
  );
}

const checkpointFields = [
  ["checkpointLabel", "First checkpoint", undefined, undefined],
  ["checkpointDate", "Checkpoint date", undefined, "date"],
] as const;

const lineageFields = [
  ["fact", "Financial facts", "Balances, income, or mortgage terms"],
  ["rate", "Rates", "Mortgage, return, inflation, or FX rates"],
  ["taxRule", "Tax rules", "Rule set and tax year"],
  ["assumption", "Assumptions", "Contributions, dates, or behaviour"],
  ["source", "Source reference", "Statement, manual entry, or dataset version"],
  ["calculationVersion", "Calculation version", "asset-tracker-forecast-v1"],
] as const;

function DecisionForecastFields({
  values,
  set,
  baseCurrency,
}: Readonly<{
  values: CreateFormValues;
  set: ReturnType<typeof useCreateDecisionForm>["set"];
  baseCurrency: Currency;
}>) {
  const fields = [
    ...checkpointFields,
    [
      "expectedAmount",
      `Expected amount (${baseCurrency})`,
      undefined,
      undefined,
    ],
  ] as const;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        {fields.map(([key, label, placeholder, type]) => (
          <DecisionTextInput
            key={key}
            inputMode={key === "expectedAmount" ? "decimal" : undefined}
            label={label}
            placeholder={placeholder}
            type={type}
            value={values[key]}
            onChange={(value) => set(key, value)}
          />
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {lineageFields.map(([key, label, placeholder]) => (
          <DecisionTextInput
            key={key}
            label={label}
            placeholder={placeholder}
            value={values[key]}
            onChange={(value) => set(key, value)}
          />
        ))}
      </div>
    </>
  );
}

export function CreateDecisionRecordForm() {
  const { values, set, baseCurrency, saving, submit } = useCreateDecisionForm();
  return (
    <details className="rounded-lg border p-5">
      <summary className="cursor-pointer font-semibold">
        Record a decision
      </summary>
      <p className="mt-2 text-sm text-muted-foreground">
        Save what you knew and expected today. Later checkpoints append actual
        results without changing this forecast.
      </p>
      <form className="mt-4 grid gap-4" onSubmit={submit}>
        <DecisionBasicsFields set={set} values={values} />
        <DecisionForecastFields
          baseCurrency={baseCurrency}
          set={set}
          values={values}
        />
        <Button className="justify-self-start" disabled={saving} type="submit">
          {saving ? "Saving…" : "Freeze decision forecast"}
        </Button>
      </form>
    </details>
  );
}
