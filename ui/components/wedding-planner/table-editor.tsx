"use client";

import { downloadTextFile } from "browser-base/downloads";
import { ArrowRight, Download, Lock, Save, Trash2 } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import {
  defaultWeddingReadinessPreferences,
  type WeddingPlan,
  weddingRoleLabels,
  weddingRolesLabel,
} from "wedding-planner-domain";
import {
  compareSeatingAlternatives,
  exportAccessibleFloorPlanSvg,
  exportCateringSummaryCsv,
  exportSeatingAssignmentsCsv,
} from "wedding-planner-domain/seating";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { editorStateToPlan } from "@/lib/wedding-planner/editor-projection";
import {
  acceptAccommodationSeatingSuggestions,
  accommodationSeatingSuggestions,
  chooseSeatingAlternative,
  getTablePlan,
  lockGuestSeat,
  removeSeatingAlternative,
  saveSeatingAlternative,
  seatAttendingWeddingParty,
  setAttendance,
  setTableLock,
  setTablePairDecision,
  setTopTableGuest,
  tablePairDecision,
  unlockGuestSeat,
} from "@/lib/wedding-planner/table-state";
import type {
  Guest,
  TableAllocation,
  TablePlan,
  WeddingPlanDraft,
} from "@/lib/wedding-planner/types";

import { TableRoomMap } from "./table-room-map";

function SeatInput({
  label,
  value,
  min = 1,
  max = 100,
  onChange,
}: Readonly<{
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}>) {
  const inputId = useId();
  return (
    <label className="editor-field" htmlFor={inputId}>
      <span className="editor-label">{label}</span>
      <Input
        id={inputId}
        aria-label={label}
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => {
          const number = Number(event.target.value);
          if (
            event.target.value &&
            Number.isInteger(number) &&
            number >= min &&
            number <= max
          )
            onChange(number);
        }}
      />
    </label>
  );
}

function TableSetup({
  plan,
  onChange,
}: Readonly<{
  plan: TablePlan;
  onChange: (change: (plan: TablePlan) => void) => void;
}>) {
  const [defaultCapacity, setDefaultCapacity] = useState(
    plan.table_capacities[0] ?? 8,
  );
  const tables = plan.table_capacities.map((capacity, index) => ({
    id: `table-${index + 1}`,
    capacity,
    index,
  }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tables &amp; seats</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="field-grid">
          <SeatInput
            label="Top table capacity"
            value={plan.top_table_capacity}
            min={2}
            onChange={(value) =>
              onChange((draft) => {
                draft.top_table_capacity = value;
              })
            }
          />
          <SeatInput
            label="Number of guest tables"
            min={0}
            value={plan.table_capacities.length}
            onChange={(value) =>
              onChange((draft) => {
                for (const id of Object.keys(draft.table_layout ?? {})) {
                  if (id !== "top" && Number(id.slice(6)) > value)
                    delete draft.table_layout?.[id];
                }
                draft.table_capacities = Array.from(
                  { length: value },
                  (_, index) =>
                    draft.table_capacities[index] ?? defaultCapacity,
                );
              })
            }
          />
          <SeatInput
            label="Seats per guest table"
            value={defaultCapacity}
            onChange={setDefaultCapacity}
          />
          <Button
            variant="outline"
            className="table-apply-capacity"
            onClick={() =>
              onChange((draft) => {
                draft.table_capacities = draft.table_capacities.map(
                  () => defaultCapacity,
                );
              })
            }
          >
            Apply to all guest tables
          </Button>
        </div>
        <div className="table-capacities">
          {tables.map(({ id, capacity, index }) => (
            <SeatInput
              key={id}
              label={`Table ${index + 1} capacity`}
              value={capacity}
              onChange={(value) =>
                onChange((draft) => {
                  draft.table_capacities[index] = value;
                })
              }
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

type PlanUpdate = (change: (draft: WeddingPlanDraft) => void) => void;

function GuestFlags({
  guest,
  onUpdate,
}: Readonly<{ guest: Guest; onUpdate: PlanUpdate }>) {
  const toggle = (field: "is_child" | "requires_high_chair", value: boolean) =>
    onUpdate((draft) => {
      const person = draft.guests.find((item) => item.id === guest.id);
      if (person) person[field] = value;
    });
  const accessible =
    guest.seating_constraints?.requires_accessible_seat ?? false;
  return (
    <>
      <label className="table-top-choice">
        <input
          type="checkbox"
          checked={guest.is_child ?? false}
          onChange={(event) => toggle("is_child", event.target.checked)}
          aria-label={`${guest.name} is a child`}
        />{" "}
        Child
      </label>
      <label className="table-top-choice">
        <input
          type="checkbox"
          checked={guest.requires_high_chair ?? false}
          onChange={(event) =>
            toggle("requires_high_chair", event.target.checked)
          }
          aria-label={`${guest.name} needs a high chair`}
        />{" "}
        High chair
      </label>
      <label className="table-top-choice">
        <input
          type="checkbox"
          checked={accessible}
          onChange={(event) =>
            onUpdate((draft) => {
              const person = draft.guests.find((item) => item.id === guest.id);
              if (!person) return;
              person.seating_constraints = {
                prefer_with: person.seating_constraints?.prefer_with ?? [],
                avoid_with: person.seating_constraints?.avoid_with ?? [],
                requires_accessible_seat: event.target.checked,
                notes: person.seating_constraints?.notes ?? "",
              };
            })
          }
          aria-label={`${guest.name} needs an accessible seat`}
        />{" "}
        Accessible seat
      </label>
    </>
  );
}

function TableGuestRow({
  guest,
  atTop,
  onUpdate,
}: Readonly<{ guest: Guest; atTop: boolean; onUpdate: PlanUpdate }>) {
  return (
    <div className="table-guest-row">
      <div>
        <strong>{guest.name}</strong>
        {!!guest.wedding_roles?.length && (
          <small>{weddingRolesLabel(guest.wedding_roles)}</small>
        )}
        {guest.free_stay_reasons.includes("wedding_party") && (
          <small>Wedding party accommodation</small>
        )}
      </div>
      <select
        className="editor-select"
        aria-label={`${guest.name} wedding attendance`}
        value={guest.attendance ?? "unknown"}
        onChange={(event) =>
          onUpdate((draft) =>
            setAttendance(
              draft,
              guest.id,
              event.target.value as "yes" | "no" | "unknown",
            ),
          )
        }
      >
        <option value="unknown">Undecided</option>
        <option value="yes">Attending</option>
        <option value="no">Not attending</option>
      </select>
      <label className="table-top-choice">
        <input
          type="checkbox"
          checked={atTop}
          disabled={guest.attendance !== "yes"}
          onChange={(event) =>
            onUpdate((draft) =>
              setTopTableGuest(draft, guest.id, event.target.checked),
            )
          }
          aria-label={`${guest.name} at top table`}
        />{" "}
        Top table
      </label>
      <GuestFlags guest={guest} onUpdate={onUpdate} />
    </div>
  );
}

function TableGuestList({
  state,
  plan,
  onUpdate,
}: Readonly<{
  state: WeddingPlanDraft;
  plan: TablePlan;
  onUpdate: (change: (draft: WeddingPlanDraft) => void) => void;
}>) {
  const [search, setSearch] = useState("");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Attendance &amp; top table</CardTitle>
      </CardHeader>
      <CardContent>
        <Button
          variant="outline"
          className="mb-4"
          onClick={() => onUpdate(seatAttendingWeddingParty)}
        >
          Seat wedding party at top table
        </Button>
        <Input
          aria-label="Search table guests"
          placeholder="Search guests…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="table-guest-list">
          {state.guests
            .filter((guest) =>
              guest.name.toLowerCase().includes(search.toLowerCase()),
            )
            .map((guest) => (
              <TableGuestRow
                key={guest.id}
                guest={guest}
                atTop={plan.top_table_guest_ids.includes(guest.id)}
                onUpdate={onUpdate}
              />
            ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TablePreferences({
  state,
  onUpdate,
}: Readonly<{
  state: WeddingPlanDraft;
  onUpdate: (change: (draft: WeddingPlanDraft) => void) => void;
}>) {
  const searchId = useId();
  const [selectedId, setSelectedId] = useState(state.guests[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const selected =
    state.guests.find((guest) => guest.id === selectedId) ?? state.guests[0];
  const suggestions = accommodationSeatingSuggestions(state);
  const selectedSuggestions = new Map(
    suggestions
      .filter((suggestion) => suggestion.guest_ids.includes(selectedId))
      .map((suggestion) => [
        suggestion.guest_ids.find((id) => id !== selectedId),
        suggestion.sources.join(" and "),
      ]),
  );
  return (
    <Card className="table-preferences">
      <CardHeader>
        <CardTitle>Seating preferences</CardTitle>
      </CardHeader>
      <CardContent>
        {suggestions.length > 0 && (
          <Button
            type="button"
            variant="outline"
            className="mb-4"
            onClick={() => onUpdate(acceptAccommodationSeatingSuggestions)}
          >
            Accept all {suggestions.length} sharing{" "}
            {suggestions.length === 1 ? "suggestion" : "suggestions"}
          </Button>
        )}
        <div className="field-grid">
          <label className="editor-field">
            <span className="editor-label">Guest</span>
            <select
              className="editor-select"
              aria-label="Table preferences for guest"
              value={selected?.id ?? ""}
              onChange={(event) => setSelectedId(event.target.value)}
            >
              {state.guests.map((guest) => (
                <option key={guest.id} value={guest.id}>
                  {guest.name}
                </option>
              ))}
            </select>
          </label>
          <label className="editor-field" htmlFor={searchId}>
            <span className="editor-label">Find another guest</span>
            <Input
              id={searchId}
              aria-label="Search table preferences"
              placeholder="Search guests…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>
        {selected && (
          <div className="sharing-pair-list">
            {state.guests
              .filter(
                (guest) =>
                  guest.id !== selected.id &&
                  guest.name.toLowerCase().includes(search.toLowerCase()),
              )
              .map((guest) => (
                <div className="sharing-pair-row" key={guest.id}>
                  <div>
                    <strong>{guest.name}</strong>
                    {selectedSuggestions.has(guest.id) && (
                      <div>
                        <p className="editor-hint">
                          Suggested from {selectedSuggestions.get(guest.id)}{" "}
                          sharing
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-2"
                          aria-label={`Accept sharing suggestion for ${selected.name} and ${guest.name}`}
                          onClick={() =>
                            onUpdate((draft) =>
                              acceptAccommodationSeatingSuggestions(draft, [
                                selected.id,
                                guest.id,
                              ]),
                            )
                          }
                        >
                          Use suggestion
                        </Button>
                      </div>
                    )}
                  </div>
                  <fieldset
                    className="sharing-decisions"
                    aria-label={`${selected.name} and ${guest.name} table preference`}
                  >
                    {(
                      [
                        ["yes", "Love to sit together"],
                        ["no", "Keep apart"],
                        ["unset", "No preference"],
                      ] as const
                    ).map(([decision, label]) => (
                      <button
                        type="button"
                        key={decision}
                        aria-pressed={
                          tablePairDecision(selected, guest) === decision
                        }
                        className={`pair-choice decision-${decision} ${tablePairDecision(selected, guest) === decision ? "active" : ""}`}
                        onClick={() =>
                          onUpdate((draft) =>
                            setTablePairDecision(
                              draft,
                              selected.id,
                              guest.id,
                              decision,
                            ),
                          )
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </fieldset>
                </div>
              ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ConstraintSetup({
  state,
  plan,
  onUpdate,
}: Readonly<{
  state: WeddingPlanDraft;
  plan: TablePlan;
  onUpdate: (change: (draft: WeddingPlanDraft) => void) => void;
}>) {
  const onChange = (change: (plan: TablePlan) => void) =>
    onUpdate((draft) => {
      draft.table_plan = getTablePlan(draft);
      change(draft.table_plan);
    });
  const groups = [
    ...new Set(state.guests.flatMap((guest) => guest.relationship_groups)),
  ].sort((first, second) => first.localeCompare(second));
  const roles = [
    ...new Set(state.guests.flatMap((guest) => guest.wedding_roles ?? [])),
  ].sort((first, second) => first.localeCompare(second));
  const tableOptions = [
    { id: "top", name: plan.table_layout?.top?.name || "Top table" },
    ...plan.table_capacities.map((_, index) => ({
      id: `table-${index + 1}`,
      name:
        plan.table_layout?.[`table-${index + 1}`]?.name || `Table ${index + 1}`,
    })),
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Event &amp; group rules</CardTitle>
        <CardDescription>
          Party locks are hard rules. Role and relationship table choices are
          scored preferences.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!!state.guest_directory?.events.length && (
          <label className="editor-field">
            <span className="editor-label">Event</span>
            <select
              className="editor-select"
              aria-label="Seating event"
              value={plan.event_id ?? ""}
              onChange={(event) =>
                onUpdate((draft) => {
                  const current = getTablePlan(draft);
                  draft.event_table_plans ??= {};
                  draft.event_table_plans[current.event_id ?? "general"] =
                    structuredClone(current);
                  const eventId = event.target.value || undefined;
                  const saved = draft.event_table_plans[eventId ?? "general"];
                  draft.table_plan = saved
                    ? structuredClone(saved)
                    : {
                        ...structuredClone(getTablePlan(draft)),
                        event_id: eventId,
                        locked_assignments: {},
                        locked_table_guest_ids: {},
                        saved_plans: [],
                        chosen_plan_id: undefined,
                      };
                })
              }
            >
              <option value="">General reception</option>
              {state.guest_directory.events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="table-top-choice">
          <input
            type="checkbox"
            checked={plan.keep_invitation_parties_together ?? false}
            onChange={(event) =>
              onChange((draft) => {
                draft.keep_invitation_parties_together = event.target.checked;
              })
            }
          />{" "}
          Keep invitation parties together
        </label>
        {groups.map((group) => (
          <div className="table-guest-row" key={group}>
            <label className="table-top-choice">
              <input
                type="checkbox"
                aria-label={`Keep ${group} together`}
                checked={plan.keep_relationship_groups_together?.includes(
                  group,
                )}
                onChange={(event) =>
                  onChange((draft) => {
                    const selected = new Set(
                      draft.keep_relationship_groups_together ?? [],
                    );
                    if (event.target.checked) selected.add(group);
                    else selected.delete(group);
                    draft.keep_relationship_groups_together = [...selected];
                  })
                }
              />{" "}
              Keep {group} together
            </label>
            <select
              className="editor-select"
              aria-label={`${group} preferred table`}
              value={
                plan.relationship_group_table_preferences?.[group]?.[0] ?? ""
              }
              onChange={(event) =>
                onChange((draft) => {
                  draft.relationship_group_table_preferences ??= {};
                  draft.relationship_group_table_preferences[group] = event
                    .target.value
                    ? [event.target.value]
                    : [];
                })
              }
            >
              <option value="">No table preference</option>
              {tableOptions.map((table) => (
                <option key={table.id} value={table.id}>
                  {table.name}
                </option>
              ))}
            </select>
          </div>
        ))}
        {roles.map((role) => (
          <div className="table-guest-row" key={role}>
            <span>{weddingRoleLabels[role]}</span>
            <select
              className="editor-select"
              aria-label={`${weddingRoleLabels[role]} preferred table`}
              value={plan.role_table_preferences?.[role]?.[0] ?? ""}
              onChange={(event) =>
                onChange((draft) => {
                  draft.role_table_preferences ??= {};
                  draft.role_table_preferences[role] = event.target.value
                    ? [event.target.value]
                    : [];
                })
              }
            >
              <option value="">No table preference</option>
              {tableOptions.map((table) => (
                <option key={table.id} value={table.id}>
                  {table.name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function SeatingLocks({
  state,
  allocation,
  plan,
  onUpdate,
}: Readonly<{
  state: WeddingPlanDraft;
  allocation: TableAllocation;
  plan: TablePlan;
  onUpdate: (change: (draft: WeddingPlanDraft) => void) => void;
}>) {
  const currentTable = new Map(
    allocation.tables.flatMap((table) =>
      table.guest_ids.map((guestId) => [guestId, table.id] as const),
    ),
  );
  const names = new Map(state.guests.map((guest) => [guest.id, guest.name]));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Manual assignments &amp; locks</CardTitle>
        <CardDescription>
          Move or lock guests, then recalculate. The optimizer changes only the
          remaining assignments.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {allocation.tables.map((table) => (
          <div className="table-guest-row" key={table.id}>
            <strong>{table.name}</strong>
            <Button
              size="sm"
              variant={table.locked ? "secondary" : "outline"}
              aria-pressed={table.locked}
              onClick={() =>
                onUpdate((draft) =>
                  setTableLock(draft, allocation, table.id, !table.locked),
                )
              }
            >
              <Lock size={14} /> {table.locked ? "Unlock table" : "Lock table"}
            </Button>
          </div>
        ))}
        <div className="table-guest-list">
          {[...currentTable].map(([guestId, assignedTable]) => {
            const lock = plan.locked_assignments?.[guestId];
            const tableId = lock?.table_id ?? assignedTable;
            const table = allocation.tables.find(
              (item) => item.id === tableId,
            )!;
            return (
              <div className="table-guest-row" key={guestId}>
                <strong>{names.get(guestId) ?? guestId}</strong>
                <select
                  className="editor-select"
                  aria-label={`${names.get(guestId) ?? guestId} assigned table`}
                  value={tableId}
                  onChange={(event) =>
                    onUpdate((draft) =>
                      lockGuestSeat(draft, guestId, event.target.value),
                    )
                  }
                >
                  {allocation.tables.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
                <select
                  className="editor-select"
                  aria-label={`${names.get(guestId) ?? guestId} assigned seat`}
                  value={lock?.seat_index ?? ""}
                  onChange={(event) =>
                    onUpdate((draft) =>
                      lockGuestSeat(
                        draft,
                        guestId,
                        tableId,
                        event.target.value === ""
                          ? undefined
                          : Number(event.target.value),
                      ),
                    )
                  }
                >
                  <option value="">Any seat</option>
                  {Array.from({ length: table.capacity }, (_, index) => (
                    <option key={index} value={index}>
                      Seat {index + 1}
                    </option>
                  ))}
                </select>
                {lock && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      onUpdate((draft) => unlockGuestSeat(draft, guestId))
                    }
                  >
                    Unlock
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

type SeatingExportKind = NonNullable<
  WeddingPlanDraft["readiness"]
>["seating_exports"][number]["kind"];
type SavedSeatingPlan = NonNullable<TablePlan["saved_plans"]>[number];

function markSeatingExportCurrent(
  onUpdate: (change: (draft: WeddingPlanDraft) => void) => void,
  chosen: SavedSeatingPlan | undefined,
  kind: SeatingExportKind,
) {
  if (!chosen) return;
  onUpdate((draft) => {
    draft.readiness ??= defaultWeddingReadinessPreferences();
    draft.readiness.seating_exports = [
      ...draft.readiness.seating_exports.filter((entry) => entry.kind !== kind),
      { kind, plan_id: chosen.id, exported_at: new Date().toISOString() },
    ];
  });
}

function downloadSeatingExport(
  kind: SeatingExportKind,
  plan: TablePlan,
  allocation: TableAllocation,
  guests: WeddingPlan["guests"],
) {
  if (kind === "venue") {
    downloadTextFile(
      "seating-assignments.csv",
      "text/csv;charset=utf-8",
      exportSeatingAssignmentsCsv(allocation, guests),
    );
  } else if (kind === "caterer") {
    downloadTextFile(
      "catering-summary.csv",
      "text/csv;charset=utf-8",
      exportCateringSummaryCsv(allocation, guests),
    );
  } else {
    downloadTextFile(
      "accessible-floor-plan.svg",
      "image/svg+xml",
      exportAccessibleFloorPlanSvg(plan, allocation),
    );
  }
}

const seatingExportLabels: Record<SeatingExportKind, string> = {
  venue: "Venue CSV",
  caterer: "Caterer CSV",
  floor_plan: "Floor plan SVG",
};

function SeatingExportButtons({
  plan,
  allocation,
  guests,
  chosen,
  onUpdate,
}: Readonly<{
  plan: TablePlan;
  allocation: TableAllocation;
  guests: WeddingPlan["guests"];
  chosen: SavedSeatingPlan | undefined;
  onUpdate: (change: (draft: WeddingPlanDraft) => void) => void;
}>) {
  return (["venue", "caterer", "floor_plan"] as const).map((kind) => (
    <Button
      key={kind}
      variant="outline"
      onClick={() => {
        downloadSeatingExport(kind, plan, allocation, guests);
        markSeatingExportCurrent(onUpdate, chosen, kind);
      }}
    >
      <Download size={14} /> {seatingExportLabels[kind]}
    </Button>
  ));
}

function SavedPlansAndExports({
  state,
  plan,
  allocation,
  onUpdate,
}: Readonly<{
  state: WeddingPlanDraft;
  plan: TablePlan;
  allocation: TableAllocation;
  onUpdate: (change: (draft: WeddingPlanDraft) => void) => void;
}>) {
  const [name, setName] = useState("");
  const eventPlans = plan.saved_plans?.filter(
    (savedPlan) => savedPlan.event_id === plan.event_id,
  );
  const chosen = eventPlans?.find(
    (savedPlan) => savedPlan.id === plan.chosen_plan_id,
  );
  const wedding = editorStateToPlan(state);
  const exportAllocation = chosen?.allocation ?? allocation;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Alternatives &amp; exports</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="room-map-toolbar">
          <Input
            aria-label="Saved seating plan name"
            placeholder="Dinner plan A"
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Button
            variant="outline"
            disabled={!name.trim()}
            onClick={() => {
              const savedName = name.trim();
              if (!savedName) return;
              onUpdate((draft) =>
                saveSeatingAlternative(draft, allocation, {
                  id: `plan-${Date.now().toString(36)}`,
                  name: savedName,
                  created_at: new Date().toISOString(),
                  ...(plan.event_id ? { event_id: plan.event_id } : {}),
                }),
              );
              setName("");
            }}
          >
            <Save size={14} /> Save alternative
          </Button>
          <SeatingExportButtons
            plan={plan}
            allocation={exportAllocation}
            guests={wedding.guests}
            chosen={chosen}
            onUpdate={onUpdate}
          />
        </div>
        {!!eventPlans?.length && (
          <div className="table-guest-list">
            {eventPlans.map((savedPlan) => {
              const comparison = chosen
                ? compareSeatingAlternatives(
                    chosen.allocation,
                    savedPlan.allocation,
                  )
                : null;
              return (
                <div className="table-guest-row" key={savedPlan.id}>
                  <div>
                    <strong>{savedPlan.name}</strong>
                    <small>
                      Score {savedPlan.allocation.score.earned}/
                      {savedPlan.allocation.score.possible}
                      {comparison
                        ? ` · ${comparison.moved_guest_ids.length} guests moved from chosen plan`
                        : ""}
                    </small>
                  </div>
                  <Button
                    size="sm"
                    variant={
                      savedPlan.id === plan.chosen_plan_id
                        ? "secondary"
                        : "outline"
                    }
                    onClick={() =>
                      onUpdate((draft) =>
                        chooseSeatingAlternative(draft, savedPlan.id),
                      )
                    }
                  >
                    {savedPlan.id === plan.chosen_plan_id
                      ? "Chosen plan"
                      : "Choose plan"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Delete ${savedPlan.name}`}
                    onClick={() =>
                      onUpdate((draft) =>
                        removeSeatingAlternative(draft, savedPlan.id),
                      )
                    }
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function conciseFactor(factor: string): string {
  const group = /^They share the (.+) relationship group$/.exec(factor)?.[1];
  if (group) return `${group} group`;
  if (factor === "They are in the same invitation party")
    return "Invitation party";
  if (factor === "They were marked as a must-sit pair")
    return "Preferred pairing";
  if (factor === "Placed here to balance table sizes")
    return "Balances table sizes";
  if (factor === "This assignment is locked") return "Locked assignment";
  return factor;
}

type PreferenceReviewItem = {
  key: string;
  title: string;
  detail: string;
  guestNames: string[];
  count: number;
};

function preferenceGroup(description: string): {
  key: string;
  title: string;
} | null {
  const relationshipGroup = /^They share the (.+) relationship group$/.exec(
    description,
  )?.[1];
  if (relationshipGroup)
    return {
      key: `relationship:${relationshipGroup}`,
      title: `${relationshipGroup} group`,
    };
  const tableChoice = /^Preferred table for the (.+) (group|role)$/.exec(
    description,
  );
  if (!tableChoice) return null;
  return {
    key: `table:${tableChoice[1]}:${tableChoice[2]}`,
    title: `${tableChoice[1]} ${tableChoice[2]} table choice`,
  };
}

function preferenceReviewItems(
  allocation: TableAllocation,
  names: Map<string, string>,
): PreferenceReviewItem[] {
  const grouped = new Map<
    string,
    { title: string; guestIds: Set<string>; count: number }
  >();
  const individual: PreferenceReviewItem[] = [];
  for (const preference of allocation.unsatisfied_preferences) {
    const group = preferenceGroup(preference.description);
    if (group) {
      const item = grouped.get(group.key) ?? {
        title: group.title,
        guestIds: new Set<string>(),
        count: 0,
      };
      for (const guestId of preference.guest_ids) item.guestIds.add(guestId);
      item.count += 1;
      grouped.set(group.key, item);
      continue;
    }
    const guestNames = preference.guest_ids.map(
      (guestId) => names.get(guestId) ?? guestId,
    );
    individual.push({
      key: `${preference.guest_ids.join(":")}:${preference.description}`,
      title: guestNames.join(" & "),
      detail: conciseFactor(preference.description),
      guestNames: [],
      count: 1,
    });
  }
  return [
    ...[...grouped.entries()].map(([key, item]) => ({
      key,
      title: item.title,
      detail: `${item.count} preferences across ${item.guestIds.size} guests`,
      guestNames: [...item.guestIds]
        .map((guestId) => names.get(guestId) ?? guestId)
        .sort((first, second) => first.localeCompare(second)),
      count: item.count,
    })),
    ...individual,
  ].sort((first, second) =>
    second.count === first.count
      ? first.title.localeCompare(second.title)
      : second.count - first.count,
  );
}

function TableSeatList({
  table,
  names,
  explanations,
}: Readonly<{
  table: TableAllocation["tables"][number];
  names: Map<string, string>;
  explanations: TableAllocation["explanations"];
}>) {
  const explanationByGuest = new Map(
    explanations.map((explanation) => [explanation.guest_id, explanation]),
  );
  return (
    <ul className="table-seat-list">
      {table.fixed_guests.map((name) => (
        <li key={`${table.id}:host:${name}`}>
          <span className="table-seat-number">Host</span>
          <strong>{name}</strong>
        </li>
      ))}
      {table.guest_ids.map((guestId) => (
        <li key={guestId}>
          <span className="table-seat-number">
            Seat {(explanationByGuest.get(guestId)?.seat_index ?? 0) + 1}
          </span>
          <strong>{names.get(guestId) ?? guestId}</strong>
        </li>
      ))}
    </ul>
  );
}

function TableExplanations({
  explanations,
  names,
}: Readonly<{
  explanations: TableAllocation["explanations"];
  names: Map<string, string>;
}>) {
  if (!explanations.length) return null;
  return (
    <details className="table-explanations">
      <summary>Why these seats</summary>
      <div className="table-explanation-list">
        {explanations.map((explanation) => (
          <article key={explanation.guest_id}>
            <strong>
              {names.get(explanation.guest_id) ?? explanation.guest_id}
            </strong>
            <small>Seat {explanation.seat_index + 1}</small>
            <ul>
              {explanation.factors.map((factor) => (
                <li key={factor}>{conciseFactor(factor)}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </details>
  );
}

function TableResultCard({
  table,
  names,
  plan,
  explanations,
}: Readonly<{
  table: TableAllocation["tables"][number];
  names: Map<string, string>;
  plan: TablePlan;
  explanations: TableAllocation["explanations"];
}>) {
  const tableName =
    plan.table_layout?.[table.id]?.name?.trim() ||
    (table.id === "top" ? "Top table" : `Table ${table.id.slice(6)}`);
  return (
    <Card className={table.id === "top" ? "table-result-top" : ""}>
      <CardHeader>
        <CardTitle>{tableName}</CardTitle>
        <CardDescription>
          {table.guest_ids.length + table.fixed_guests.length} /{" "}
          {table.capacity}
          {table.id === "top" ? " seats · Wedding party" : " seats"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <TableSeatList
          table={table}
          names={names}
          explanations={explanations}
        />
        {!table.guest_ids.length && !table.fixed_guests.length && (
          <p className="editor-hint">Empty table</p>
        )}
        <TableExplanations explanations={explanations} names={names} />
      </CardContent>
    </Card>
  );
}

function PreferencesToReview({
  items,
}: Readonly<{ items: PreferenceReviewItem[] }>) {
  if (!items.length) return null;
  const preferenceCount = items.reduce((total, item) => total + item.count, 0);
  return (
    <details className="table-review-panel">
      <summary>
        <span>
          <strong>Preferences to review</strong>
          <small>Open only if you want to tune the next calculation.</small>
        </span>
        <span>{preferenceCount}</span>
      </summary>
      <ul className="table-review-list">
        {items.map((item) => (
          <li key={item.key}>
            <div>
              <strong>{item.title}</strong>
              <span>{item.detail}</span>
              {item.guestNames.length > 0 && (
                <small>{item.guestNames.join(", ")}</small>
              )}
            </div>
            <span>
              {item.count} {item.count === 1 ? "preference" : "preferences"}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function TableResults({
  allocation,
  guests,
  plan,
}: Readonly<{
  allocation: TableAllocation;
  guests: Guest[];
  plan: TablePlan;
}>) {
  const names = new Map(guests.map((guest) => [guest.id, guest.name]));
  const reviewItems = preferenceReviewItems(allocation, names);
  const preferenceCount = reviewItems.reduce(
    (total, item) => total + item.count,
    0,
  );
  return (
    <section aria-label="Calculated table plan" className="table-results">
      <h3>
        {allocation.status === "provisional"
          ? "Your provisional table plan"
          : "Your table plan"}
      </h3>
      <div className="table-result-summary">
        <div>
          <strong>
            {allocation.score.earned} / {allocation.score.possible}
          </strong>
          <span>Preference score</span>
        </div>
        <div>
          <strong>
            {allocation.preferences_met} / {allocation.preferences_total}
          </strong>
          <span>Preferred pairs together</span>
        </div>
        <div>
          <strong>{preferenceCount}</strong>
          <span>Preferences to review</span>
        </div>
      </div>
      <p className="editor-hint table-rules-note">
        Capacity, hard grouping, keep-apart, accessibility, and high-chair rules
        are all satisfied.
      </p>
      {allocation.warnings.length > 0 && (
        <div className="editor-warning">
          {allocation.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      )}
      <div className="table-result-grid">
        {allocation.tables.map((table) => (
          <TableResultCard
            key={table.id}
            table={table}
            names={names}
            plan={plan}
            explanations={allocation.explanations.filter(
              (explanation) => explanation.table_id === table.id,
            )}
          />
        ))}
      </div>
      <PreferencesToReview items={reviewItems} />
    </section>
  );
}

function TablePlanInputs({
  state,
  plan,
  onUpdate,
}: Readonly<{
  state: WeddingPlanDraft;
  plan: TablePlan;
  onUpdate: PlanUpdate;
}>) {
  return (
    <>
      <div className="table-setup-grid">
        <TableSetup
          plan={plan}
          onChange={(change) =>
            onUpdate((draft) => {
              draft.table_plan = getTablePlan(draft);
              change(draft.table_plan);
            })
          }
        />
        <TableGuestList state={state} plan={plan} onUpdate={onUpdate} />
      </div>
      <details className="table-optional-settings">
        <summary>
          <span>
            <strong>Add rules or pair preferences</strong>
            <small>
              Optional. Use this for groups that must stay together, table
              choices, or guests who should sit together or apart.
            </small>
          </span>
        </summary>
        <div className="table-workflow-content">
          <ConstraintSetup state={state} plan={plan} onUpdate={onUpdate} />
          <TablePreferences state={state} onUpdate={onUpdate} />
        </div>
      </details>
    </>
  );
}

function WorkflowSection({
  title,
  description,
  children,
}: Readonly<{
  title: string;
  description: string;
  children: ReactNode;
}>) {
  return (
    <details className="table-workflow-step" name="table-workflow">
      <summary>
        <span>
          <strong>{title}</strong>
          <small>{description}</small>
        </span>
      </summary>
      <div className="table-workflow-content">{children}</div>
    </details>
  );
}

function TableFollowUp({
  state,
  allocation,
  plan,
  onInputUpdate,
  onPlanUpdate,
}: Readonly<{
  state: WeddingPlanDraft;
  allocation: TableAllocation;
  plan: TablePlan;
  onInputUpdate: PlanUpdate;
  onPlanUpdate: PlanUpdate;
}>) {
  return (
    <section
      className="table-follow-up"
      aria-labelledby="table-follow-up-title"
    >
      <div className="table-workflow-heading">
        <h3 id="table-follow-up-title">What do you want to change?</h3>
        <p>
          Review the plan above first. Open one area only when you have a
          specific change to make.
        </p>
      </div>
      <WorkflowSection
        title="Change the calculation"
        description="Use for table sizes, attendance, the top table, rules or pair preferences. Calculate again when finished."
      >
        <TablePlanInputs state={state} plan={plan} onUpdate={onInputUpdate} />
      </WorkflowSection>
      <WorkflowSection
        title="Move or lock guests"
        description="Use after the groups look right, when particular guests need a fixed table or seat."
      >
        <SeatingLocks
          state={state}
          allocation={allocation}
          plan={plan}
          onUpdate={onPlanUpdate}
        />
      </WorkflowSection>
      <WorkflowSection
        title="Save or send the plan"
        description="Use when this version is ready to compare, give to the venue or pass to the caterer."
      >
        <SavedPlansAndExports
          state={state}
          plan={plan}
          allocation={allocation}
          onUpdate={onPlanUpdate}
        />
      </WorkflowSection>
    </section>
  );
}

function TablePreparation({
  state,
  plan,
  onUpdate,
}: Readonly<{
  state: WeddingPlanDraft;
  plan: TablePlan;
  onUpdate: PlanUpdate;
}>) {
  return (
    <section className="table-preparation" aria-labelledby="table-setup-title">
      <div className="table-workflow-heading">
        <h3 id="table-setup-title">Set up the calculation</h3>
        <p>
          Start with table sizes and attendance. Add rules only for choices the
          calculator should not make on its own.
        </p>
      </div>
      <TablePlanInputs state={state} plan={plan} onUpdate={onUpdate} />
    </section>
  );
}

export function TableEditor({
  state,
  allocation,
  busy,
  onUpdate,
  onCalculate,
  onLayoutUpdate,
}: Readonly<{
  state: WeddingPlanDraft;
  allocation: TableAllocation | null;
  busy: boolean;
  onUpdate: (change: (draft: WeddingPlanDraft) => void) => void;
  onCalculate: () => void;
  onLayoutUpdate: (change: (draft: WeddingPlanDraft) => void) => void;
}>) {
  const plan = getTablePlan(state);
  const attending = state.guests.filter(
    (guest) => guest.attendance === "yes",
  ).length;
  const unknown = state.guests.filter(
    (guest) => !guest.attendance || guest.attendance === "unknown",
  ).length;
  let calculateLabel = "Calculate tables";
  if (busy) calculateLabel = "Calculating tables…";
  else if (allocation) calculateLabel = "Recalculate tables";
  return (
    <>
      <div className="page-heading">
        <div>
          <h2>Tables</h2>
        </div>
        <Button onClick={onCalculate} disabled={busy}>
          {calculateLabel} <ArrowRight size={16} />
        </Button>
      </div>
      <div className="progress-strip">
        <span>
          <strong>{attending}</strong> attending guests
        </span>
        <span>
          <strong>{unknown}</strong> undecided
        </span>
        <span>
          <strong>
            {plan.top_table_guest_ids.length + (state.hosts?.length ?? 2)}
          </strong>{" "}
          at top table
        </span>
        <span>
          <strong>
            {plan.table_capacities.reduce((total, seats) => total + seats, 0)}
          </strong>{" "}
          other seats
        </span>
      </div>
      {!allocation && (
        <TablePreparation state={state} plan={plan} onUpdate={onUpdate} />
      )}
      <TableRoomMap
        state={state}
        allocation={allocation}
        onUpdate={onLayoutUpdate}
      />
      {allocation && (
        <>
          <TableResults
            allocation={allocation}
            guests={state.guests}
            plan={plan}
          />
          <TableFollowUp
            state={state}
            allocation={allocation}
            plan={plan}
            onInputUpdate={onUpdate}
            onPlanUpdate={onLayoutUpdate}
          />
        </>
      )}
    </>
  );
}
