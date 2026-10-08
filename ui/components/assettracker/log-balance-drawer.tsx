"use client";

import { PenLineIcon } from "lucide-react";
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
import { formatAccountCurrency, todayIsoDate } from "@/lib/assettracker";
import { formatAssetTrackerError } from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";

interface LogBalanceDrawerProps {
  /** Lock the form to one account (used from the account detail view) */
  accountId?: string;
  /** Replaces the default "Log balance" button as the opening control */
  trigger?: ReactNode;
}

export function LogBalanceDrawer({
  accountId,
  trigger,
}: Readonly<LogBalanceDrawerProps>) {
  const { accounts, recordBalance } = useAssetTracker();
  const openAccounts = accounts.filter((account) => account.isOpen);

  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(
    accountId ?? openAccounts[0]?.id ?? "",
  );
  const [date, setDate] = useState(todayIsoDate());
  const [balance, setBalance] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedAccount = accounts.find((a) => a.id === selectedId);

  // Keep the selection valid after import/reset/close changes the open set,
  // so a stale account ID can't drive a mutation
  const openAccountsKey = openAccounts.map((a) => a.id).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: openAccountsKey fingerprints membership instead of the array's identity
  useEffect(() => {
    if (accountId) {
      setSelectedId(accountId);
      return;
    }
    setSelectedId((current) =>
      openAccounts.some((a) => a.id === current)
        ? current
        : (openAccounts[0]?.id ?? ""),
    );
  }, [accountId, openAccountsKey]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId) {
      setError("Choose an account");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await recordBalance({
        accountId: selectedId,
        date,
        balance: Number(balance),
      });
      setOpen(false);
      setBalance("");
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
          <Button disabled={openAccounts.length === 0}>
            <PenLineIcon />
            Log balance
          </Button>
        )}
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader className="mx-auto w-full max-w-md">
          <DrawerTitle>Log a balance</DrawerTitle>
          <DrawerDescription>
            Record what an account is worth right now — that's all it takes to
            keep the picture current.
          </DrawerDescription>
        </DrawerHeader>
        <form
          onSubmit={handleSubmit}
          className="mx-auto flex w-full max-w-md flex-col gap-4 p-4 pb-8"
        >
          {accountId ? (
            <p className="text-sm font-medium">{selectedAccount?.name}</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="log-balance-account"
                className="text-sm font-medium"
              >
                Account
              </label>
              <Select value={selectedId} onValueChange={setSelectedId}>
                <SelectTrigger id="log-balance-account" className="w-full">
                  <SelectValue placeholder="Choose an account" />
                </SelectTrigger>
                <SelectContent>
                  {openAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {selectedAccount?.latestBalance != null && (
            <p className="text-xs text-muted-foreground">
              Last recorded{" "}
              {formatAccountCurrency(
                selectedAccount.latestBalance,
                selectedAccount.currency,
              )}{" "}
              on {selectedAccount.latestSnapshotDate}
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="log-balance-amount" className="text-sm font-medium">
              Balance{selectedAccount ? ` (${selectedAccount.currency})` : ""}
            </label>
            <Input
              id="log-balance-amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              required
              placeholder="0.00 (negative for debt)"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="log-balance-date" className="text-sm font-medium">
              Date
            </label>
            <Input
              id="log-balance-date"
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
              Save balance
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
