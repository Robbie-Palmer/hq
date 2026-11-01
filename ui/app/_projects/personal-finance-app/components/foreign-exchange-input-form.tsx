"use client";

import {
  cloneElement,
  type ReactElement,
  type SubmitEvent,
  useState,
} from "react";
import { SUPPORTED_CURRENCIES } from "@/app/_projects/personal-finance-app/domain/currency";
import {
  type ForeignExchangeDecisionInput,
  ForeignExchangeDecisionInputSchema,
} from "@/app/_projects/personal-finance-app/domain/foreignExchangeDecision";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

function Field({
  label,
  name,
  children,
}: Readonly<{
  label: string;
  name: string;
  children: ReactElement<{ id?: string }>;
}>) {
  return (
    <div className="space-y-1.5 text-xs font-medium">
      <label htmlFor={name}>{label}</label>
      {cloneElement(children, { id: name })}
    </div>
  );
}

const selectClassName =
  "border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function requiredText(form: FormData, name: string): string {
  const value = form.get(name);
  if (typeof value !== "string") throw new TypeError(`${name} is required`);
  return value.trim();
}

function requiredNumber(form: FormData, name: string): number {
  const value = requiredText(form, name);
  if (value === "") throw new TypeError(`${name} is required`);
  return Number(value);
}

function isoDateTime(form: FormData, name: string): string {
  const value = requiredText(form, name);
  if (value === "") throw new TypeError(`${name} is required`);
  return new Date(value).toISOString();
}

function inputFromForm(form: FormData): ForeignExchangeDecisionInput {
  const comparedAt = isoDateTime(form, "comparedAt");
  return ForeignExchangeDecisionInputSchema.parse({
    amount: requiredNumber(form, "amount"),
    sourceCurrency: requiredText(form, "sourceCurrency"),
    targetCurrency: requiredText(form, "targetCurrency"),
    comparedAt,
    referenceRate: {
      rate: requiredNumber(form, "referenceRate"),
      source: {
        provider: requiredText(form, "referenceProvider"),
        label: requiredText(form, "referenceLabel"),
        url: requiredText(form, "referenceUrl"),
        observedAt: isoDateTime(form, "referenceObservedAt"),
      },
    },
    providerQuote: {
      rate: requiredNumber(form, "quoteRate"),
      fixedFee: requiredNumber(form, "fixedFee"),
      percentageFee: requiredNumber(form, "percentageFee"),
      source: {
        provider: requiredText(form, "quoteProvider"),
        label: requiredText(form, "quoteLabel"),
        url: requiredText(form, "quoteUrl"),
        observedAt: isoDateTime(form, "quoteObservedAt"),
      },
    },
    futureRate: requiredNumber(form, "futureRate"),
    stressRate: requiredNumber(form, "stressRate"),
    stagedNowPercentage: requiredNumber(form, "stagedNowPercentage"),
  });
}

function RateSourceFields({
  prefix,
  title,
}: Readonly<{ prefix: "reference" | "quote"; title: string }>) {
  return (
    <fieldset className="space-y-3 rounded-lg border p-4">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Rate" name={`${prefix}Rate`}>
          <Input
            name={`${prefix}Rate`}
            inputMode="decimal"
            min="0"
            step="any"
            required
          />
        </Field>
        <Field label="Observed at" name={`${prefix}ObservedAt`}>
          <Input name={`${prefix}ObservedAt`} type="datetime-local" required />
        </Field>
        <Field label="Provider" name={`${prefix}Provider`}>
          <Input name={`${prefix}Provider`} required />
        </Field>
        <Field label="Source label or quote ID" name={`${prefix}Label`}>
          <Input name={`${prefix}Label`} required />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Source URL" name={`${prefix}Url`}>
            <Input name={`${prefix}Url`} type="url" required />
          </Field>
        </div>
      </div>
    </fieldset>
  );
}

function ConversionBasics() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Amount" name="amount">
        <Input name="amount" inputMode="decimal" min="0" step="any" required />
      </Field>
      <Field label="From" name="sourceCurrency">
        <select
          aria-label="Source currency"
          className={selectClassName}
          defaultValue="GBP"
          name="sourceCurrency"
        >
          {SUPPORTED_CURRENCIES.map((currency) => (
            <option key={currency}>{currency}</option>
          ))}
        </select>
      </Field>
      <Field label="To" name="targetCurrency">
        <select
          aria-label="Target currency"
          className={selectClassName}
          defaultValue="EUR"
          name="targetCurrency"
        >
          {SUPPORTED_CURRENCIES.map((currency) => (
            <option key={currency}>{currency}</option>
          ))}
        </select>
      </Field>
      <Field label="Compared at" name="comparedAt">
        <Input name="comparedAt" type="datetime-local" required />
      </Field>
    </div>
  );
}

function ProviderFields() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <RateSourceFields prefix="reference" title="Reference rate" />
      <div className="space-y-3">
        <RateSourceFields prefix="quote" title="Available quote" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Fixed fee, source currency" name="fixedFee">
            <Input
              defaultValue="0"
              name="fixedFee"
              inputMode="decimal"
              min="0"
              step="any"
              required
            />
          </Field>
          <Field label="Percentage fee" name="percentageFee">
            <Input
              defaultValue="0"
              name="percentageFee"
              inputMode="decimal"
              min="0"
              max="100"
              step="any"
              required
            />
          </Field>
        </div>
      </div>
    </div>
  );
}

function AssumptionFields() {
  return (
    <fieldset className="space-y-3 rounded-lg border border-dashed p-4">
      <legend className="px-1 text-sm font-semibold">
        User assumptions, not forecasts
      </legend>
      <p className="text-sm text-muted-foreground">
        These rates test the decision. They do not predict the exchange rate or
        recommend a direction.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Future rate assumption" name="futureRate">
          <Input
            name="futureRate"
            inputMode="decimal"
            min="0"
            step="any"
            required
          />
        </Field>
        <Field label="Stress rate assumption" name="stressRate">
          <Input
            name="stressRate"
            inputMode="decimal"
            min="0"
            step="any"
            required
          />
        </Field>
        <Field label="Convert now in staged case, %" name="stagedNowPercentage">
          <Input
            defaultValue="50"
            name="stagedNowPercentage"
            inputMode="decimal"
            min="1"
            max="99"
            step="any"
            required
          />
        </Field>
      </div>
    </fieldset>
  );
}

export function ForeignExchangeInputForm({
  onCompare,
}: Readonly<{
  onCompare(input: ForeignExchangeDecisionInput): void;
}>) {
  const [error, setError] = useState<string | null>(null);

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      onCompare(inputFromForm(new FormData(event.currentTarget)));
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Check the FX inputs and try again.",
      );
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Conversion inputs</CardTitle>
        <CardDescription>
          Enter the reference snapshot and an executable provider quote. The
          source links and timestamps are saved with the decision.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-5" onSubmit={submit}>
          <ConversionBasics />
          <ProviderFields />
          <AssumptionFields />
          {error == null ? null : (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <Button type="submit">Compare conversion cases</Button>
        </form>
      </CardContent>
    </Card>
  );
}
