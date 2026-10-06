"use client";

import type { LucideIcon } from "lucide-react";
import { CirclePlus, Pencil, X } from "lucide-react";
import { useState } from "react";
import { MAX_PANTRY_FRESHNESS_ESTIMATE_DAYS } from "recipe-domain/pantry";
import { UNIT_LABELS, type Unit, UnitSchema } from "recipe-domain/unit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getKitchenFreshnessStatus,
  KITCHEN_LOCATIONS,
  type KitchenIngredientView,
  type KitchenItemDetails,
  type KitchenLocation,
  localIsoDate,
  pantryEstimateEndDate,
} from "@/lib/domain/recipe/kitchen";

const FRESHNESS_STATUS_LABELS = {
  past_use_by: "Past use by",
  past_best_before: "Past best before",
  estimate_elapsed: "Check freshness",
  use_soon: "Use soon",
} as const;

type ItemCorrection = Pick<
  KitchenItemDetails,
  "location" | "quantity" | "freshness"
>;

function KitchenItemLocationField({
  location,
  setLocation,
}: Readonly<{
  location: KitchenLocation;
  setLocation: (value: KitchenLocation) => void;
}>) {
  return (
    <label className="rt-body grid gap-1 text-sm text-[var(--ink-2)]">
      <span>Location</span>
      <select
        value={location}
        onChange={(event) => setLocation(event.target.value as KitchenLocation)}
        className="h-10 rounded-md border border-[var(--line-strong)] bg-[var(--card)] px-3"
      >
        {KITCHEN_LOCATIONS.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function KitchenQuantityFields({
  amount,
  setAmount,
  setUnit,
  unit,
}: Readonly<{
  amount: string;
  setAmount: (value: string) => void;
  setUnit: (value: string) => void;
  unit: string;
}>) {
  return (
    <>
      <label
        htmlFor="kitchen-item-quantity"
        className="rt-body grid gap-1 text-sm text-[var(--ink-2)]"
      >
        Quantity
        <Input
          id="kitchen-item-quantity"
          inputMode="decimal"
          min="0"
          step="any"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="Optional"
        />
      </label>
      <label
        htmlFor="kitchen-item-unit"
        className="rt-body grid gap-1 text-sm text-[var(--ink-2)]"
      >
        <span>Unit</span>
        <select
          id="kitchen-item-unit"
          value={unit}
          onChange={(event) => setUnit(event.target.value)}
          className="h-10 rounded-md border border-[var(--line-strong)] bg-[var(--card)] px-3"
        >
          <option value="">Select a unit</option>
          {UnitSchema.options.map((option) => (
            <option key={option} value={option}>
              {UNIT_LABELS[option].plural}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

function KitchenDateField({
  id,
  label,
  onChange,
  value,
}: Readonly<{
  id: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}>) {
  return (
    <label
      htmlFor={id}
      className="rt-body grid gap-1 text-sm text-[var(--ink-2)]"
    >
      <span>{label}</span>
      <Input
        id={id}
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function useKitchenItemCorrection(item: KitchenItemDetails) {
  const [location, setLocation] = useState(item.location);
  const [amount, setAmount] = useState(
    item.quantity ? String(item.quantity.amount) : "",
  );
  const [unit, setUnit] = useState(item.quantity?.unit ?? "");
  const [useBy, setUseBy] = useState(item.freshness.useBy ?? "");
  const [bestBefore, setBestBefore] = useState(item.freshness.bestBefore ?? "");
  const [stockedAt, setStockedAt] = useState(
    item.freshness.stockedAt ?? item.freshness.estimate?.startingOn ?? "",
  );
  const [openedAt, setOpenedAt] = useState(item.freshness.openedAt ?? "");
  const [frozenAt, setFrozenAt] = useState(item.freshness.frozenAt ?? "");
  const [estimateDays, setEstimateDays] = useState(
    item.freshness.estimate ? String(item.freshness.estimate.expectedDays) : "",
  );
  const parsedAmount = Number(amount);
  const parsedEstimateDays = Number(estimateDays);
  const quantityIsValid =
    (amount === "" && unit === "") ||
    (Number.isFinite(parsedAmount) &&
      parsedAmount > 0 &&
      UnitSchema.safeParse(unit).success);
  const estimateIsValid =
    estimateDays === "" ||
    (Number.isInteger(parsedEstimateDays) &&
      parsedEstimateDays >= 1 &&
      parsedEstimateDays <= MAX_PANTRY_FRESHNESS_ESTIMATE_DAYS);
  return {
    amount,
    bestBefore,
    estimateDays,
    estimateIsValid,
    frozenAt,
    location,
    openedAt,
    parsedAmount,
    parsedEstimateDays,
    quantityIsValid,
    setAmount,
    setBestBefore,
    setEstimateDays,
    setFrozenAt,
    setLocation,
    setOpenedAt,
    setStockedAt,
    setUnit,
    setUseBy,
    stockedAt,
    unit,
    useBy,
  };
}

type KitchenItemCorrectionState = ReturnType<typeof useKitchenItemCorrection>;

function KitchenEstimateDaysField({
  correction,
}: Readonly<{ correction: KitchenItemCorrectionState }>) {
  return (
    <label
      htmlFor="kitchen-estimate-days"
      className="rt-body grid gap-1 text-sm text-[var(--ink-2)]"
    >
      <span>Expected fresh for (days)</span>
      <Input
        id="kitchen-estimate-days"
        inputMode="numeric"
        min="1"
        max={MAX_PANTRY_FRESHNESS_ESTIMATE_DAYS}
        step="1"
        value={correction.estimateDays}
        onChange={(event) => correction.setEstimateDays(event.target.value)}
        placeholder="Optional estimate"
      />
    </label>
  );
}

function KitchenFreshnessFields({
  correction,
}: Readonly<{ correction: KitchenItemCorrectionState }>) {
  const dateFields = [
    ["kitchen-use-by", "Use by", correction.useBy, correction.setUseBy],
    [
      "kitchen-best-before",
      "Best before",
      correction.bestBefore,
      correction.setBestBefore,
    ],
    [
      "kitchen-stocked-at",
      "Stocked on",
      correction.stockedAt,
      correction.setStockedAt,
    ],
    [
      "kitchen-opened-at",
      "Opened on",
      correction.openedAt,
      correction.setOpenedAt,
    ],
    [
      "kitchen-frozen-at",
      "Frozen on",
      correction.frozenAt,
      correction.setFrozenAt,
    ],
  ] as const;
  return (
    <>
      {dateFields.map(([id, label, value, onChange]) => (
        <KitchenDateField
          key={id}
          id={id}
          label={label}
          value={value}
          onChange={onChange}
        />
      ))}
      <KitchenEstimateDaysField correction={correction} />
    </>
  );
}

function saveKitchenItemCorrection(
  correction: KitchenItemCorrectionState,
  onSave: (item: ItemCorrection) => void,
): void {
  if (!correction.quantityIsValid || !correction.estimateIsValid) return;
  onSave({
    location: correction.location,
    quantity:
      correction.amount === ""
        ? null
        : { amount: correction.parsedAmount, unit: correction.unit as Unit },
    freshness: {
      useBy: correction.useBy || null,
      bestBefore: correction.bestBefore || null,
      stockedAt: correction.stockedAt || null,
      openedAt: correction.openedAt || null,
      frozenAt: correction.frozenAt || null,
      estimate:
        correction.estimateDays === ""
          ? null
          : {
              expectedDays: correction.parsedEstimateDays,
              startingOn: correction.stockedAt || localIsoDate(),
              storage: correction.location,
              basis: "user",
            },
    },
  });
}

function KitchenItemEditorActions({
  isValid,
  onCancel,
}: Readonly<{
  isValid: boolean;
  onCancel: () => void;
}>) {
  return (
    <>
      {!isValid && (
        <p
          role="alert"
          className="rt-body text-sm text-[var(--berry)] sm:col-span-2"
        >
          Enter a positive quantity with a unit, and keep freshness estimates as
          a positive whole number of days.
        </p>
      )}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!isValid}>
          Save correction
        </Button>
      </div>
    </>
  );
}

export function KitchenItemEditor({
  ingredient,
  item,
  onCancel,
  onSave,
}: Readonly<{
  ingredient: KitchenIngredientView;
  item: KitchenItemDetails;
  onCancel: () => void;
  onSave: (item: ItemCorrection) => void;
}>) {
  const correction = useKitchenItemCorrection(item);
  return (
    <form
      className="grid gap-3 rounded-md border border-[var(--line-strong)] bg-[var(--paper)] p-3 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        saveKitchenItemCorrection(correction, onSave);
      }}
    >
      <p className="rt-body font-medium text-[var(--ink)] sm:col-span-2">
        Correct {ingredient.name}
      </p>
      <KitchenItemLocationField
        location={correction.location}
        setLocation={correction.setLocation}
      />
      <KitchenQuantityFields
        amount={correction.amount}
        setAmount={correction.setAmount}
        setUnit={correction.setUnit}
        unit={correction.unit}
      />
      <KitchenFreshnessFields correction={correction} />
      <KitchenItemEditorActions
        isValid={correction.quantityIsValid && correction.estimateIsValid}
        onCancel={onCancel}
      />
    </form>
  );
}

export interface KitchenStockGroup {
  description: string;
  icon: LucideIcon;
  id: KitchenLocation;
  items: KitchenIngredientView[];
  label: string;
}

function KitchenFreshnessBadges({
  item,
}: Readonly<{ item: KitchenItemDetails }>) {
  const freshnessStatus = getKitchenFreshnessStatus(item.freshness);
  const estimateEnd = item.freshness.estimate
    ? pantryEstimateEndDate(item.freshness.estimate)
    : null;
  return (
    <>
      {item.freshness.useBy && (
        <span className="rt-mono text-[var(--ink-3)]">
          Use by {item.freshness.useBy}
        </span>
      )}
      {item.freshness.bestBefore && (
        <span className="rt-mono text-[var(--ink-3)]">
          Best before {item.freshness.bestBefore}
        </span>
      )}
      {estimateEnd && (
        <span className="rt-mono text-[var(--ink-3)]">
          Estimated through {estimateEnd}
        </span>
      )}
      {freshnessStatus && (
        <span className="rt-mono text-[var(--ink-3)]">
          {FRESHNESS_STATUS_LABELS[freshnessStatus]}
        </span>
      )}
    </>
  );
}

function KitchenStockItemActions({
  ingredientName,
  onEdit,
  onRemove,
}: Readonly<{
  ingredientName: string;
  onEdit: () => void;
  onRemove: () => void;
}>) {
  return (
    <>
      <button
        type="button"
        onClick={onEdit}
        className="rounded-sm p-0.5 text-[var(--ink-3)] transition-colors hover:bg-[var(--paper)] hover:text-[var(--terracotta)]"
        aria-label={`Edit ${ingredientName}`}
      >
        <Pencil className="size-3" />
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="rounded-sm p-0.5 text-[var(--ink-3)] transition-colors hover:bg-[var(--paper)] hover:text-[var(--berry)]"
        aria-label={`Remove ${ingredientName}`}
      >
        <X className="size-3" />
      </button>
    </>
  );
}

function KitchenStockItem({
  ingredient,
  item,
  onEdit,
  onRemove,
}: Readonly<{
  ingredient: KitchenIngredientView;
  item: KitchenItemDetails;
  onEdit: () => void;
  onRemove: () => void;
}>) {
  return (
    <Badge
      variant="outline"
      className="max-w-full gap-1.5 bg-[var(--paper-warm)] px-2 py-1 text-sm text-[var(--ink)]"
    >
      <span className="truncate">{ingredient.name}</span>
      {item.quantity && (
        <span className="rt-mono text-[var(--ink-3)]">
          {item.quantity.amount} {item.quantity.unit}
        </span>
      )}
      <KitchenFreshnessBadges item={item} />
      {item.source.kind === "inferred" && (
        <span
          className="max-w-48 truncate rt-mono text-[var(--ink-3)]"
          title={item.source.provenance}
        >
          Inferred · {item.source.provenance}
        </span>
      )}
      <KitchenStockItemActions
        ingredientName={ingredient.name}
        onEdit={onEdit}
        onRemove={onRemove}
      />
    </Badge>
  );
}

function KitchenStockGroupView({
  group,
  items,
  onAdd,
  onEdit,
  onRemove,
}: Readonly<{
  group: KitchenStockGroup;
  items: Record<string, KitchenItemDetails>;
  onAdd: () => void;
  onEdit: (slug: KitchenIngredientView["slug"]) => void;
  onRemove: (slug: KitchenIngredientView["slug"]) => void;
}>) {
  const Icon = group.icon;
  return (
    <section className="min-w-0">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2 border-b border-[var(--line)] pb-2">
        <div className="min-w-0">
          <h2 className="rt-display flex items-center gap-2 text-3xl text-[var(--terracotta)]">
            <Icon className="size-5" />
            {group.label}
          </h2>
          <p className="rt-body text-sm text-[var(--ink-3)]">
            {group.description}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-[var(--terracotta)]"
          onClick={onAdd}
          aria-label={`Add ingredients to ${group.label}`}
        >
          <CirclePlus className="size-4" />
          Add here
        </Button>
      </div>
      {group.items.length > 0 ? (
        <div className="flex min-w-0 flex-wrap gap-2">
          {group.items.map((ingredient) => {
            const item = items[ingredient.slug];
            return item ? (
              <KitchenStockItem
                key={ingredient.slug}
                ingredient={ingredient}
                item={item}
                onEdit={() => onEdit(ingredient.slug)}
                onRemove={() => onRemove(ingredient.slug)}
              />
            ) : null;
          })}
        </div>
      ) : (
        <p className="rt-body text-sm text-[var(--ink-3)]">Nothing here yet.</p>
      )}
    </section>
  );
}

export function KitchenStockGroups({
  groups,
  items,
  onAdd,
  onEdit,
  onRemove,
}: Readonly<{
  groups: KitchenStockGroup[];
  items: Record<string, KitchenItemDetails>;
  onAdd: (location: KitchenLocation) => void;
  onEdit: (slug: KitchenIngredientView["slug"]) => void;
  onRemove: (slug: KitchenIngredientView["slug"]) => void;
}>) {
  return groups.map((group) => (
    <KitchenStockGroupView
      key={group.id}
      group={group}
      items={items}
      onAdd={() => onAdd(group.id)}
      onEdit={onEdit}
      onRemove={onRemove}
    />
  ));
}
