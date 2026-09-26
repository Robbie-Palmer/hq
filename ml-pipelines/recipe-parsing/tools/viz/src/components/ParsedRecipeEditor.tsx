import { useEffect, useId, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import type { IngredientGroup, ParsedRecipe, RecipeIngredient, Unit } from "recipe-domain";
import { UNIT_LABELS } from "recipe-domain";
import { formatAmount } from "../lib/format";
import type { CanonicalizationDecision } from "../types/canonicalization";

interface ParsedRecipeEditorProps {
  identity: string;
  value: ParsedRecipe;
  diagnostics?: string[];
  onChange: (value: ParsedRecipe) => void;
  /** When set, editor is in canonicalization mode with slug-focused editing. */
  canonicalization?: {
    canonicalSlugs: Set<string>;
    categories: Map<string, string>;
    normalizationSource: ParsedRecipe | null;
    decisions: CanonicalizationDecision[];
    onAddCanonicalIngredient: (slug: string, category: string) => void;
  };
}

const EMPTY_INGREDIENT: RecipeIngredient = {
  ingredient: "",
};

const INGREDIENT_CATEGORIES = [
  "protein",
  "vegetable",
  "fruit",
  "herb",
  "dairy",
  "grain",
  "spice",
  "condiment",
  "oil-fat",
  "liquid",
  "other",
] as const;

function updateArrayItem<T>(items: T[], index: number, next: T): T[] {
  return items.map((item, i) => (i === index ? next : item));
}

function removeArrayItem<T>(items: T[], index: number): T[] {
  return [...items.slice(0, index), ...items.slice(index + 1)];
}

function updateField<K extends keyof ParsedRecipe>(
  recipe: ParsedRecipe,
  key: K,
  next: ParsedRecipe[K],
): ParsedRecipe {
  return { ...recipe, [key]: next };
}

interface IngredientGroupKeys {
  key: string;
  itemKeys: string[];
}

interface EditorKeyState {
  identity: string;
  groups: IngredientGroupKeys[];
  cookwareKeys: string[];
  nextSequence: number;
}

function editorKey(editorId: string, kind: string, sequence: number): string {
  return `${editorId}-${kind}-${sequence}`;
}

function initialEditorKeyState(
  recipe: ParsedRecipe,
  editorId: string,
  identity: string,
): EditorKeyState {
  let nextSequence = 0;
  const groups = recipe.ingredientGroups.map((group) => ({
    key: editorKey(editorId, "group", nextSequence++),
    itemKeys: group.items.map(() =>
      editorKey(editorId, "ingredient", nextSequence++),
    ),
  }));
  const cookwareKeys = recipe.cookware.map(() =>
    editorKey(editorId, "cookware", nextSequence++),
  );
  return {
    identity,
    groups,
    cookwareKeys,
    nextSequence,
  };
}

function reconcileEditorKeyState(
  state: EditorKeyState,
  recipe: ParsedRecipe,
  editorId: string,
  identity: string,
): EditorKeyState {
  if (state.identity !== identity) {
    return initialEditorKeyState(recipe, editorId, identity);
  }

  let nextSequence = state.nextSequence;
  let changed = state.groups.length !== recipe.ingredientGroups.length;
  const groups = recipe.ingredientGroups.map((group, groupIndex) => {
    const existing = state.groups[groupIndex];
    if (!existing) {
      changed = true;
      return {
        key: editorKey(editorId, "group", nextSequence++),
        itemKeys: group.items.map(() =>
          editorKey(editorId, "ingredient", nextSequence++),
        ),
      };
    }
    if (existing.itemKeys.length === group.items.length) return existing;
    changed = true;
    const itemKeys = existing.itemKeys.slice(0, group.items.length);
    while (itemKeys.length < group.items.length) {
      itemKeys.push(editorKey(editorId, "ingredient", nextSequence++));
    }
    return { ...existing, itemKeys };
  });

  const cookwareKeys = state.cookwareKeys.slice(0, recipe.cookware.length);
  if (cookwareKeys.length !== state.cookwareKeys.length) changed = true;
  while (cookwareKeys.length < recipe.cookware.length) {
    changed = true;
    cookwareKeys.push(editorKey(editorId, "cookware", nextSequence++));
  }
  if (!changed) return state;
  return { ...state, groups, cookwareKeys, nextSequence };
}

function ontologyStatusClass(
  slugChanged: boolean,
  isInOntology: boolean,
  ingredient: string,
): string {
  if (slugChanged) return "bg-blue-400";
  if (isInOntology) return "bg-green-400";
  if (ingredient) return "bg-amber-400";
  return "bg-gray-200";
}

function AddToOntologyForm({
  slug,
  onAdd,
  onCancel,
}: Readonly<{
  slug: string;
  onAdd: (slug: string, category: string) => void;
  onCancel: () => void;
}>) {
  const [category, setCategory] = useState("other");
  return (
    <div className="flex items-center gap-1.5 mt-1 ml-1">
      <span className="text-xs text-gray-500 font-mono">{slug}</span>
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        className="px-1.5 py-0.5 text-xs border border-gray-200 rounded bg-white outline-none focus:border-blue-400"
      >
        {INGREDIENT_CATEGORIES.map((cat) => (
          <option key={cat} value={cat}>{cat}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => onAdd(slug, category)}
        className="px-2 py-0.5 text-xs bg-green-600 text-white rounded hover:bg-green-700"
      >
        Add
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="px-2 py-0.5 text-xs border border-gray-200 rounded hover:bg-gray-50"
      >
        Cancel
      </button>
    </div>
  );
}

export function ParsedRecipeEditor({
  identity,
  value,
  diagnostics = [],
  onChange,
  canonicalization,
}: Readonly<ParsedRecipeEditorProps>) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [addingRowKey, setAddingRowKey] = useState<string | null>(null);
  const editorId = useId();
  const [keyState, setKeyState] = useState(() =>
    initialEditorKeyState(value, editorId, identity),
  );
  const renderedKeyState = reconcileEditorKeyState(
    keyState,
    value,
    editorId,
    identity,
  );

  useEffect(() => {
    setExpandedRows(new Set());
    setAddingRowKey(null);
  }, [identity]);

  function updateKeys(
    update: (current: EditorKeyState) => EditorKeyState,
  ): void {
    setKeyState((current) =>
      update(reconcileEditorKeyState(current, value, editorId, identity)),
    );
  }

  function addGroupKeys(): void {
    updateKeys((current) => {
      const groupKey = editorKey(editorId, "group", current.nextSequence);
      const itemKey = editorKey(
        editorId,
        "ingredient",
        current.nextSequence + 1,
      );
      return {
        ...current,
        groups: [...current.groups, { key: groupKey, itemKeys: [itemKey] }],
        nextSequence: current.nextSequence + 2,
      };
    });
  }

  function addIngredientKey(groupIndex: number): void {
    updateKeys((current) => ({
      ...current,
      groups: current.groups.map((group, index) =>
        index === groupIndex
          ? {
              ...group,
              itemKeys: [
                ...group.itemKeys,
                editorKey(editorId, "ingredient", current.nextSequence),
              ],
            }
          : group,
      ),
      nextSequence: current.nextSequence + 1,
    }));
  }

  function removeIngredientKey(groupIndex: number, itemIndex: number): void {
    updateKeys((current) => ({
      ...current,
      groups: current.groups.map((keys, index) =>
        index === groupIndex
          ? {
              ...keys,
              itemKeys: removeArrayItem(keys.itemKeys, itemIndex),
            }
          : keys,
      ),
    }));
  }

  function addCookwareKey(): void {
    updateKeys((current) => ({
      ...current,
      cookwareKeys: [
        ...current.cookwareKeys,
        editorKey(editorId, "cookware", current.nextSequence),
      ],
      nextSequence: current.nextSequence + 1,
    }));
  }

  function toggleRow(key: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function updateGroup(groupIndex: number, nextGroup: IngredientGroup) {
    onChange(
      updateField(
        value,
        "ingredientGroups",
        updateArrayItem(value.ingredientGroups, groupIndex, nextGroup),
      ),
    );
  }

  function updateIngredient(
    groupIndex: number,
    itemIndex: number,
    nextIngredient: RecipeIngredient,
  ) {
    const group = value.ingredientGroups[groupIndex];
    updateGroup(groupIndex, {
      ...group,
      items: updateArrayItem(group.items, itemIndex, nextIngredient),
    });
  }

  // Build a map from original/base slug → decision for quick lookup
  const decisionMap = useMemo(() => {
    if (!canonicalization) return null;
    const map = new Map<string, CanonicalizationDecision>();
    for (const d of canonicalization.decisions) {
      map.set(d.baseSlug, d);
      if (d.originalSlug !== d.baseSlug) map.set(d.originalSlug, d);
    }
    return map;
  }, [canonicalization?.decisions]);

  // Sorted canonical slugs for datalist
  const sortedCanonicalSlugs = useMemo(() => {
    if (!canonicalization) return [];
    return [...canonicalization.canonicalSlugs].sort((a, b) =>
      a.localeCompare(b, "en"),
    );
  }, [canonicalization?.canonicalSlugs]);

  const isCanon = canonicalization != null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
      <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">
        Expected Canonicalized Ground Truth
      </div>

      {/* Title & description — always read-only context */}
      <div>
        <h3 className="text-lg font-bold mb-1">{value.title}</h3>
        {value.description && (
          <p className="text-sm text-gray-600">{value.description}</p>
        )}
      </div>

      {/* Metadata row */}
      <div className={`grid ${isCanon ? "" : "grid-cols-4"} gap-3`}>
        <label className="block">
          <span className="text-xs font-medium text-gray-500">Cuisine</span>
          <input
            type="text"
            value={value.cuisine.join(", ")}
            onChange={(e) =>
              onChange(
                updateField(
                  value,
                  "cuisine",
                  e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                ),
              )
            }
            placeholder="e.g. italian, american"
            className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-200 rounded outline-none focus:border-blue-400"
          />
        </label>
        {!isCanon && (
          <>
            <label className="block">
              <span className="text-xs font-medium text-gray-500">Servings</span>
              <input
                type="number"
                min="1"
                value={value.servings}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  onChange(updateField(value, "servings", Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0));
                }}
                className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-200 rounded outline-none focus:border-blue-400"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-500">Prep (min)</span>
              <input
                type="number"
                min="0"
                value={value.prepTime ?? ""}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  onChange(updateField(value, "prepTime", e.target.value && Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : undefined));
                }}
                className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-200 rounded outline-none focus:border-blue-400"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-500">Cook (min)</span>
              <input
                type="number"
                min="0"
                value={value.cookTime ?? ""}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  onChange(updateField(value, "cookTime", e.target.value && Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : undefined));
                }}
                className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-200 rounded outline-none focus:border-blue-400"
              />
            </label>
          </>
        )}
      </div>

      {/* Datalist for canonical slug autocomplete */}
      {isCanon && (
        <datalist id="canonical-slugs">
          {sortedCanonicalSlugs.map((slug) => (
            <option key={slug} value={slug} />
          ))}
        </datalist>
      )}

      {/* Ingredients */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-gray-900">Ingredients</div>
          <button
            type="button"
            onClick={() => {
              addGroupKeys();
              onChange({
                ...value,
                ingredientGroups: [
                  ...value.ingredientGroups,
                  { name: undefined, items: [{ ...EMPTY_INGREDIENT }] },
                ],
              });
            }}
            className="px-2 py-1 text-xs border border-gray-200 rounded hover:bg-gray-50"
          >
            Add Group
          </button>
        </div>

        {value.ingredientGroups.map((group, groupIndex) => {
          const groupKeys = renderedKeyState.groups[groupIndex]!;
          const groupKey = groupKeys.key;
          return (
          <div
            key={groupKey}
            className="border border-gray-200 rounded overflow-hidden"
          >
            <div className="flex items-center gap-2 bg-gray-50 px-2 py-1.5">
              <input
                type="text"
                value={group.name ?? ""}
                onChange={(e) =>
                  updateGroup(groupIndex, { ...group, name: e.target.value || undefined })
                }
                placeholder="Group name (optional)"
                className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded outline-none focus:border-blue-400 bg-white"
              />
              <button
                type="button"
                onClick={() => {
                  updateKeys((current) => ({
                    ...current,
                    groups: removeArrayItem(current.groups, groupIndex),
                  }));
                  onChange({
                    ...value,
                    ingredientGroups: removeArrayItem(
                      value.ingredientGroups,
                      groupIndex,
                    ),
                  });
                }}
                className="px-2 py-1 text-xs border border-gray-200 rounded hover:bg-gray-100"
              >
                Remove
              </button>
            </div>

            {/* Table header */}
            {isCanon ? (
              <div className="grid grid-cols-[3px_1fr_auto_auto_auto] gap-px bg-gray-100 px-2 py-1 items-center">
                <span />
                <span className="text-xs font-medium text-gray-500">Ingredient</span>
                <span className="text-xs font-medium text-gray-500 w-24 text-right">Qty</span>
                <span className="w-5" />
                <span className="w-5" />
              </div>
            ) : (
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-px bg-gray-100 px-2 py-1">
                <span className="text-xs font-medium text-gray-500">Ingredient</span>
                <span className="text-xs font-medium text-gray-500 w-14 text-center">Amt</span>
                <span className="text-xs font-medium text-gray-500 w-20 text-center">Unit</span>
                <span className="w-5" />
              </div>
            )}

            {/* Ingredient rows */}
            <div className="divide-y divide-gray-100">
              {/** biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited. */}
              {group.items.map((item, itemIndex) => {
                const rowKey = groupKeys.itemKeys[itemIndex]!;
                const isExpanded = expandedRows.has(rowKey);

                // Canonicalization-specific data
                const normSlug = canonicalization?.normalizationSource
                  ?.ingredientGroups[groupIndex]?.items[itemIndex]?.ingredient ?? null;
                const slugChanged = normSlug != null && item.ingredient !== normSlug;
                const isInOntology = canonicalization?.canonicalSlugs.has(item.ingredient) ?? false;
                const decision = decisionMap?.get(item.ingredient) ?? decisionMap?.get(normSlug ?? "") ?? null;
                const category = canonicalization?.categories.get(item.ingredient);

                if (isCanon) {
                  // Canonicalization mode: slug-focused compact row
                  return (
                    <div key={rowKey} className="px-2 py-1.5 space-y-1">
                      <div className="grid grid-cols-[3px_1fr_auto_auto_auto] gap-1.5 items-center">
                        {/* Status indicator bar */}
                        <div
                          className={`h-full rounded-full ${ontologyStatusClass(slugChanged, isInOntology, item.ingredient)}`}
                        />

                        {/* Slug input with datalist + status */}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              list="canonical-slugs"
                              value={item.ingredient}
                              onChange={(e) =>
                                updateIngredient(groupIndex, itemIndex, {
                                  ...item,
                                  ingredient: e.target.value,
                                })
                              }
                              placeholder="slug"
                              className="flex-1 min-w-0 px-1.5 py-1 text-xs font-mono border border-gray-200 rounded outline-none focus:border-blue-400"
                            />
                            {item.ingredient && !isInOntology && (
                              <button
                                type="button"
                                onClick={() => setAddingRowKey(rowKey)}
                                className="shrink-0 flex items-center gap-0.5 px-1.5 py-0.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded hover:bg-amber-100"
                                title="Add to canonical ontology"
                              >
                                <Plus className="h-3 w-3" />
                                Add
                              </button>
                            )}
                            {isInOntology && category && (
                              <span className="shrink-0 text-xs text-gray-400">{category}</span>
                            )}
                          </div>
                          {/* Decision hint */}
                          {decision && decision.canonicalSlug !== item.ingredient && (
                            <button
                              type="button"
                              onClick={() =>
                                updateIngredient(groupIndex, itemIndex, {
                                  ...item,
                                  ingredient: decision.canonicalSlug,
                                })
                              }
                              className="mt-0.5 text-xs text-blue-600 hover:text-blue-800 hover:underline"
                            >
                              {"\u2192"} {decision.canonicalSlug}
                              <span className="text-gray-400 ml-1">
                                ({decision.method}{decision.score != null ? `, ${decision.score.toFixed(2)}` : ""})
                              </span>
                            </button>
                          )}
                          {/* Normalization source hint */}
                          {slugChanged && (
                            <div className="text-xs text-gray-400 mt-0.5">
                              was: <span className="font-mono">{normSlug}</span>
                            </div>
                          )}
                          {/* Add to ontology inline form */}
                          {addingRowKey === rowKey && canonicalization && (
                            <AddToOntologyForm
                              slug={item.ingredient}
                              onAdd={(slug, cat) => {
                                canonicalization.onAddCanonicalIngredient(slug, cat);
                                setAddingRowKey(null);
                              }}
                              onCancel={() => setAddingRowKey(null)}
                            />
                          )}
                        </div>

                        {/* Amount + unit read-only summary */}
                        <span className="w-24 text-right text-xs text-gray-500 truncate">
                          {formatAmount(item) || "—"}
                        </span>

                        {/* Expand/collapse toggle */}
                        <button
                          type="button"
                          onClick={() => toggleRow(rowKey)}
                          className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-600"
                        >
                          {isExpanded
                            ? <ChevronDown className="h-3.5 w-3.5" />
                            : <ChevronRight className="h-3.5 w-3.5" />}
                        </button>

                        {/* Remove */}
                        <button
                          type="button"
                          onClick={() => {
                            removeIngredientKey(groupIndex, itemIndex);
                            updateGroup(groupIndex, {
                              ...group,
                              items: group.items.filter((_, i) => i !== itemIndex),
                            });
                          }}
                          className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-600 text-xs"
                        >
                          &times;
                        </button>
                      </div>

                      {/* Expanded detail row */}
                      {isExpanded && (
                        <div className="ml-2 pl-2 border-l-2 border-gray-100 space-y-1.5 pt-1">
                          <div className="grid grid-cols-[1fr_1fr] gap-1.5">
                            <div>
                              <span className="text-xs text-gray-400">Amount</span>
                              <input
                                type="number"
                                min="0"
                                step="any"
                                value={item.amount ?? ""}
                                onChange={(e) => {
                                  const n = Number(e.target.value);
                                  updateIngredient(groupIndex, itemIndex, {
                                    ...item,
                                    amount: e.target.value && Number.isFinite(n) ? n : undefined,
                                  });
                                }}
                                placeholder="—"
                                className="w-full px-1.5 py-1 text-xs border border-gray-200 rounded outline-none focus:border-blue-400"
                              />
                            </div>
                            <div>
                              <span className="text-xs text-gray-400">Unit</span>
                              <select
                                value={item.unit ?? ""}
                                onChange={(e) =>
                                  updateIngredient(groupIndex, itemIndex, {
                                    ...item,
                                    unit: e.target.value ? (e.target.value as Unit) : undefined,
                                  })
                                }
                                className="w-full px-1.5 py-1 text-xs border border-gray-200 rounded outline-none focus:border-blue-400 bg-white"
                              >
                                <option value="">—</option>
                                {Object.entries(UNIT_LABELS).map(([unit, label]) => (
                                  <option key={unit} value={unit}>{label.singular}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <div className="grid grid-cols-[1fr_1fr] gap-1.5">
                            <div>
                              <span className="text-xs text-gray-400">Preparation</span>
                              <input
                                type="text"
                                value={item.preparation ?? ""}
                                onChange={(e) =>
                                  updateIngredient(groupIndex, itemIndex, {
                                    ...item,
                                    preparation: e.target.value || undefined,
                                  })
                                }
                                placeholder="e.g. chopped"
                                className="w-full px-1.5 py-1 text-xs border border-gray-200 rounded outline-none focus:border-blue-400"
                              />
                            </div>
                            <div>
                              <span className="text-xs text-gray-400">Note</span>
                              <input
                                type="text"
                                value={item.note ?? ""}
                                onChange={(e) =>
                                  updateIngredient(groupIndex, itemIndex, {
                                    ...item,
                                    note: e.target.value || undefined,
                                  })
                                }
                                placeholder="e.g. optional"
                                className="w-full px-1.5 py-1 text-xs border border-gray-200 rounded outline-none focus:border-blue-400"
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                }

                // Non-canonicalization mode: full editing (used if editor is reused elsewhere)
                return (
                  <div key={rowKey} className="px-2 py-1.5 space-y-1">
                    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-1.5 items-center">
                      <input
                        type="text"
                        value={item.ingredient}
                        onChange={(e) =>
                          updateIngredient(groupIndex, itemIndex, { ...item, ingredient: e.target.value })
                        }
                        placeholder="slug"
                        className="w-full px-1.5 py-1 text-xs font-mono border border-gray-200 rounded outline-none focus:border-blue-400"
                      />
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={item.amount ?? ""}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          updateIngredient(groupIndex, itemIndex, {
                            ...item,
                            amount: e.target.value && Number.isFinite(n) ? n : undefined,
                          });
                        }}
                        placeholder="—"
                        className="w-14 px-1.5 py-1 text-xs border border-gray-200 rounded outline-none focus:border-blue-400 text-center"
                      />
                      <select
                        value={item.unit ?? ""}
                        onChange={(e) =>
                          updateIngredient(groupIndex, itemIndex, {
                            ...item,
                            unit: e.target.value ? (e.target.value as Unit) : undefined,
                          })
                        }
                        className="w-20 px-1.5 py-1 text-xs border border-gray-200 rounded outline-none focus:border-blue-400 bg-white"
                      >
                        <option value="">—</option>
                        {Object.entries(UNIT_LABELS).map(([unit, label]) => (
                          <option key={unit} value={unit}>{label.singular}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => {
                          removeIngredientKey(groupIndex, itemIndex);
                          updateGroup(groupIndex, {
                            ...group,
                            items: group.items.filter((_, i) => i !== itemIndex),
                          });
                        }}
                        className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-600 text-xs"
                      >
                        &times;
                      </button>
                    </div>
                    {(item.preparation || item.note) && (
                      <div className="flex gap-1.5 pl-1">
                        <input
                          type="text"
                          value={item.preparation ?? ""}
                          onChange={(e) =>
                            updateIngredient(groupIndex, itemIndex, {
                              ...item,
                              preparation: e.target.value || undefined,
                            })
                          }
                          placeholder="preparation"
                          className="flex-1 min-w-0 px-1.5 py-0.5 text-xs border border-gray-200 rounded outline-none focus:border-blue-400 text-gray-600"
                        />
                        <input
                          type="text"
                          value={item.note ?? ""}
                          onChange={(e) =>
                            updateIngredient(groupIndex, itemIndex, {
                              ...item,
                              note: e.target.value || undefined,
                            })
                          }
                          placeholder="note"
                          className="flex-1 min-w-0 px-1.5 py-0.5 text-xs border border-gray-200 rounded outline-none focus:border-blue-400 text-gray-600"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="px-2 py-1.5 bg-gray-50">
              <button
                type="button"
                onClick={() => {
                  addIngredientKey(groupIndex);
                  updateGroup(groupIndex, {
                    ...group,
                    items: [...group.items, { ...EMPTY_INGREDIENT }],
                  });
                }}
                className="px-2 py-1 text-xs border border-gray-200 rounded hover:bg-gray-100"
              >
                + Add
              </button>
            </div>
          </div>
          );
        })}
      </div>

      {/* Equipment */}
      <div>
        <div className="text-sm font-semibold text-gray-900 mb-2">Equipment</div>
        <div className="border border-gray-200 rounded overflow-hidden">
          <div className="divide-y divide-gray-100">
            {value.cookware.map((item, i) => (
              <div key={renderedKeyState.cookwareKeys[i]} className="flex items-center gap-1.5 px-2 py-1">
                <input
                  type="text"
                  value={item}
                  onChange={(e) => {
                    const next = [...value.cookware];
                    next[i] = e.target.value;
                    onChange(updateField(value, "cookware", next));
                  }}
                  className="flex-1 min-w-0 px-1.5 py-1 text-xs border border-gray-200 rounded outline-none focus:border-blue-400"
                />
                <button
                  type="button"
                  onClick={() => {
                    updateKeys((current) => ({
                      ...current,
                      cookwareKeys: removeArrayItem(current.cookwareKeys, i),
                    }));
                    onChange(
                      updateField(
                        value,
                        "cookware",
                        removeArrayItem(value.cookware, i),
                      ),
                    );
                  }}
                  className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-600 text-xs"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
          <div className="px-2 py-1.5 bg-gray-50">
            <button
              type="button"
              onClick={() => {
                addCookwareKey();
                onChange(updateField(value, "cookware", [...value.cookware, ""]));
              }}
              className="px-2 py-1 text-xs border border-gray-200 rounded hover:bg-gray-100"
            >
              + Add
            </button>
          </div>
        </div>
      </div>

      {/* Instructions — read-only context (hidden in canonicalization mode) */}
      {!isCanon && (
      <div>
        <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
          Instructions (from normalization)
        </div>
        <ol className="space-y-1 list-decimal list-inside">
          {value.instructions.map((step, i) => (
            <li key={i} className="text-sm leading-relaxed pl-1 text-gray-600">
              {step}
            </li>
          ))}
        </ol>
      </div>
      )}

      {diagnostics.length > 0 && (
        <div className="rounded border border-amber-200 bg-amber-50 p-3">
          <div className="text-xs font-medium uppercase tracking-wide text-amber-700 mb-2">
            Validation Issues
          </div>
          <ul className="space-y-1 text-sm text-amber-900">
            {diagnostics.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
