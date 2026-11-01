"use client";

import { AlertTriangle, Download } from "lucide-react";
import { useMemo, useState } from "react";
import {
  auditAccommodationInventory,
  guestAccommodationItinerary,
} from "wedding-planner-domain/accommodation";
import { canonicalWeddingPlan } from "@/app/_projects/wedding-planner/application/queries";
import type { WeddingPlanDraft } from "@/app/_projects/wedding-planner/application/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { downloadJson } from "./accommodation-inventory-shared";
import { EditorSelect as Select } from "./editor-controls";

export function AccommodationReport({
  state,
}: Readonly<{ state: WeddingPlanDraft }>) {
  return useAccommodationReportView(state);
}

function useAccommodationReportView(state: WeddingPlanDraft) {
  const [itineraryGuest, setItineraryGuest] = useState(
    state.guests[0]?.id ?? "",
  );
  const report = useMemo(() => {
    try {
      return {
        audit: auditAccommodationInventory(canonicalWeddingPlan(state)),
        error: "",
      };
    } catch (cause) {
      return {
        audit: null,
        error:
          cause instanceof Error ? cause.message : "Inventory is incomplete",
      };
    }
  }, [state]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Allocation check</CardTitle>
      </CardHeader>
      <CardContent>
        {report.error && <p className="editor-error">{report.error}</p>}
        {report.audit && (
          <>
            <div className="progress-strip inventory-summary">
              <span>
                <strong>{report.audit.issues.length}</strong> conflicts
              </span>
              <span>
                <strong>{report.audit.unassigned_guest_ids.length}</strong>{" "}
                unassigned
              </span>
              <span>
                <strong>{report.audit.unused_room_ids.length}</strong> unused
                rooms
              </span>
            </div>
            {report.audit.issues.map((issue, index) => (
              <p className="inventory-issue" key={`${issue.kind}:${index}`}>
                <AlertTriangle size={15} /> {issue.message}
              </p>
            ))}
            {report.audit.unassigned_guest_ids.length > 0 && (
              <p className="inventory-issue">
                <AlertTriangle size={15} /> Unassigned:{" "}
                {report.audit.unassigned_guest_ids
                  .map(
                    (id) =>
                      state.guests.find((guest) => guest.id === id)?.name ?? id,
                  )
                  .join(", ")}
              </p>
            )}
          </>
        )}
        <div className="inventory-itinerary-export">
          <Select
            label="Guest itinerary export"
            value={itineraryGuest}
            onChange={setItineraryGuest}
          >
            {state.guests.map((guest) => (
              <option key={guest.id} value={guest.id}>
                {guest.name}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            variant="outline"
            disabled={!itineraryGuest || !report.audit}
            onClick={() =>
              downloadJson(
                `${itineraryGuest}-accommodation.json`,
                guestAccommodationItinerary(
                  canonicalWeddingPlan(state),
                  itineraryGuest,
                ),
              )
            }
          >
            <Download size={14} /> Guest itinerary
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
