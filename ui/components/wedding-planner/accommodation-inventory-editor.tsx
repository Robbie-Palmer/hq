"use client";

import type { WeddingPlanDraft } from "@/lib/wedding-planner/types";
import { AssignmentEditor } from "./accommodation-inventory-assignments";
import {
  GuestNeedsEditor,
  HouseholdNeedsEditor,
} from "./accommodation-inventory-needs";
import { AccommodationPropertiesEditor } from "./accommodation-inventory-properties";
import { AccommodationReport } from "./accommodation-inventory-report";
import type { AccommodationUpdate } from "./accommodation-inventory-shared";

export function AccommodationInventoryEditor({
  state,
  onUpdate,
}: Readonly<{
  state: WeddingPlanDraft;
  onUpdate: AccommodationUpdate;
}>) {
  return (
    <>
      <div className="page-heading">
        <div>
          <h2>Accommodation inventory</h2>
          <p className="editor-hint">
            Track real properties, rooms, beds, stay dates and booking records.
          </p>
        </div>
      </div>
      <div className="inventory-layout">
        <div className="inventory-main">
          <AccommodationPropertiesEditor state={state} update={onUpdate} />
        </div>
        <aside className="inventory-side">
          <AccommodationReport state={state} />
          <AssignmentEditor state={state} update={onUpdate} />
          <GuestNeedsEditor state={state} update={onUpdate} />
          <HouseholdNeedsEditor state={state} update={onUpdate} />
        </aside>
      </div>
    </>
  );
}
