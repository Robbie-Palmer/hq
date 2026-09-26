"use client";

import { PlusIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
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
  ASSET_TYPE_LABELS,
  type AssetType,
  CurrencySchema,
  defaultLiquidityForAssetType,
  formatAssetTrackerError,
  isLiability,
  LIQUIDITY_TIER_LABELS,
  type LiquidityTier,
  SUPPORTED_CURRENCIES,
  todayIsoDate,
} from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";

const ASSET_TYPE_OPTIONS = Object.entries(ASSET_TYPE_LABELS) as [
  AssetType,
  string,
][];

const LIQUIDITY_OPTIONS = Object.entries(LIQUIDITY_TIER_LABELS) as [
  LiquidityTier,
  string,
][];

const NO_LINK = "none";

export function AddAccountDrawer() {
  const { accounts, baseCurrency, createAccount } = useAssetTracker();
  const propertyAccounts = accounts.filter(
    (account) => account.assetType === "property" && account.isOpen,
  );

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("");
  const [assetType, setAssetType] = useState<AssetType>("cash");
  const [liquidity, setLiquidity] = useState<LiquidityTier>("cash");
  const [currency, setCurrency] = useState(baseCurrency);
  const [expectedReturnPercent, setExpectedReturnPercent] = useState("");
  const [linkedId, setLinkedId] = useState(NO_LINK);
  const [openingBalance, setOpeningBalance] = useState("");
  const [openingDate, setOpeningDate] = useState(todayIsoDate());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function resetForm() {
    setName("");
    setProvider("");
    setAssetType("cash");
    setLiquidity("cash");
    setCurrency(baseCurrency);
    setExpectedReturnPercent("");
    setLinkedId(NO_LINK);
    setOpeningBalance("");
    setOpeningDate(todayIsoDate());
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await createAccount({
        name,
        provider,
        assetType,
        liquidity,
        currency,
        expectedAnnualReturn: Number(expectedReturnPercent) / 100,
        linkedAccountId:
          assetType === "mortgage" && linkedId !== NO_LINK
            ? linkedId
            : undefined,
        openingBalance:
          openingBalance === "" ? undefined : Number(openingBalance),
        openingDate,
      });
      setOpen(false);
      resetForm();
    } catch (err) {
      setError(formatAssetTrackerError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button variant="outline">
          <PlusIcon />
          Add account
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader className="mx-auto w-full max-w-md">
          <DrawerTitle>Add an account</DrawerTitle>
          <DrawerDescription>
            Anything with a balance: savings, investments, property, or
            liabilities like credit cards and mortgages (negative balances).
          </DrawerDescription>
        </DrawerHeader>
        <form
          onSubmit={handleSubmit}
          className="mx-auto flex w-full max-w-md flex-col gap-4 overflow-y-auto p-4 pb-8"
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="add-account-name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="add-account-name"
              required
              placeholder="e.g. Vanguard S&S ISA"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="add-account-provider"
              className="text-sm font-medium"
            >
              Provider
            </label>
            <Input
              id="add-account-provider"
              required
              placeholder="e.g. Vanguard"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-account-type" className="text-sm font-medium">
                Asset type
              </label>
              <Select
                value={assetType}
                onValueChange={(value) => {
                  const nextAssetType = value as AssetType;
                  setAssetType(nextAssetType);
                  setLiquidity(defaultLiquidityForAssetType(nextAssetType));
                }}
              >
                <SelectTrigger id="add-account-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSET_TYPE_OPTIONS.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="add-account-currency"
                className="text-sm font-medium"
              >
                Currency
              </label>
              <Select
                value={currency}
                onValueChange={(value) =>
                  setCurrency(CurrencySchema.parse(value))
                }
              >
                <SelectTrigger id="add-account-currency" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_CURRENCIES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {!isLiability(assetType) && (
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="add-account-liquidity"
                className="text-sm font-medium"
              >
                Access to funds
              </label>
              <Select
                value={liquidity}
                onValueChange={(value) => setLiquidity(value as LiquidityTier)}
              >
                <SelectTrigger id="add-account-liquidity" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LIQUIDITY_OPTIONS.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Use illiquid for pensions, property, or anything you cannot
                readily sell to cover spending.
              </p>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="add-account-return" className="text-sm font-medium">
              {isLiability(assetType)
                ? "Interest rate (%)"
                : "Expected annual return (%)"}
            </label>
            <Input
              id="add-account-return"
              type="number"
              inputMode="decimal"
              step="0.1"
              min="-99"
              required
              placeholder={isLiability(assetType) ? "e.g. 24.9" : "e.g. 7"}
              value={expectedReturnPercent}
              onChange={(e) => setExpectedReturnPercent(e.target.value)}
            />
          </div>
          {assetType === "mortgage" && propertyAccounts.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-account-link" className="text-sm font-medium">
                Secured on
              </label>
              <Select value={linkedId} onValueChange={setLinkedId}>
                <SelectTrigger id="add-account-link" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_LINK}>Not linked</SelectItem>
                  {propertyAccounts.map((property) => (
                    <SelectItem key={property.id} value={property.id}>
                      {property.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="add-account-balance"
                className="text-sm font-medium"
              >
                Opening balance
              </label>
              <Input
                id="add-account-balance"
                type="number"
                inputMode="decimal"
                step="0.01"
                placeholder={isLiability(assetType) ? "e.g. -1500" : "Optional"}
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-account-date" className="text-sm font-medium">
                As of
              </label>
              <Input
                id="add-account-date"
                type="date"
                required
                max={todayIsoDate()}
                value={openingDate}
                onChange={(e) => setOpeningDate(e.target.value)}
              />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2 pt-2">
            <Button type="submit" className="flex-1" disabled={submitting}>
              Add account
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
