"use client";

import type { LucideIcon } from "lucide-react";
import { CirclePlus, Pencil, X } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  KITCHEN_LOCATIONS,
  type KitchenIngredientView,
  type KitchenItemDetails,
  type KitchenLocation,
} from "@/lib/domain/recipe/kitchen";

const FRESHNESS_LABELS = {
  fresh: "Fresh",
  use_soon: "Use soon",
  past_best_before: "Past best before",
  unknown: "Not recorded",
} as const;

type ItemCorrection = Pick<
  KitchenItemDetails,
  "location" | "quantity" | "freshness"
>;

function KitchenItemSelects({
  freshness,
  location,
  setFreshness,
  setLocation,
}: Readonly<{
  freshness: KitchenItemDetails["freshness"];
  location: KitchenLocation;
  setFreshness: (value: KitchenItemDetails["freshness"]) => void;
  setLocation: (value: KitchenLocation) => void;
}>) {
  return (
    <>
      <label className="rt-body grid gap-1 text-sm text-[var(--ink-2)]">
        Location
        <select
          value={location}
          onChange={(event) =>
            setLocation(event.target.value as KitchenLocation)
          }
          className="h-10 rounded-md border border-[var(--line-strong)] bg-[var(--card)] px-3"
        >
          {KITCHEN_LOCATIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="rt-body grid gap-1 text-sm text-[var(--ink-2)]">
        Freshness
        <select
          value={freshness}
          onChange={(event) =>
            setFreshness(event.target.value as KitchenItemDetails["freshness"])
          }
          className="h-10 rounded-md border border-[var(--line-strong)] bg-[var(--card)] px-3"
        >
          {Object.entries(FRESHNESS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
    </>
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
        Unit
        <Input
          id="kitchen-item-unit"
          maxLength={32}
          value={unit}
          onChange={(event) => setUnit(event.target.value)}
          placeholder="g, ml, tins..."
        />
      </label>
    </>
  );
}

function useKitchenItemCorrection(item: KitchenItemDetails) {
  const [location, setLocation] = useState(item.location);
  const [amount, setAmount] = useState(
    item.quantity ? String(item.quantity.amount) : "",
  );
  const [unit, setUnit] = useState(item.quantity?.unit ?? "");
  const [freshness, setFreshness] = useState(item.freshness);
  const parsedAmount = Number(amount);
  const quantityIsValid =
    amount === "" ||
    (Number.isFinite(parsedAmount) &&
      parsedAmount > 0 &&
      unit.trim().length > 0);
  return {
    amount,
    freshness,
    location,
    parsedAmount,
    quantityIsValid,
    setAmount,
    setFreshness,
    setLocation,
    setUnit,
    unit,
  };
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
          Enter a positive quantity and a unit, or leave both blank.
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
        if (!correction.quantityIsValid) return;
        onSave({
          location: correction.location,
          quantity:
            correction.amount === ""
              ? null
              : {
                  amount: correction.parsedAmount,
                  unit: correction.unit.trim(),
                },
          freshness: correction.freshness,
        });
      }}
    >
      <p className="rt-body font-medium text-[var(--ink)] sm:col-span-2">
        Correct {ingredient.name}
      </p>
      <KitchenItemSelects
        freshness={correction.freshness}
        location={correction.location}
        setFreshness={correction.setFreshness}
        setLocation={correction.setLocation}
      />
      <KitchenQuantityFields
        amount={correction.amount}
        setAmount={correction.setAmount}
        setUnit={correction.setUnit}
        unit={correction.unit}
      />
      <KitchenItemEditorActions
        isValid={correction.quantityIsValid}
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
      {item.freshness !== "unknown" && (
        <span className="rt-mono text-[var(--ink-3)]">
          {FRESHNESS_LABELS[item.freshness]}
        </span>
      )}
      {item.source.kind === "inferred" && (
        <span
          className="max-w-48 truncate rt-mono text-[var(--ink-3)]"
          title={item.source.provenance}
        >
          {Math.round(item.source.confidence * 100)}% inferred ·{" "}
          {item.source.provenance}
        </span>
      )}
      <button
        type="button"
        onClick={onEdit}
        className="rounded-sm p-0.5 text-[var(--ink-3)] transition-colors hover:bg-[var(--paper)] hover:text-[var(--terracotta)]"
        aria-label={`Edit ${ingredient.name}`}
      >
        <Pencil className="size-3" />
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="rounded-sm p-0.5 text-[var(--ink-3)] transition-colors hover:bg-[var(--paper)] hover:text-[var(--berry)]"
        aria-label={`Remove ${ingredient.name}`}
      >
        <X className="size-3" />
      </button>
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
