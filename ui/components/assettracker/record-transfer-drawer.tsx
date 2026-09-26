"use client";

import { ArrowLeftRightIcon } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  formatAssetTrackerError,
  todayIsoDate,
} from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";

const EXTERNAL = "external";

interface RecordTransferDrawerProps {
  /** Pre-select (and lock) the source account, e.g. from an account view */
  fromAccountId?: string;
  trigger?: ReactNode;
}

export function RecordTransferDrawer({
  fromAccountId,
  trigger,
}: Readonly<RecordTransferDrawerProps>) {
  const { accounts, recordTransfer } = useAssetTracker();
  const openAccounts = accounts.filter((account) => account.isOpen);
  const lockedFrom = fromAccountId != null;
  const sourceAccount = accounts.find((a) => a.id === fromAccountId);

  const [open, setOpen] = useState(false);
  const [fromId, setFromId] = useState(fromAccountId ?? EXTERNAL);
  const [toId, setToId] = useState(
    openAccounts.find((a) => a.id !== fromAccountId)?.id ?? EXTERNAL,
  );
  const [amount, setAmount] = useState("");
  const [receivedAmount, setReceivedAmount] = useState("");
  const [feeAmount, setFeeAmount] = useState("");
  const [conversionProvider, setConversionProvider] = useState("");
  const [date, setDate] = useState(todayIsoDate());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fromOptions = openAccounts;
  const toOptions = openAccounts.filter((a) => a.id !== fromId);
  const selectedFrom = accounts.find((account) => account.id === fromId);
  const selectedTo = accounts.find((account) => account.id === toId);
  const crossCurrency =
    selectedFrom != null &&
    selectedTo != null &&
    selectedFrom.currency !== selectedTo.currency;

  // After import/reset/close, drop selections that point at gone accounts
  // (EXTERNAL is always valid) so a stale ID can't drive a transfer
  const openAccountsKey = openAccounts.map((a) => a.id).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: openAccountsKey fingerprints membership instead of the array's identity
  useEffect(() => {
    const valid = (id: string) =>
      id === EXTERNAL || openAccounts.some((a) => a.id === id);
    if (lockedFrom) {
      // The locked account can vanish mid-session (import/reset/close);
      // fall back to external rather than transferring from a ghost ID
      const lockedIsValid = fromAccountId != null && valid(fromAccountId);
      setFromId(lockedIsValid ? fromAccountId : EXTERNAL);
    } else {
      setFromId((current) => (valid(current) ? current : EXTERNAL));
    }
    setToId((current) => (valid(current) ? current : EXTERNAL));
  }, [openAccountsKey, lockedFrom, fromAccountId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await recordTransfer({
        date,
        fromAccountId: fromId === EXTERNAL ? undefined : fromId,
        toAccountId: toId === EXTERNAL ? undefined : toId,
        amount: Number(amount),
        receivedAmount: crossCurrency ? Number(receivedAmount) : undefined,
        feeAmount:
          crossCurrency && feeAmount !== "" ? Number(feeAmount) : undefined,
        conversionProvider:
          crossCurrency && conversionProvider.trim() !== ""
            ? conversionProvider.trim()
            : undefined,
      });
      setOpen(false);
      setAmount("");
      setReceivedAmount("");
      setFeeAmount("");
      setConversionProvider("");
      setDate(todayIsoDate());
    } catch (err) {
      setError(formatAssetTrackerError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        {trigger ?? (
          <Button variant="outline" disabled={openAccounts.length === 0}>
            <ArrowLeftRightIcon />
            Transfer
          </Button>
        )}
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader className="mx-auto w-full max-w-md">
          <DrawerTitle>
            {lockedFrom && sourceAccount
              ? `Transfer from ${sourceAccount.name}`
              : "Record a transfer"}
          </DrawerTitle>
          <DrawerDescription>
            Move money between accounts, or in/out from the outside world. Both
            balances update — no rescanning every account.
          </DrawerDescription>
        </DrawerHeader>
        <form
          onSubmit={handleSubmit}
          className="mx-auto flex w-full max-w-md flex-col gap-4 p-4 pb-8"
        >
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="transfer-from" className="text-sm font-medium">
                From
              </label>
              {lockedFrom && sourceAccount ? (
                <p className="flex h-9 items-center text-sm font-medium">
                  {sourceAccount.name}
                </p>
              ) : (
                <Select value={fromId} onValueChange={setFromId}>
                  <SelectTrigger id="transfer-from" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={EXTERNAL}>External (income)</SelectItem>
                    {fromOptions.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="transfer-to" className="text-sm font-medium">
                To
              </label>
              <Select value={toId} onValueChange={setToId}>
                <SelectTrigger id="transfer-to" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={EXTERNAL}>External (spending)</SelectItem>
                  {toOptions.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="transfer-amount" className="text-sm font-medium">
              Amount
            </label>
            <Input
              id="transfer-amount"
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              required
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            {lockedFrom && sourceAccount?.latestBalance != null && (
              <button
                type="button"
                className="self-start text-xs text-muted-foreground hover:underline"
                onClick={() =>
                  setAmount(
                    String(Math.max(sourceAccount.latestBalance ?? 0, 0)),
                  )
                }
              >
                Transfer full balance
              </button>
            )}
          </div>
          {crossCurrency && selectedTo && (
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2 flex flex-col gap-1.5">
                <label
                  htmlFor="transfer-received-amount"
                  className="text-sm font-medium"
                >
                  Amount received ({selectedTo.currency})
                </label>
                <Input
                  id="transfer-received-amount"
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  required
                  placeholder="0.00"
                  value={receivedAmount}
                  onChange={(event) => setReceivedAmount(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="transfer-fee" className="text-sm font-medium">
                  Fee ({selectedFrom?.currency})
                </label>
                <Input
                  id="transfer-fee"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={feeAmount}
                  onChange={(event) => setFeeAmount(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="transfer-conversion-provider"
                  className="text-sm font-medium"
                >
                  Conversion provider
                </label>
                <Input
                  id="transfer-conversion-provider"
                  placeholder="e.g. bank or broker"
                  value={conversionProvider}
                  onChange={(event) =>
                    setConversionProvider(event.target.value)
                  }
                />
              </div>
              <p className="col-span-2 text-xs text-muted-foreground">
                Record both native amounts so currency conversion is not counted
                as income. The fee is charged on top of the amount sent.
              </p>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="transfer-date" className="text-sm font-medium">
              Date
            </label>
            <Input
              id="transfer-date"
              type="date"
              required
              max={todayIsoDate()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2 pt-2">
            <Button type="submit" className="flex-1" disabled={submitting}>
              Record transfer
            </Button>
            <DrawerClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DrawerClose>
          </div>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
