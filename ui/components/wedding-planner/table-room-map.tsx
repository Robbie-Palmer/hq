"use client";

import dynamic from "next/dynamic";
import { useId, useState } from "react";
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
  roomPosition,
  tableAppearance,
} from "@/lib/wedding-planner/room-layout";
import { getTablePlan } from "@/lib/wedding-planner/table-state";
import type {
  State,
  TableAllocation,
  TablePlan,
} from "@/lib/wedding-planner/types";

type Appearance = NonNullable<TablePlan["table_layout"]>[string];

const RoomCanvas = dynamic(() => import("./table-room-canvas"), {
  ssr: false,
  loading: () => <p className="editor-hint">Loading room map…</p>,
});

export function TableRoomMap({
  state,
  allocation,
  onUpdate,
}: Readonly<{
  state: State;
  allocation: TableAllocation | null;
  onUpdate: (change: (draft: State) => void) => void;
}>) {
  const nameId = useId();
  const plan = getTablePlan(state);
  const tables = [
    { id: "top", capacity: plan.top_table_capacity },
    ...plan.table_capacities.map((capacity, index) => ({
      id: `table-${index + 1}`,
      capacity,
    })),
  ];
  const [selectedId, setSelectedId] = useState("top");
  const selected = tables.find((table) => table.id === selectedId) ?? {
    id: "top",
    capacity: plan.top_table_capacity,
  };
  const index = Math.max(
    0,
    tables.findIndex((table) => table.id === selected.id),
  );
  const appearance = tableAppearance(plan, selected.id, index);
  const height = Math.max(
    600,
    220 + Math.ceil(plan.table_capacities.length / 3) * 230,
  );
  function change(id: string, patch: Appearance) {
    onUpdate((draft) => {
      draft.table_plan = getTablePlan(draft);
      draft.table_plan.table_layout ??= {};
      draft.table_plan.table_layout[id] = {
        ...draft.table_plan.table_layout[id],
        ...patch,
      };
    });
  }
  const guestNames = new Map(
    state.guests.map((guest) => [guest.id, guest.name]),
  );
  function occupants(id: string) {
    const table = allocation?.tables.find((table) => table.id === id);
    return table
      ? [
          ...table.fixed_guests,
          ...table.guest_ids.map((id) => guestNames.get(id) ?? id),
        ]
      : [];
  }
  return (
    <Card className="table-room-card">
      <CardHeader>
        <CardTitle>Room map</CardTitle>
        <CardDescription>
          Drag tables into place, or select a table and use the arrow keys.
          Calculate tables to show seated guests. This is a sketch, not a scale
          floor plan. Long top tables have seats on one side, facing the room.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="room-map-toolbar">
          <label className="editor-field">
            <span className="editor-label">Table</span>
            <select
              className="editor-select"
              aria-label="Edit table"
              value={selected.id}
              onChange={(event) => setSelectedId(event.target.value)}
            >
              {tables.map((table, index) => (
                <option key={table.id} value={table.id}>
                  {tableAppearance(plan, table.id, index).name.trim() ||
                    (index === 0 ? "Top table" : `Table ${index}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="editor-field" htmlFor={nameId}>
            <span className="editor-label">Table name</span>
            <Input
              id={nameId}
              aria-label="Table name"
              maxLength={80}
              value={appearance.name}
              onChange={(event) =>
                change(selected.id, { name: event.target.value })
              }
            />
          </label>
          <label className="editor-field">
            <span className="editor-label">Table shape</span>
            <select
              className="editor-select"
              aria-label="Table shape"
              value={appearance.shape}
              onChange={(event) =>
                change(selected.id, {
                  shape: event.target.value as "round" | "long",
                })
              }
            >
              <option value="round">Round</option>
              <option value="long">Long</option>
            </select>
          </label>
          <Button
            variant="outline"
            onClick={() =>
              change(selected.id, {
                rotation: (appearance.rotation + 90) % 360,
              })
            }
          >
            Rotate table
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              onUpdate((draft) => {
                draft.table_plan = getTablePlan(draft);
                for (const item of Object.values(
                  draft.table_plan.table_layout ?? {},
                )) {
                  delete item.x;
                  delete item.y;
                  delete item.rotation;
                }
              })
            }
          >
            Reset positions
          </Button>
        </div>
        <RoomCanvas
          tables={tables.map((table, index) => ({
            ...table,
            appearance: tableAppearance(plan, table.id, index),
            occupants: occupants(table.id),
          }))}
          height={height}
          selectedId={selected.id}
          onSelect={setSelectedId}
          onChange={change}
        />
        <section
          className="room-map-table-list"
          aria-label="Select and move tables"
        >
          {tables.map((table, index) => {
            const saved = tableAppearance(plan, table.id, index);
            const name =
              saved.name.trim() ||
              (index === 0 ? "Top table" : `Table ${index}`);
            return (
              <Button
                key={table.id}
                variant={selected.id === table.id ? "secondary" : "outline"}
                aria-label={`${name}, ${occupants(table.id).length} of ${table.capacity} seats. Use arrow keys to move.`}
                aria-pressed={selected.id === table.id}
                onClick={() => setSelectedId(table.id)}
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
                  setSelectedId(table.id);
                  change(
                    table.id,
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
          })}
        </section>
        <div className="room-map-guests" aria-live="polite">
          <strong>
            {appearance.name.trim() ||
              (index === 0 ? "Top table" : `Table ${index}`)}
          </strong>
          <p>
            {allocation
              ? occupants(selected.id).join(", ") ||
                "No guests seated at this table."
              : "Calculate tables to see who sits here. Filled icons represent seated guests; outlined icons are empty seats."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
