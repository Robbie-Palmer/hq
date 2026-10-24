"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  roomPosition,
  type TableAppearance,
  tableAppearance,
} from "@/lib/wedding-planner/room-layout";
import type { TablePlan } from "@/lib/wedding-planner/types";

export type RoomTableOption = { id: string; capacity: number };

function indexList(value: string, capacity: number) {
  return value
    .split(",")
    .map((item) => Number(item.trim()) - 1)
    .filter((item) => Number.isInteger(item) && item >= 0 && item < capacity);
}

function SeatFeatureFields({
  appearance,
  capacity,
  onChange,
}: Readonly<{
  appearance: TableAppearance;
  capacity: number;
  onChange: (patch: Partial<TableAppearance>) => void;
}>) {
  const accessibleId = useId();
  const highChairId = useId();
  const field = (
    id: string,
    label: string,
    indexes: number[],
    key: "accessible_seat_indexes" | "high_chair_seat_indexes",
  ) => (
    <label className="editor-field" htmlFor={id}>
      <span className="editor-label">{label}</span>
      <Input
        id={id}
        aria-label={label}
        placeholder={key === "accessible_seat_indexes" ? "1, 2" : "8"}
        value={indexes.map((seat) => seat + 1).join(", ")}
        onChange={(event) =>
          onChange({ [key]: indexList(event.target.value, capacity) })
        }
      />
    </label>
  );
  return (
    <>
      {field(
        accessibleId,
        "Accessible seat numbers",
        appearance.accessible_seat_indexes,
        "accessible_seat_indexes",
      )}
      {field(
        highChairId,
        "High-chair seat numbers",
        appearance.high_chair_seat_indexes,
        "high_chair_seat_indexes",
      )}
    </>
  );
}

function TableNameAndShape({
  appearance,
  onChange,
}: Readonly<{
  appearance: TableAppearance;
  onChange: (patch: Partial<TableAppearance>) => void;
}>) {
  const nameId = useId();
  return (
    <>
      <label className="editor-field" htmlFor={nameId}>
        <span className="editor-label">Table name</span>
        <Input
          id={nameId}
          aria-label="Table name"
          maxLength={80}
          value={appearance.name}
          onChange={(event) => onChange({ name: event.target.value })}
        />
      </label>
      <label className="editor-field">
        <span className="editor-label">Table shape</span>
        <select
          className="editor-select"
          aria-label="Table shape"
          value={appearance.shape}
          onChange={(event) =>
            onChange({ shape: event.target.value as "round" | "long" })
          }
        >
          <option value="round">Round</option>
          <option value="long">Long</option>
        </select>
      </label>
    </>
  );
}

function TableIdentityFields({
  tables,
  selected,
  appearance,
  plan,
  onSelect,
  onChange,
}: Readonly<{
  tables: RoomTableOption[];
  selected: RoomTableOption;
  appearance: TableAppearance;
  plan: TablePlan;
  onSelect: (id: string) => void;
  onChange: (patch: Partial<TableAppearance>) => void;
}>) {
  return (
    <>
      <label className="editor-field">
        <span className="editor-label">Table</span>
        <select
          className="editor-select"
          aria-label="Edit table"
          value={selected.id}
          onChange={(event) => onSelect(event.target.value)}
        >
          {tables.map((table, index) => (
            <option key={table.id} value={table.id}>
              {tableAppearance(plan, table.id, index).name.trim() ||
                (index === 0 ? "Top table" : `Table ${index}`)}
            </option>
          ))}
        </select>
      </label>
      <TableNameAndShape appearance={appearance} onChange={onChange} />
    </>
  );
}

export function TableMapToolbar({
  tables,
  selected,
  appearance,
  plan,
  onSelect,
  onChange,
  onReset,
}: Readonly<{
  tables: RoomTableOption[];
  selected: RoomTableOption;
  appearance: TableAppearance;
  plan: TablePlan;
  onSelect: (id: string) => void;
  onChange: (patch: Partial<TableAppearance>) => void;
  onReset: () => void;
}>) {
  return (
    <div className="room-map-toolbar">
      <TableIdentityFields
        {...{ tables, selected, appearance, plan, onSelect, onChange }}
      />
      <SeatFeatureFields
        appearance={appearance}
        capacity={selected.capacity}
        onChange={onChange}
      />
      <Button
        variant="outline"
        onClick={() => onChange({ rotation: (appearance.rotation + 90) % 360 })}
      >
        Rotate table
      </Button>
      <Button variant="outline" onClick={onReset}>
        Reset positions
      </Button>
    </div>
  );
}

function VenueElementRow({
  element,
  roomHeight,
  onChange,
  onRemove,
}: Readonly<{
  element: NonNullable<TablePlan["venue_elements"]>[number];
  roomHeight: number;
  onChange: (patch: Partial<typeof element>) => void;
  onRemove: () => void;
}>) {
  const fields = [
    ["x", "Horizontal position", 0, 1000],
    ["y", "Vertical position", 0, roomHeight],
    ["width", "Width", 1, 1000],
    ["height", "Height", 1, roomHeight],
  ] as const;
  return (
    <li>
      <span>{element.name}</span>
      {fields.map(([field, label, min, max]) => (
        <Input
          key={field}
          className="w-24"
          type="number"
          min={min}
          max={max}
          aria-label={`${element.name} ${label}`}
          value={element[field]}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value) && value >= min && value <= max)
              onChange({ [field]: value });
          }}
        />
      ))}
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Remove ${element.name}`}
        onClick={onRemove}
      >
        Remove
      </Button>
    </li>
  );
}

type VenueKind = NonNullable<TablePlan["venue_elements"]>[number]["kind"];

function VenueElementForm({
  onAdd,
}: Readonly<{ onAdd: (name: string, kind: VenueKind) => void }>) {
  const nameId = useId();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<VenueKind>("dance_floor");
  const kinds: VenueKind[] = [
    "dance_floor",
    "stage",
    "bar",
    "door",
    "pillar",
    "other",
  ];
  return (
    <div className="room-map-toolbar">
      <label className="editor-field" htmlFor={nameId}>
        <span className="editor-label">Fixed venue element</span>
        <Input
          id={nameId}
          aria-label="Fixed venue element name"
          placeholder="Dance floor"
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="editor-field">
        <span className="editor-label">Element type</span>
        <select
          className="editor-select"
          aria-label="Fixed venue element type"
          value={kind}
          onChange={(event) => setKind(event.target.value as VenueKind)}
        >
          {kinds.map((value) => (
            <option key={value} value={value}>
              {value.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </label>
      <Button
        variant="outline"
        disabled={!name.trim()}
        onClick={() => {
          onAdd(name.trim(), kind);
          setName("");
        }}
      >
        Add fixed element
      </Button>
    </div>
  );
}

export function VenueElementEditor({
  elements,
  roomHeight,
  onAdd,
  onChange,
  onRemove,
}: Readonly<{
  elements: NonNullable<TablePlan["venue_elements"]>;
  roomHeight: number;
  onAdd: (
    name: string,
    kind: NonNullable<TablePlan["venue_elements"]>[number]["kind"],
  ) => void;
  onChange: (
    id: string,
    patch: Partial<NonNullable<TablePlan["venue_elements"]>[number]>,
  ) => void;
  onRemove: (id: string) => void;
}>) {
  return (
    <>
      <VenueElementForm onAdd={onAdd} />
      {!!elements.length && (
        <ul className="table-seat-list" aria-label="Fixed venue elements">
          {elements.map((element) => (
            <VenueElementRow
              key={element.id}
              element={element}
              roomHeight={roomHeight}
              onChange={(patch) => onChange(element.id, patch)}
              onRemove={() => onRemove(element.id)}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function RoomTableButton({
  table,
  index,
  plan,
  selected,
  height,
  occupants,
  onSelect,
  onChange,
}: Readonly<{
  table: RoomTableOption;
  index: number;
  plan: TablePlan;
  selected: boolean;
  height: number;
  occupants: string[];
  onSelect: () => void;
  onChange: (patch: Partial<TableAppearance>) => void;
}>) {
  const saved = tableAppearance(plan, table.id, index);
  const name =
    saved.name.trim() || (index === 0 ? "Top table" : `Table ${index}`);
  return (
    <Button
      variant={selected ? "secondary" : "outline"}
      aria-label={`${name}, ${occupants.length} of ${table.capacity} seats. Use arrow keys to move.`}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 50 : 10;
        const delta = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
        }[event.key];
        if (!delta) return;
        event.preventDefault();
        onSelect();
        onChange(
          roomPosition(
            saved.x + (delta[0] ?? 0),
            saved.y + (delta[1] ?? 0),
            height,
          ),
        );
      }}
    >
      {name}
    </Button>
  );
}

export function RoomTableSelector({
  tables,
  plan,
  selectedId,
  height,
  occupants,
  onSelect,
  onChange,
}: Readonly<{
  tables: RoomTableOption[];
  plan: TablePlan;
  selectedId: string;
  height: number;
  occupants: (id: string) => string[];
  onSelect: (id: string) => void;
  onChange: (id: string, patch: Partial<TableAppearance>) => void;
}>) {
  return (
    <section
      className="room-map-table-list"
      aria-label="Select and move tables"
    >
      {tables.map((table, index) => (
        <RoomTableButton
          key={table.id}
          table={table}
          index={index}
          plan={plan}
          selected={selectedId === table.id}
          height={height}
          occupants={occupants(table.id)}
          onSelect={() => onSelect(table.id)}
          onChange={(patch) => onChange(table.id, patch)}
        />
      ))}
    </section>
  );
}

export function SelectedTableGuests({
  name,
  occupants,
  calculated,
}: Readonly<{ name: string; occupants: string[]; calculated: boolean }>) {
  return (
    <div className="room-map-guests" aria-live="polite">
      <strong>{name}</strong>
      <p>
        {calculated
          ? occupants.join(", ") || "No guests seated at this table."
          : "Calculate tables to see who sits here. Filled icons represent seated guests; outlined icons are empty seats."}
      </p>
    </div>
  );
}
