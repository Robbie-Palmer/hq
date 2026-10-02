"use client";

import { ArrowRight, Users } from "lucide-react";
import { useId, useState } from "react";
import { weddingRolesLabel } from "wedding-planner-domain";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  acceptAccommodationSeatingSuggestions,
  accommodationSeatingSuggestions,
  getTablePlan,
  seatAttendingWeddingParty,
  setAttendance,
  setTablePairDecision,
  setTopTableGuest,
  tablePairDecision,
} from "@/lib/wedding-planner/table-state";
import type {
  Guest,
  State,
  TableAllocation,
  TablePlan,
} from "@/lib/wedding-planner/types";

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
        <CardDescription>
          Capacities include every person at the table, including the hosts and
          selected wedding party at the top table.
        </CardDescription>
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

function TableGuestList({
  state,
  plan,
  onUpdate,
}: Readonly<{
  state: State;
  plan: TablePlan;
  onUpdate: (change: (draft: State) => void) => void;
}>) {
  const [search, setSearch] = useState("");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Attendance &amp; top table</CardTitle>
        <CardDescription>
          Confirm wedding attendance even for guests who are not staying
          overnight. Wedding roles are recorded in Guests. Choose who sits at
          the top table here.
        </CardDescription>
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
              <div className="table-guest-row" key={guest.id}>
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
                  onChange={(event) => {
                    const attendance = event.target.value as
                      | "yes"
                      | "no"
                      | "unknown";
                    onUpdate((draft) =>
                      setAttendance(draft, guest.id, attendance),
                    );
                  }}
                >
                  <option value="unknown">Undecided</option>
                  <option value="yes">Attending</option>
                  <option value="no">Not attending</option>
                </select>
                <label className="table-top-choice">
                  <input
                    type="checkbox"
                    checked={plan.top_table_guest_ids.includes(guest.id)}
                    disabled={guest.attendance !== "yes"}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      onUpdate((draft) =>
                        setTopTableGuest(draft, guest.id, checked),
                      );
                    }}
                    aria-label={`${guest.name} at top table`}
                  />{" "}
                  Top table
                </label>
              </div>
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
  state: State;
  onUpdate: (change: (draft: State) => void) => void;
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
        <CardTitle>Who would they like to sit with?</CardTitle>
        <CardDescription>
          Love to sit together is a preference. Keep apart is a firm rule.
          Choices work both ways and apply when both guests attend. Confirmed
          couples recorded in Guests stay together unless one is at the top
          table.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="editor-hint">
          Explicit room and cottage sharing choices suggest who might like to
          sit together. Review and accept them here. No preference dismisses a
          suggestion for that pair. General willingness to share adds no
          suggestions.
        </p>
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

function TableResults({
  allocation,
  guests,
}: Readonly<{ allocation: TableAllocation; guests: Guest[] }>) {
  const names = new Map(guests.map((guest) => [guest.id, guest.name]));
  return (
    <section aria-label="Calculated table plan" className="table-results">
      <h3>
        {allocation.status === "provisional"
          ? "Your provisional table plan"
          : "Your table plan"}
      </h3>
      <p className="editor-hint">
        {allocation.preferences_met} of {allocation.preferences_total} preferred
        pairs together. Couples and keep-apart rules respected. Table sizes
        balanced after preferences.
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
          <Card
            key={table.id}
            className={table.id === "top" ? "table-result-top" : ""}
          >
            <CardHeader>
              <CardTitle>{table.name}</CardTitle>
              <CardDescription>
                {table.guest_ids.length + table.fixed_guests.length} /{" "}
                {table.capacity} seats
                {table.id === "top" ? " · Fixed wedding party" : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="table-seat-list">
                {[
                  ...table.fixed_guests.map((name, position) => ({
                    id: `host-${position}`,
                    name,
                  })),
                  ...table.guest_ids.map((id) => ({
                    id: `guest-${id}`,
                    name: names.get(id) ?? id,
                  })),
                ].map(({ id, name }) => (
                  <li key={id}>
                    <Users size={14} />
                    {name}
                  </li>
                ))}
              </ul>
              {!table.guest_ids.length && !table.fixed_guests.length && (
                <p className="editor-hint">Empty table</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      {allocation.unmet_preferences.length > 0 && (
        <div className="editor-warning">
          <p>
            These preferred pairs could not share a table within the current
            rules:
          </p>
          <ul>
            {allocation.unmet_preferences.map(([first, second]) => (
              <li key={`${first}:${second}`}>
                {names.get(first)} &amp; {names.get(second)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function TableEditor({
  state,
  allocation,
  busy,
  onUpdate,
  onCalculate,
}: Readonly<{
  state: State;
  allocation: TableAllocation | null;
  busy: boolean;
  onUpdate: (change: (draft: State) => void) => void;
  onCalculate: () => void;
}>) {
  const plan = getTablePlan(state);
  const attending = state.guests.filter(
    (guest) => guest.attendance === "yes",
  ).length;
  const unknown = state.guests.filter(
    (guest) => !guest.attendance || guest.attendance === "unknown",
  ).length;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">TABLE PLAN</span>
          <h2>A place at the table.</h2>
          <p>
            Set the wedding party, choose table sizes, then calculate who sits
            together.
          </p>
        </div>
        <Button onClick={onCalculate} disabled={busy}>
          {busy ? "Calculating tables…" : "Calculate tables"}{" "}
          <ArrowRight size={16} />
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
      {allocation && (
        <TableResults allocation={allocation} guests={state.guests} />
      )}
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
      <TablePreferences state={state} onUpdate={onUpdate} />
    </>
  );
}
