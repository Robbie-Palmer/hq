"use client";

import { LockKeyhole, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type {
  AccommodationInventory,
  AccommodationProperty,
  AccommodationRoom,
  WeddingPlanDraft,
} from "@/app/_projects/wedding-planner/application/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  type AccommodationUpdate,
  emptyInventory,
  inventoryOf,
  newAccommodationId,
} from "./accommodation-inventory-shared";
import {
  EditorField as Field,
  EditorSelect as Select,
  EditorToggle as Toggle,
} from "./editor-controls";

function assignmentBedChangeHandler(
  update: AccommodationUpdate,
  assignmentId: string,
  bedId: string,
) {
  return (checked: boolean) =>
    update((draft) => {
      const item = inventoryOf(draft).assignments.find(
        (candidate) => candidate.id === assignmentId,
      );
      if (!item) return;
      item.bed_ids = checked
        ? [...new Set([...item.bed_ids, bedId])]
        : item.bed_ids.filter((id) => id !== bedId);
    });
}

export function AssignmentEditor({
  state,
  update,
}: Readonly<{ state: WeddingPlanDraft; update: AccommodationUpdate }>) {
  return useAssignmentEditorView(state, update);
}

function useAssignmentEditorView(
  state: WeddingPlanDraft,
  update: AccommodationUpdate,
) {
  const inventory = state.inventory ?? emptyInventory();
  const [subject, setSubject] = useState("");
  const [roomId, setRoomId] = useState("");
  const [status, setStatus] = useState<"confirmed" | "alternative">(
    "confirmed",
  );
  const [selfSubject, setSelfSubject] = useState("");
  const [selfProvider, setSelfProvider] = useState("");
  const [selfArrival, setSelfArrival] = useState("");
  const [selfDeparture, setSelfDeparture] = useState("");
  const room = inventory.rooms.find((item) => item.id === roomId);
  const property = inventory.properties.find(
    (item) => item.id === room?.property_id,
  );
  const subjectOptions = [
    ...state.guests.map((guest) => ({
      value: `guest:${guest.id}`,
      label: guest.name,
    })),
    ...(state.guest_directory?.households ?? []).map((household) => ({
      value: `household:${household.id}`,
      label: `${household.name} household`,
    })),
  ];
  const [subjectKind, subjectId] = subject.split(":", 2);
  const matchingPrimary = inventory.assignments.find(
    (assignment) =>
      assignment.status === "confirmed" &&
      assignment.subject.kind === subjectKind &&
      assignment.subject.id === subjectId,
  );
  return assignmentEditorView({
    state,
    update,
    inventory,
    subject,
    setSubject,
    roomId,
    setRoomId,
    status,
    setStatus,
    selfSubject,
    setSelfSubject,
    selfProvider,
    setSelfProvider,
    selfArrival,
    setSelfArrival,
    selfDeparture,
    setSelfDeparture,
    room,
    property,
    subjectOptions,
    matchingPrimary,
  });
}

function assignmentEditorView({
  state,
  update,
  inventory,
  subject,
  setSubject,
  roomId,
  setRoomId,
  status,
  setStatus,
  selfSubject,
  setSelfSubject,
  selfProvider,
  setSelfProvider,
  selfArrival,
  setSelfArrival,
  selfDeparture,
  setSelfDeparture,
  room,
  property,
  subjectOptions,
  matchingPrimary,
}: Readonly<{
  state: WeddingPlanDraft;
  update: AccommodationUpdate;
  inventory: AccommodationInventory;
  subject: string;
  setSubject: (value: string) => void;
  roomId: string;
  setRoomId: (value: string) => void;
  status: "confirmed" | "alternative";
  setStatus: (value: "confirmed" | "alternative") => void;
  selfSubject: string;
  setSelfSubject: (value: string) => void;
  selfProvider: string;
  setSelfProvider: (value: string) => void;
  selfArrival: string;
  setSelfArrival: (value: string) => void;
  selfDeparture: string;
  setSelfDeparture: (value: string) => void;
  room: AccommodationRoom | undefined;
  property: AccommodationProperty | undefined;
  subjectOptions: { value: string; label: string }[];
  matchingPrimary: AccommodationInventory["assignments"][number] | undefined;
}>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Room assignments</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="inventory-fields">
          <Field label="Guest or household">
            <Select
              label="Assignment guest or household"
              value={subject}
              onChange={setSubject}
            >
              <option value="">Choose</option>
              {subjectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Room">
            <Select label="Assignment room" value={roomId} onChange={setRoomId}>
              <option value="">Choose</option>
              {inventory.rooms.map((item) => (
                <option key={item.id} value={item.id}>
                  {inventory.properties.find(
                    (candidate) => candidate.id === item.property_id,
                  )?.name ?? item.property_id}{" "}
                  · {item.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Assignment type">
            <Select
              label="Assignment type"
              value={status}
              onChange={(value) => setStatus(value as typeof status)}
            >
              <option value="confirmed">Confirmed plan</option>
              <option value="alternative">Alternative</option>
            </Select>
          </Field>
          <Button
            disabled={
              !subject ||
              !room ||
              !property ||
              (status === "alternative" && !matchingPrimary)
            }
            onClick={() => {
              if (!room || !property) return;
              const [kind, id] = subject.split(":", 2) as [
                "guest" | "household",
                string,
              ];
              update((draft) => {
                const data = inventoryOf(draft);
                data.assignments.push({
                  id: newAccommodationId("assignment"),
                  subject: { kind, id },
                  room_id: room.id,
                  bed_ids: [],
                  arrives_on: property.check_in_on,
                  departs_on: property.check_out_on,
                  status,
                  alternative_to_assignment_id:
                    status === "alternative"
                      ? (matchingPrimary?.id ?? null)
                      : null,
                  locked: false,
                  notes: "",
                });
              });
              setSubject("");
            }}
          >
            <Plus size={15} /> Add assignment
          </Button>
        </div>
        <div className="inventory-assignment-list">
          {inventory.assignments.map((assignment) => {
            const assignedRoom = inventory.rooms.find(
              (item) => item.id === assignment.room_id,
            );
            const name =
              assignment.subject.kind === "guest"
                ? state.guests.find(
                    (guest) => guest.id === assignment.subject.id,
                  )?.name
                : state.guest_directory?.households.find(
                    (household) => household.id === assignment.subject.id,
                  )?.name;
            return (
              <div className="inventory-assignment-card" key={assignment.id}>
                <div className="inventory-assignment">
                  <div>
                    <strong>{name ?? assignment.subject.id}</strong>
                    <small>
                      {assignedRoom?.name ?? assignment.room_id} ·{" "}
                      {assignment.arrives_on} to {assignment.departs_on}
                    </small>
                  </div>
                  <Badge variant="outline">{assignment.status}</Badge>
                  <Toggle
                    title="Lock"
                    checked={assignment.locked}
                    onChange={(locked) =>
                      update((draft) => {
                        const item = inventoryOf(draft).assignments.find(
                          (candidate) => candidate.id === assignment.id,
                        );
                        if (item) item.locked = locked;
                      })
                    }
                  />
                  {assignment.locked && <LockKeyhole size={15} />}
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove assignment for ${name ?? assignment.subject.id}`}
                    onClick={() =>
                      update((draft) => {
                        const data = inventoryOf(draft);
                        data.assignments = data.assignments.filter(
                          (item) => item.id !== assignment.id,
                        );
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
                <div className="inventory-assignment-controls">
                  <Input
                    aria-label={`${name ?? assignment.subject.id} arrival`}
                    type="date"
                    value={assignment.arrives_on}
                    onChange={(event) =>
                      update((draft) => {
                        const item = inventoryOf(draft).assignments.find(
                          (candidate) => candidate.id === assignment.id,
                        );
                        if (item) item.arrives_on = event.target.value;
                      })
                    }
                  />
                  <Input
                    aria-label={`${name ?? assignment.subject.id} departure`}
                    type="date"
                    value={assignment.departs_on}
                    onChange={(event) =>
                      update((draft) => {
                        const item = inventoryOf(draft).assignments.find(
                          (candidate) => candidate.id === assignment.id,
                        );
                        if (item) item.departs_on = event.target.value;
                      })
                    }
                  />
                  {assignedRoom?.beds.map((bed) => (
                    <Toggle
                      key={bed.id}
                      title={bed.name}
                      checked={assignment.bed_ids.includes(bed.id)}
                      onChange={assignmentBedChangeHandler(
                        update,
                        assignment.id,
                        bed.id,
                      )}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="editor-divider" />
        <h3>Guest-arranged stays</h3>
        <div className="inventory-fields">
          <Field label="Guest or household">
            <Select
              label="Self-arranged guest or household"
              value={selfSubject}
              onChange={setSelfSubject}
            >
              <option value="">Choose</option>
              {subjectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Provider">
            <Input
              aria-label="Self-arranged provider"
              value={selfProvider}
              onChange={(event) => setSelfProvider(event.target.value)}
            />
          </Field>
          <Field label="Arrival">
            <Input
              aria-label="Self-arranged arrival"
              type="date"
              value={selfArrival}
              onChange={(event) => setSelfArrival(event.target.value)}
            />
          </Field>
          <Field label="Departure">
            <Input
              aria-label="Self-arranged departure"
              type="date"
              value={selfDeparture}
              onChange={(event) => setSelfDeparture(event.target.value)}
            />
          </Field>
          <Button
            disabled={
              !selfSubject ||
              !selfArrival ||
              !selfDeparture ||
              selfArrival >= selfDeparture
            }
            onClick={() => {
              const [kind, id] = selfSubject.split(":", 2) as [
                "guest" | "household",
                string,
              ];
              update((draft) => {
                inventoryOf(draft).self_arranged_stays.push({
                  id: newAccommodationId("self-arranged"),
                  subject: { kind, id },
                  arrives_on: selfArrival,
                  departs_on: selfDeparture,
                  provider_name: selfProvider,
                  address: "",
                  confirmation_details: "",
                });
              });
              setSelfSubject("");
              setSelfProvider("");
            }}
          >
            <Plus size={15} /> Add guest-arranged stay
          </Button>
        </div>
        {inventory.self_arranged_stays.map((stay) => {
          const option = subjectOptions.find(
            (item) => item.value === `${stay.subject.kind}:${stay.subject.id}`,
          );
          return (
            <div className="inventory-assignment" key={stay.id}>
              <div>
                <strong>{option?.label ?? stay.subject.id}</strong>
                <small>
                  {stay.provider_name || "Provider not recorded"} ·{" "}
                  {stay.arrives_on} to {stay.departs_on}
                </small>
              </div>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove self-arranged stay for ${option?.label ?? stay.subject.id}`}
                onClick={() =>
                  update((draft) => {
                    const data = inventoryOf(draft);
                    data.self_arranged_stays = data.self_arranged_stays.filter(
                      (item) => item.id !== stay.id,
                    );
                  })
                }
              >
                <Trash2 size={14} />
              </Button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
