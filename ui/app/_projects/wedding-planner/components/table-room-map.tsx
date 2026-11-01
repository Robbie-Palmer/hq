"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import {
  type TableAppearance,
  tableAppearance,
} from "@/app/_projects/wedding-planner/application/room-layout";
import { getTablePlan } from "@/app/_projects/wedding-planner/application/table-state";
import type {
  TableAllocation,
  TablePlan,
  WeddingPlanDraft,
} from "@/app/_projects/wedding-planner/application/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  RoomTableSelector,
  SelectedTableGuests,
  TableMapToolbar,
  VenueElementEditor,
} from "./table-room-map-controls";

const RoomCanvas = dynamic(() => import("./table-room-canvas"), {
  ssr: false,
  loading: () => <p className="editor-hint">Loading room map…</p>,
});

function tableOptions(plan: TablePlan) {
  return [
    { id: "top", capacity: plan.top_table_capacity },
    ...plan.table_capacities.map((capacity, index) => ({
      id: `table-${index + 1}`,
      capacity,
    })),
  ];
}

export function TableRoomMap({
  state,
  allocation,
  onUpdate,
}: Readonly<{
  state: WeddingPlanDraft;
  allocation: TableAllocation | null;
  onUpdate: (change: (draft: WeddingPlanDraft) => void) => void;
}>) {
  const plan = getTablePlan(state);
  const tables = tableOptions(plan);
  const [selectedId, setSelectedId] = useState("top");
  const selected =
    tables.find((table) => table.id === selectedId) ?? tables[0]!;
  const index = Math.max(
    0,
    tables.findIndex((table) => table.id === selected.id),
  );
  const appearance = tableAppearance(plan, selected.id, index);
  const height = Math.max(
    600,
    220 + Math.ceil(plan.table_capacities.length / 3) * 230,
  );
  const guestNames = new Map(
    state.guests.map((guest) => [guest.id, guest.name]),
  );
  const occupants = (id: string) => {
    const table = allocation?.tables.find((item) => item.id === id);
    return table
      ? [
          ...table.fixed_guests,
          ...table.guest_ids.map(
            (guestId) => guestNames.get(guestId) ?? guestId,
          ),
        ]
      : [];
  };
  const change = (id: string, patch: Partial<TableAppearance>) =>
    onUpdate((draft) => {
      draft.table_plan = getTablePlan(draft);
      draft.table_plan.table_layout ??= {};
      draft.table_plan.table_layout[id] = {
        ...draft.table_plan.table_layout[id],
        ...patch,
      };
    });
  const changeElement = (
    id: string,
    patch: Partial<NonNullable<TablePlan["venue_elements"]>[number]>,
  ) =>
    onUpdate((draft) => {
      const element = getTablePlan(draft).venue_elements?.find(
        (item) => item.id === id,
      );
      if (element) Object.assign(element, patch);
    });
  const reset = () =>
    onUpdate((draft) => {
      for (const item of Object.values(
        getTablePlan(draft).table_layout ?? {},
      )) {
        delete item.x;
        delete item.y;
        delete item.rotation;
      }
    });
  return (
    <Card className="table-room-card">
      <CardHeader>
        <CardTitle>Room map</CardTitle>
      </CardHeader>
      <CardContent>
        <TableMapToolbar
          tables={tables}
          selected={selected}
          appearance={appearance}
          plan={plan}
          onSelect={setSelectedId}
          onChange={(patch) => change(selected.id, patch)}
          onReset={reset}
        />
        <VenueElementEditor
          elements={plan.venue_elements ?? []}
          roomHeight={height}
          onAdd={(name, kind) =>
            onUpdate((draft) => {
              draft.table_plan = getTablePlan(draft);
              draft.table_plan.venue_elements ??= [];
              draft.table_plan.venue_elements.push({
                id: `element-${Date.now().toString(36)}`,
                name,
                kind,
                x: 500,
                y: 250,
                width: kind === "dance_floor" ? 260 : 140,
                height: kind === "dance_floor" ? 140 : 70,
                rotation: 0,
              });
            })
          }
          onChange={changeElement}
          onRemove={(id) =>
            onUpdate((draft) => {
              draft.table_plan = getTablePlan(draft);
              draft.table_plan.venue_elements =
                draft.table_plan.venue_elements?.filter(
                  (item) => item.id !== id,
                );
            })
          }
        />
        <RoomCanvas
          tables={tables.map((table, tableIndex) => ({
            ...table,
            appearance: tableAppearance(plan, table.id, tableIndex),
            occupants: occupants(table.id),
          }))}
          height={height}
          venueElements={plan.venue_elements}
          selectedId={selected.id}
          onSelect={setSelectedId}
          onChange={change}
        />
        <RoomTableSelector
          tables={tables}
          plan={plan}
          selectedId={selected.id}
          height={height}
          occupants={occupants}
          onSelect={setSelectedId}
          onChange={change}
        />
        <SelectedTableGuests
          name={
            appearance.name.trim() ||
            (index === 0 ? "Top table" : `Table ${index}`)
          }
          occupants={occupants(selected.id)}
          calculated={Boolean(allocation)}
        />
      </CardContent>
    </Card>
  );
}
