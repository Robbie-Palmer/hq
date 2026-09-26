"use client";

import { CalendarCheckIcon, Trash2Icon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type AccountDetailView,
  type AccountSummaryView,
  type Currency,
  type FlowFrequency,
  formatAccountCurrency,
  formatAssetTrackerError,
  isLiability,
  type MinimumPaymentFormula,
  monthlyAmount,
  monthlyFeeAmount,
  monthlyReceivedAmount,
  type RecurringFlow,
  type RecurringFlowConversion,
  type Transfer,
} from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";

const EXTERNAL = "external";

const FREQUENCY_OPTIONS: { value: FlowFrequency; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

type FlowKind = "fixed" | "minimumPayment";

interface AccountFlowsProps {
  account: AccountDetailView;
}

function accountName(
  accounts: readonly AccountSummaryView[],
  accountId: string | undefined,
): string {
  if (accountId == null) return "External";
  return (
    accounts.find((account) => account.id === accountId)?.name ?? accountId
  );
}

function flowDescription(
  flow: RecurringFlow,
  account: AccountDetailView,
  accounts: readonly AccountSummaryView[],
): string {
  const into = flow.toAccountId === account.id;
  const counterparty = accountName(
    accounts,
    into ? flow.fromAccountId : flow.toAccountId,
  );
  const formulaNote = flow.formula
    ? ` · min payment (${(flow.formula.percentOfBalance * 100).toFixed(1)}%, floor ${formatAccountCurrency(flow.formula.floor, account.currency)})`
    : "";
  const conversionNote = flow.conversion
    ? ` · via ${flow.conversion.provider}`
    : "";
  return `${into ? "from" : "to"} ${counterparty}${formulaNote}${conversionNote}`;
}

function flowMonthly(
  flow: RecurringFlow,
  accounts: readonly AccountSummaryView[],
): number {
  const liabilityBalance = flow.formula
    ? (accounts.find((account) => account.id === flow.toAccountId)
        ?.latestBalance ?? 0)
    : undefined;
  return monthlyAmount(flow, liabilityBalance);
}

function buildFlowConversion(input: {
  crossCurrency: boolean;
  kind: FlowKind;
  receivedAmount: string;
  conversionFee: string;
  conversionProvider: string;
  sourceCurrency?: Currency;
  destinationCurrency: Currency;
}): RecurringFlowConversion | undefined {
  if (
    !input.crossCurrency ||
    input.kind !== "fixed" ||
    input.sourceCurrency == null
  ) {
    return undefined;
  }
  return {
    received: {
      amount: Number(input.receivedAmount),
      currency: input.destinationCurrency,
    },
    fee:
      input.conversionFee === ""
        ? undefined
        : {
            amount: Number(input.conversionFee),
            currency: input.sourceCurrency,
          },
    provider: input.conversionProvider.trim() || "Currency conversion",
  };
}

function buildFlowFormula(
  kind: FlowKind,
  percent: string,
  floor: string,
): MinimumPaymentFormula | undefined {
  if (kind !== "minimumPayment") return undefined;
  return {
    kind: "minimumPayment",
    percentOfBalance: Number(percent) / 100,
    floor: Number(floor || "0"),
  };
}

function AccountFlowRow({
  account,
  accounts,
  flow,
  transfers,
  onDelete,
  onMaterialize,
}: Readonly<{
  account: AccountDetailView;
  accounts: readonly AccountSummaryView[];
  flow: RecurringFlow;
  transfers: readonly Transfer[];
  onDelete: (id: string) => void;
  onMaterialize: (id: string) => void;
}>) {
  const into = flow.toAccountId === account.id;
  const nativeMonthly =
    into && flow.conversion != null
      ? monthlyReceivedAmount(flow)
      : flowMonthly(flow, accounts) + (into ? 0 : monthlyFeeAmount(flow));
  const signedMonthly =
    ((into ? 1 : -1) * Math.round(nativeMonthly * 100)) / 100;
  const displayCurrency =
    into && flow.conversion != null
      ? flow.conversion.received.currency
      : flow.currency;
  const recordedCount = transfers.filter(
    (transfer) => transfer.flowId === flow.id,
  ).length;

  return (
    <li className="flex items-center gap-2 px-3 py-2 text-sm">
      <div className="min-w-0">
        <p className="truncate font-medium">{flow.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {flow.frequency} · {flowDescription(flow, account, accounts)}
        </p>
      </div>
      <span className="ml-auto shrink-0 font-mono">
        {signedMonthly >= 0 ? "+" : ""}
        {formatAccountCurrency(signedMonthly, displayCurrency)}/mo
      </span>
      {account.isOpen && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onMaterialize(flow.id)}
        >
          <CalendarCheckIcon />
          {recordedCount > 0 ? "Top up" : "Record"}
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Delete flow ${flow.name}`}
        onClick={() => onDelete(flow.id)}
      >
        <Trash2Icon />
      </Button>
    </li>
  );
}

export function AccountFlows({ account }: Readonly<AccountFlowsProps>) {
  const {
    accounts,
    recurringFlows,
    transfers,
    addRecurringFlow,
    deleteRecurringFlow,
    materializeFlow,
  } = useAssetTracker();
  const accountFlows = recurringFlows.filter(
    (flow) =>
      flow.fromAccountId === account.id || flow.toAccountId === account.id,
  );
  const otherOpenAccounts = accounts.filter(
    (a) => a.isOpen && a.id !== account.id,
  );

  const [name, setName] = useState("");
  const [kind, setKind] = useState<FlowKind>("fixed");
  const [amount, setAmount] = useState("");
  const [percent, setPercent] = useState("");
  const [floor, setFloor] = useState("");
  const [receivedAmount, setReceivedAmount] = useState("");
  const [conversionFee, setConversionFee] = useState("");
  const [conversionProvider, setConversionProvider] = useState("");
  const [frequency, setFrequency] = useState<FlowFrequency>("monthly");
  const [sourceId, setSourceId] = useState(EXTERNAL);
  const [error, setError] = useState<string | null>(null);
  const sourceAccount = accounts.find((candidate) => candidate.id === sourceId);
  const crossCurrency =
    sourceAccount != null && sourceAccount.currency !== account.currency;

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const conversion = buildFlowConversion({
        crossCurrency,
        kind,
        receivedAmount,
        conversionFee,
        conversionProvider,
        sourceCurrency: sourceAccount?.currency,
        destinationCurrency: account.currency,
      });
      await addRecurringFlow({
        name,
        amount: kind === "fixed" ? Number(amount) : undefined,
        currency: sourceAccount?.currency ?? account.currency,
        conversion,
        formula: buildFlowFormula(kind, percent, floor),
        frequency: kind === "minimumPayment" ? "monthly" : frequency,
        fromAccountId: sourceId === EXTERNAL ? undefined : sourceId,
        toAccountId: account.id,
      });
      setName("");
      setAmount("");
      setPercent("");
      setFloor("");
      setReceivedAmount("");
      setConversionFee("");
      setConversionProvider("");
      setKind("fixed");
      setFrequency("monthly");
      setSourceId(EXTERNAL);
    } catch (err) {
      setError(formatAssetTrackerError(err));
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await deleteRecurringFlow(id);
    } catch (err) {
      setError(formatAssetTrackerError(err));
    }
  }

  async function handleMaterialize(id: string) {
    setError(null);
    try {
      await materializeFlow(id);
    } catch (err) {
      setError(formatAssetTrackerError(err));
    }
  }

  return (
    <div>
      <h3 className="mb-2 text-sm font-medium">Expected regular flows</h3>
      {accountFlows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No expected income or contributions yet — add one to power the
          projection.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {accountFlows.map((flow) => (
            <AccountFlowRow
              key={flow.id}
              account={account}
              accounts={accounts}
              flow={flow}
              transfers={transfers}
              onDelete={handleDelete}
              onMaterialize={handleMaterialize}
            />
          ))}
        </ul>
      )}
      {accountFlows.length > 0 && account.isOpen && (
        <p className="mt-2 text-xs text-muted-foreground">
          "Record" turns a flow's due payments into real transfers up to today,
          so balances and growth reflect the money actually moving.
        </p>
      )}
      {account.isOpen && (
        <form onSubmit={handleAdd} className="mt-3 flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <Input
              aria-label="Flow name"
              required
              placeholder="e.g. Salary"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {isLiability(account.assetType) ? (
              <Select
                value={kind}
                onValueChange={(value) => setKind(value as FlowKind)}
              >
                <SelectTrigger aria-label="Flow type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">Fixed amount</SelectItem>
                  <SelectItem value="minimumPayment">
                    Minimum payment (% of balance)
                  </SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <Input
                aria-label="Flow amount"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                required
                placeholder="Amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            )}
          </div>
          {crossCurrency && kind === "fixed" && (
            <div className="grid grid-cols-2 gap-2">
              <Input
                aria-label={`Amount received in ${account.currency}`}
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                required
                placeholder={`Received (${account.currency})`}
                value={receivedAmount}
                onChange={(event) => setReceivedAmount(event.target.value)}
              />
              <Input
                aria-label={`Conversion fee in ${sourceAccount.currency}`}
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder={`Fee (${sourceAccount.currency})`}
                value={conversionFee}
                onChange={(event) => setConversionFee(event.target.value)}
              />
              <Input
                className="col-span-2"
                aria-label="Conversion provider"
                placeholder="Bank or broker"
                value={conversionProvider}
                onChange={(event) => setConversionProvider(event.target.value)}
              />
            </div>
          )}
          {isLiability(account.assetType) &&
            (kind === "fixed" ? (
              <Input
                aria-label="Flow amount"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                required
                placeholder="Amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Input
                  aria-label="Percent of balance"
                  type="number"
                  inputMode="decimal"
                  min="0.1"
                  max="99"
                  step="0.1"
                  required
                  placeholder="% of balance, e.g. 2.5"
                  value={percent}
                  onChange={(e) => setPercent(e.target.value)}
                />
                <Input
                  aria-label="Minimum payment floor"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  placeholder="Floor, e.g. 25"
                  value={floor}
                  onChange={(e) => setFloor(e.target.value)}
                />
              </div>
            ))}
          <div className="grid grid-cols-2 gap-2">
            {kind === "fixed" && (
              <Select
                value={frequency}
                onValueChange={(value) => setFrequency(value as FlowFrequency)}
              >
                <SelectTrigger aria-label="Flow frequency" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FREQUENCY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={sourceId} onValueChange={setSourceId}>
              <SelectTrigger aria-label="Flow source" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={EXTERNAL}>From external income</SelectItem>
                {otherOpenAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    From {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" variant="outline" size="sm">
            Add expected flow into this account
          </Button>
        </form>
      )}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
