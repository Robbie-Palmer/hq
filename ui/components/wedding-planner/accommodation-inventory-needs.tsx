"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type {
  StayRequirements,
  WeddingPlanDraft,
} from "@/lib/wedding-planner/types";
import {
  type AccommodationUpdate,
  emptyStayRequirements,
  inventoryOf,
  parseStringList,
} from "./accommodation-inventory-shared";
import {
  EditorField as Field,
  EditorSelect as Select,
  EditorToggle as Toggle,
} from "./editor-controls";

export function GuestNeedsEditor({
  state,
  update,
}: Readonly<{ state: WeddingPlanDraft; update: AccommodationUpdate }>) {
  return useGuestNeedsEditorView(state, update);
}

function useGuestNeedsEditorView(
  state: WeddingPlanDraft,
  update: AccommodationUpdate,
) {
  const [guestId, setGuestId] = useState(state.guests[0]?.id ?? "");
  const guest = state.guests.find((item) => item.id === guestId);
  if (!guest) return null;
  const stay = guest.stay ?? emptyStayRequirements();
  const change = (mutate: (item: typeof stay) => void) =>
    update((draft) => {
      const item = draft.guests.find((candidate) => candidate.id === guestId);
      if (!item) return;
      item.stay ??= structuredClone(stay);
      mutate(item.stay);
    });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Stay needs</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="inventory-fields">
          <Field label="Guest">
            <Select
              label="Accommodation needs guest"
              value={guestId}
              onChange={setGuestId}
            >
              {state.guests.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Arrival">
            <Input
              aria-label={`${guest.name} accommodation arrival`}
              type="date"
              value={stay.arrives_on ?? ""}
              onChange={(event) =>
                change((item) => {
                  item.arrives_on = event.target.value || null;
                })
              }
            />
          </Field>
          <Field label="Departure">
            <Input
              aria-label={`${guest.name} accommodation departure`}
              type="date"
              value={stay.departs_on ?? ""}
              onChange={(event) =>
                change((item) => {
                  item.departs_on = event.target.value || null;
                })
              }
            />
          </Field>
          <Field label="Accessibility" hint="Comma-separated requirements">
            <Input
              aria-label={`${guest.name} accommodation accessibility needs`}
              value={stay.accessibility_needs.join(", ")}
              onChange={(event) =>
                change((item) => {
                  item.accessibility_needs = parseStringList(
                    event.target.value,
                  );
                })
              }
            />
          </Field>
          <Field label="Transport" hint="Comma-separated requirements">
            <Input
              aria-label={`${guest.name} accommodation transport needs`}
              value={stay.transport_needs.join(", ")}
              onChange={(event) =>
                change((item) => {
                  item.transport_needs = parseStringList(event.target.value);
                })
              }
            />
          </Field>
          <Field label="Must share with">
            <select
              multiple
              aria-label={`${guest.name} must share accommodation with`}
              className="editor-select inventory-multi-select"
              value={stay.must_share_with}
              onChange={(event) =>
                change((item) => {
                  item.must_share_with = Array.from(
                    event.target.selectedOptions,
                    (option) => option.value,
                  );
                })
              }
            >
              {state.guests
                .filter((item) => item.id !== guest.id)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Must not share with">
            <select
              multiple
              aria-label={`${guest.name} must not share accommodation with`}
              className="editor-select inventory-multi-select"
              value={stay.must_not_share_with}
              onChange={(event) =>
                change((item) => {
                  item.must_not_share_with = Array.from(
                    event.target.selectedOptions,
                    (option) => option.value,
                  );
                })
              }
            >
              {state.guests
                .filter((item) => item.id !== guest.id)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Other needs" hint="Comma-separated requirements">
            <Input
              aria-label={`${guest.name} other accommodation needs`}
              value={stay.custom_needs.join(", ")}
              onChange={(event) =>
                change((item) => {
                  item.custom_needs = parseStringList(event.target.value);
                })
              }
            />
          </Field>
          <Toggle
            title="Needs space for children"
            checked={stay.needs_child_space}
            onChange={(needs) =>
              change((item) => {
                item.needs_child_space = needs;
              })
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}

export function HouseholdNeedsEditor({
  state,
  update,
}: Readonly<{ state: WeddingPlanDraft; update: AccommodationUpdate }>) {
  return useHouseholdNeedsEditorView(state, update);
}

function useHouseholdNeedsEditorView(
  state: WeddingPlanDraft,
  update: AccommodationUpdate,
) {
  const households = state.guest_directory?.households ?? [];
  const [householdId, setHouseholdId] = useState(households[0]?.id ?? "");
  const household = households.find((item) => item.id === householdId);
  if (!household) return null;
  const needs =
    state.inventory?.household_requirements[householdId] ??
    emptyStayRequirements();
  const change = (mutate: (item: StayRequirements) => void) =>
    update((draft) => {
      const data = inventoryOf(draft);
      data.household_requirements[householdId] ??= emptyStayRequirements();
      mutate(data.household_requirements[householdId]);
    });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Household needs</CardTitle>
      </CardHeader>
      <CardContent className="inventory-fields">
        <Field label="Household">
          <Select
            label="Accommodation needs household"
            value={householdId}
            onChange={setHouseholdId}
          >
            {households.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Arrival">
          <Input
            aria-label={`${household.name} accommodation arrival`}
            type="date"
            value={needs.arrives_on ?? ""}
            onChange={(event) =>
              change((item) => {
                item.arrives_on = event.target.value || null;
              })
            }
          />
        </Field>
        <Field label="Departure">
          <Input
            aria-label={`${household.name} accommodation departure`}
            type="date"
            value={needs.departs_on ?? ""}
            onChange={(event) =>
              change((item) => {
                item.departs_on = event.target.value || null;
              })
            }
          />
        </Field>
        <Field label="Accessibility" hint="Comma-separated requirements">
          <Input
            aria-label={`${household.name} accommodation accessibility needs`}
            value={needs.accessibility_needs.join(", ")}
            onChange={(event) =>
              change((item) => {
                item.accessibility_needs = parseStringList(event.target.value);
              })
            }
          />
        </Field>
        <Field label="Transport" hint="Comma-separated requirements">
          <Input
            aria-label={`${household.name} accommodation transport needs`}
            value={needs.transport_needs.join(", ")}
            onChange={(event) =>
              change((item) => {
                item.transport_needs = parseStringList(event.target.value);
              })
            }
          />
        </Field>
        <Field label="Other needs" hint="Comma-separated requirements">
          <Input
            aria-label={`${household.name} other accommodation needs`}
            value={needs.custom_needs.join(", ")}
            onChange={(event) =>
              change((item) => {
                item.custom_needs = parseStringList(event.target.value);
              })
            }
          />
        </Field>
        <Toggle
          title="Needs space for children"
          checked={needs.needs_child_space}
          onChange={(value) =>
            change((item) => {
              item.needs_child_space = value;
            })
          }
        />
      </CardContent>
    </Card>
  );
}
