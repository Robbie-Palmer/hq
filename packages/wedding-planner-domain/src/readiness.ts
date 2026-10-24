import { z } from "zod";
import { auditAccommodationInventory } from "./accommodation/inventory";
import type { WeddingPlan } from "./plan";

export const readinessCheckIds = [
  "checklist",
  "finances",
  "guest_responses",
  "guest_metadata",
  "guest_follow_up",
  "accommodation",
  "accommodation_bookings",
  "seating",
  "seating_exports",
] as const;

export const ReadinessCheckIdSchema = z.enum(readinessCheckIds);
export type ReadinessCheckId = z.infer<typeof ReadinessCheckIdSchema>;

export const seatingExportKinds = ["venue", "caterer", "floor_plan"] as const;
export const SeatingExportKindSchema = z.enum(seatingExportKinds);
export type SeatingExportKind = z.infer<typeof SeatingExportKindSchema>;

export const readinessMilestoneSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  due_on: z.iso.date().nullable().default(null),
  check_ids: z
    .array(ReadinessCheckIdSchema)
    .default([...readinessCheckIds])
    .transform((checks) => [...new Set(checks)]),
  required_guest_fields: z
    .array(z.string().trim().min(1))
    .default([])
    .transform((fields) => [...new Set(fields)]),
  required_seating_exports: z
    .array(SeatingExportKindSchema)
    .default([...seatingExportKinds])
    .transform((exports) => [...new Set(exports)]),
});
export type ReadinessMilestone = z.infer<typeof readinessMilestoneSchema>;

const defaultMilestone: ReadinessMilestone = {
  id: "wedding-day",
  name: "Wedding day",
  due_on: null,
  check_ids: [...readinessCheckIds],
  required_guest_fields: [],
  required_seating_exports: [...seatingExportKinds],
};

export const weddingReadinessPreferencesSchema = z.object({
  planning_case_id: z.string().trim().min(1).nullable().default(null),
  active_milestone_id: z.string().trim().min(1).default(defaultMilestone.id),
  milestones: z
    .array(readinessMilestoneSchema)
    .min(1)
    .default([defaultMilestone]),
  seating_exports: z
    .array(
      z.object({
        kind: SeatingExportKindSchema,
        plan_id: z.string().trim().min(1),
        exported_at: z.iso.datetime({ offset: true }),
      }),
    )
    .default([]),
});
export type WeddingReadinessPreferences = z.infer<
  typeof weddingReadinessPreferencesSchema
>;

export function defaultWeddingReadinessPreferences(): WeddingReadinessPreferences {
  return weddingReadinessPreferencesSchema.parse({});
}

export type ReadinessTask = {
  id: string;
  title: string;
  owner: string | null;
  status:
    | "not_started"
    | "in_progress"
    | "blocked"
    | "complete"
    | "not_applicable";
  due_on: string | null;
  href: string;
};

export type WeddingFinanceSummary = {
  currency: string;
  planned: number;
  committed: number;
  paid: number;
  refunded: number;
  remaining: number;
};

export type UpcomingWeddingPayment = {
  id: string;
  title: string;
  due_on: string;
  amount: number;
  currency: string;
  href: string;
};

export type WeddingOperationsSnapshot = {
  planning_case_id: string;
  planning_case_name: string;
  tasks: ReadinessTask[];
  unresolved_decisions: { id: string; title: string; href: string }[];
  finances: WeddingFinanceSummary[];
  upcoming_payments: UpcomingWeddingPayment[];
};

export type ReadinessArea =
  | "checklist"
  | "finances"
  | "guests"
  | "accommodation"
  | "seating";

export type ReadinessIssue = {
  id: string;
  check_id: ReadinessCheckId;
  area: ReadinessArea;
  severity: "attention" | "warning";
  title: string;
  detail: string;
  href: string;
};

export type WeddingReadiness = {
  milestone: ReadinessMilestone;
  checklist: {
    completed: number;
    total: number;
    overdue: number;
    blocked: number;
    upcoming: number;
    ownership_gaps: number;
    unresolved_decisions: number;
  };
  finances: WeddingFinanceSummary[];
  upcoming_payments: UpcomingWeddingPayment[];
  guests: {
    total: number;
    attending: number;
    awaiting_response: number;
    missing_required_metadata: number;
    follow_up: number;
  };
  accommodation: {
    unassigned: number;
    conflicts: number;
    unmet_needs: number;
    booking_deadlines: number;
    unresolved_payments: number;
  };
  seating: {
    eligible: number;
    seated: number;
    unseated: number;
    infeasible_constraints: number;
    unlocked: number;
    stale_exports: number;
  };
  issues: ReadinessIssue[];
};

function taskDueOn(task: ReadinessTask): string | null {
  return task.due_on;
}

function issue(
  input: Omit<ReadinessIssue, "severity"> & {
    severity?: ReadinessIssue["severity"];
  },
): ReadinessIssue {
  return { severity: "attention", ...input };
}

function checklistReadiness(
  operations: WeddingOperationsSnapshot | null,
  asOfDate: string,
): { summary: WeddingReadiness["checklist"]; issues: ReadinessIssue[] } {
  const tasks = operations?.tasks ?? [];
  const actionable = tasks.filter((task) => task.status !== "not_applicable");
  const incomplete = actionable.filter((task) => task.status !== "complete");
  const overdue = incomplete.filter(
    (task) => taskDueOn(task) != null && taskDueOn(task)! < asOfDate,
  );
  const blocked = incomplete.filter((task) => task.status === "blocked");
  const upcoming = incomplete.filter(
    (task) => taskDueOn(task) != null && taskDueOn(task)! >= asOfDate,
  );
  const ownershipGaps = incomplete.filter((task) => !task.owner?.trim());
  const taskIssues = incomplete.flatMap((task) => {
    const details = [
      overdue.includes(task) ? `Overdue since ${task.due_on}` : null,
      task.status === "blocked" ? "Blocked" : null,
      !task.owner?.trim() ? "No owner assigned" : null,
    ].filter((detail): detail is string => detail != null);
    return details.length
      ? [
          issue({
            id: `task:${task.id}`,
            check_id: "checklist",
            area: "checklist",
            severity:
              overdue.includes(task) || task.status === "blocked"
                ? "warning"
                : "attention",
            title: task.title,
            detail: details.join("; "),
            href: task.href,
          }),
        ]
      : [];
  });
  const issues: ReadinessIssue[] = [
    ...taskIssues,
    ...(operations?.unresolved_decisions ?? []).map((decision) =>
      issue({
        id: `decision:${decision.id}`,
        check_id: "checklist",
        area: "checklist",
        title: decision.title,
        detail: "Decision still open",
        href: decision.href,
      }),
    ),
  ];
  return {
    summary: {
      completed: actionable.filter((task) => task.status === "complete").length,
      total: actionable.length,
      overdue: overdue.length,
      blocked: blocked.length,
      upcoming: upcoming.length,
      ownership_gaps: ownershipGaps.length,
      unresolved_decisions: operations?.unresolved_decisions.length ?? 0,
    },
    issues,
  };
}

function guestFieldValue(plan: WeddingPlan, guestId: string, field: string) {
  const guest = plan.guests.find((candidate) => candidate.id === guestId);
  if (!guest) return undefined;
  if (field.startsWith("custom_fields."))
    return guest.custom_fields[field.slice("custom_fields.".length)];
  return guest[field as keyof typeof guest];
}

function missingValue(value: unknown): boolean {
  return (
    value == null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0) ||
    value === "unknown"
  );
}

function guestReadiness(
  plan: WeddingPlan,
  milestone: ReadinessMilestone,
): { summary: WeddingReadiness["guests"]; issues: ReadinessIssue[] } {
  const activeGuests = plan.guests.filter((guest) => guest.attendance !== "no");
  const awaiting = plan.guests.filter(
    (guest) =>
      guest.attendance === "unknown" ||
      Object.values(guest.event_responses).some(
        (response) =>
          response.invitation === "invited" && response.response === "unknown",
      ),
  );
  const missingMetadata = activeGuests.flatMap((guest) => {
    const missing = milestone.required_guest_fields.filter((field) =>
      missingValue(guestFieldValue(plan, guest.id, field)),
    );
    return missing.length ? [{ guest, missing }] : [];
  });
  const followUp = activeGuests.filter(
    (guest) =>
      (guest.transport.status === "needed" ||
        guest.transport.status === "unknown") &&
      guest.attendance === "yes",
  );
  const accessibilityFollowUp = activeGuests.filter(
    (guest) =>
      guest.accessibility_needs.length > 0 &&
      !["arranged", "not_needed"].includes(guest.accommodation_details.status),
  );
  const chosenPlanId = plan.seating.chosen_plan_id;
  const catererExportIsCurrent =
    chosenPlanId != null &&
    plan.readiness.seating_exports.some(
      (entry) => entry.kind === "caterer" && entry.plan_id === chosenPlanId,
    );
  const dietaryFollowUp = activeGuests.filter(
    (guest) =>
      guest.attendance === "yes" &&
      (guest.dietary_needs.length > 0 || guest.allergies.length > 0) &&
      !catererExportIsCurrent,
  );
  const followUpIds = new Set([
    ...followUp.map((guest) => guest.id),
    ...accessibilityFollowUp.map((guest) => guest.id),
    ...dietaryFollowUp.map((guest) => guest.id),
  ]);
  return {
    summary: {
      total: plan.guests.length,
      attending: plan.guests.filter((guest) => guest.attendance === "yes")
        .length,
      awaiting_response: awaiting.length,
      missing_required_metadata: missingMetadata.length,
      follow_up: followUpIds.size,
    },
    issues: [
      ...awaiting.map((guest) =>
        issue({
          id: `guest-response:${guest.id}`,
          check_id: "guest_responses",
          area: "guests",
          title: guest.name,
          detail: "Invitation or attendance response is still open",
          href: `wedding:guests:${guest.id}`,
        }),
      ),
      ...missingMetadata.map(({ guest, missing }) =>
        issue({
          id: `guest-metadata:${guest.id}`,
          check_id: "guest_metadata",
          area: "guests",
          title: guest.name,
          detail: `Missing ${missing.join(", ")}`,
          href: `wedding:guests:${guest.id}`,
        }),
      ),
      ...followUp.map((guest) =>
        issue({
          id: `guest-transport:${guest.id}`,
          check_id: "guest_follow_up",
          area: "guests",
          title: guest.name,
          detail: "Transport needs follow-up",
          href: `wedding:guests:${guest.id}`,
        }),
      ),
      ...accessibilityFollowUp.map((guest) =>
        issue({
          id: `guest-accessibility:${guest.id}`,
          check_id: "guest_follow_up",
          area: "guests",
          title: guest.name,
          detail: "Accessibility needs are not tied to arranged accommodation",
          href: `wedding:guests:${guest.id}`,
        }),
      ),
      ...dietaryFollowUp.map((guest) =>
        issue({
          id: `guest-dietary:${guest.id}`,
          check_id: "guest_follow_up",
          area: "guests",
          title: guest.name,
          detail:
            "Dietary or allergy details are not in the current caterer export",
          href: `wedding:guests:${guest.id}`,
        }),
      ),
    ],
  };
}

function accommodationReadiness(
  plan: WeddingPlan,
  milestone: ReadinessMilestone,
  asOfDate: string,
): {
  summary: WeddingReadiness["accommodation"];
  issues: ReadinessIssue[];
} {
  const audit = auditAccommodationInventory(plan);
  const guestNames = new Map(
    plan.guests.map((guest) => [guest.id, guest.name]),
  );
  const deadline = milestone.due_on ?? asOfDate;
  const bookingDeadlines = plan.accommodation.inventory.properties.filter(
    (property) =>
      property.booking_deadline != null &&
      property.booking_deadline <= deadline &&
      !["booked", "cancelled"].includes(property.booking.status),
  );
  const unresolvedPayments = plan.accommodation.inventory.properties.filter(
    (property) =>
      property.booking.status === "booked" &&
      property.booking.payer.kind === "couple" &&
      (property.booking.commitment_id == null ||
        property.booking.payment_ids.length === 0),
  );
  const conflicts = audit.issues.filter((item) => item.kind !== "unmet_need");
  const unmetNeeds = audit.issues.filter((item) => item.kind === "unmet_need");
  return {
    summary: {
      unassigned: audit.unassigned_guest_ids.length,
      conflicts: conflicts.length,
      unmet_needs: unmetNeeds.length,
      booking_deadlines: bookingDeadlines.length,
      unresolved_payments: unresolvedPayments.length,
    },
    issues: [
      ...audit.unassigned_guest_ids.map((guestId) =>
        issue({
          id: `accommodation-unassigned:${guestId}`,
          check_id: "accommodation",
          area: "accommodation",
          severity: "warning",
          title: guestNames.get(guestId) ?? guestId,
          detail:
            "Needs accommodation but has no confirmed or self-arranged stay",
          href: `wedding:inventory:${guestId}`,
        }),
      ),
      ...audit.issues.map((item, index) =>
        issue({
          id: `accommodation-${item.kind}:${index}`,
          check_id: "accommodation",
          area: "accommodation",
          severity: "warning",
          title:
            item.kind === "unmet_need"
              ? "Unmet need"
              : "Accommodation conflict",
          detail: item.message,
          href: "wedding:inventory",
        }),
      ),
      ...bookingDeadlines.map((property) =>
        issue({
          id: `accommodation-deadline:${property.id}`,
          check_id: "accommodation_bookings",
          area: "accommodation",
          title: property.name,
          detail: `Booking is unresolved before ${property.booking_deadline}`,
          href: `wedding:inventory:${property.id}`,
        }),
      ),
      ...unresolvedPayments.map((property) =>
        issue({
          id: `accommodation-payment:${property.id}`,
          check_id: "accommodation_bookings",
          area: "accommodation",
          title: property.name,
          detail: "Booked stay is missing a commitment or payment link",
          href: `wedding:inventory:${property.id}`,
        }),
      ),
    ],
  };
}

function seatingReadiness(
  plan: WeddingPlan,
  milestone: ReadinessMilestone,
): { summary: WeddingReadiness["seating"]; issues: ReadinessIssue[] } {
  const eligible = plan.guests.filter((guest) => {
    if (!plan.seating.event_id) return guest.attendance === "yes";
    return (
      guest.event_responses[plan.seating.event_id]?.response === "attending"
    );
  });
  const chosen = plan.seating.saved_plans.find(
    (candidate) => candidate.id === plan.seating.chosen_plan_id,
  );
  const seatedIds = new Set(
    chosen?.allocation.tables.flatMap((table) => table.guest_ids) ?? [],
  );
  const unseated = eligible.filter((guest) => !seatedIds.has(guest.id));
  const lockedIds = new Set(
    chosen?.allocation.tables.flatMap((table) =>
      table.locked
        ? table.guest_ids
        : table.seats
            .filter((seat) => seat.locked && seat.guest_id)
            .map((seat) => seat.guest_id!),
    ) ?? [],
  );
  const unlocked = eligible.filter(
    (guest) => seatedIds.has(guest.id) && !lockedIds.has(guest.id),
  );
  const currentExports = new Map(
    plan.readiness.seating_exports.map((entry) => [entry.kind, entry.plan_id]),
  );
  const staleExports = milestone.required_seating_exports.filter(
    (kind) => !chosen || currentExports.get(kind) !== chosen.id,
  );
  const infeasible = chosen?.allocation.unsatisfied_preferences ?? [];
  const allocationWarnings = chosen?.allocation.warnings ?? [];
  return {
    summary: {
      eligible: eligible.length,
      seated: eligible.length - unseated.length,
      unseated: unseated.length,
      infeasible_constraints: infeasible.length + allocationWarnings.length,
      unlocked: unlocked.length,
      stale_exports: staleExports.length,
    },
    issues: [
      ...unseated.map((guest) =>
        issue({
          id: `seating-unseated:${guest.id}`,
          check_id: "seating",
          area: "seating",
          severity: "warning",
          title: guest.name,
          detail: "Eligible guest is not in the chosen seating plan",
          href: `wedding:tables:${guest.id}`,
        }),
      ),
      ...infeasible.map((preference, index) =>
        issue({
          id: `seating-constraint:${index}`,
          check_id: "seating",
          area: "seating",
          title: "Unmet seating constraint",
          detail: preference.description,
          href: "wedding:tables",
        }),
      ),
      ...allocationWarnings.map((warning, index) =>
        issue({
          id: `seating-warning:${index}`,
          check_id: "seating",
          area: "seating",
          severity: "warning",
          title: "Seating plan warning",
          detail: warning,
          href: "wedding:tables",
        }),
      ),
      ...(unlocked.length
        ? [
            issue({
              id: "seating-unlocked",
              check_id: "seating",
              area: "seating",
              title: `${unlocked.length} seating assignments are not locked`,
              detail: "Lock final seats or tables before the milestone",
              href: "wedding:tables",
            }),
          ]
        : []),
      ...staleExports.map((kind) =>
        issue({
          id: `seating-export:${kind}`,
          check_id: "seating_exports",
          area: "seating",
          title: `${kind.replace("_", " ")} export is not current`,
          detail: chosen
            ? "Export the chosen plan again after its latest change"
            : "Choose and save a seating plan before exporting",
          href: "wedding:tables",
        }),
      ),
    ],
  };
}

export function activeReadinessMilestone(
  plan: Pick<WeddingPlan, "readiness">,
): ReadinessMilestone {
  return (
    plan.readiness.milestones.find(
      (milestone) => milestone.id === plan.readiness.active_milestone_id,
    ) ?? plan.readiness.milestones[0]!
  );
}

export function buildWeddingReadiness(
  plan: WeddingPlan,
  operations: WeddingOperationsSnapshot | null,
  asOfDate: string,
): WeddingReadiness {
  const milestone = activeReadinessMilestone(plan);
  const enabled = new Set(milestone.check_ids);
  const checklist = checklistReadiness(operations, asOfDate);
  const guests = guestReadiness(plan, milestone);
  const accommodation = accommodationReadiness(plan, milestone, asOfDate);
  const seating = seatingReadiness(plan, milestone);
  const upcomingPayments = (operations?.upcoming_payments ?? []).filter(
    (payment) => !milestone.due_on || payment.due_on <= milestone.due_on,
  );
  const financeIssues = upcomingPayments.map((payment) =>
    issue({
      id: `finance-payment:${payment.id}`,
      check_id: "finances",
      area: "finances",
      title: payment.title,
      detail: `${payment.currency} ${payment.amount.toFixed(2)} due ${payment.due_on}`,
      href: payment.href,
    }),
  );
  const allIssues = [
    ...checklist.issues,
    ...financeIssues,
    ...guests.issues,
    ...accommodation.issues,
    ...seating.issues,
  ];
  return {
    milestone,
    checklist: checklist.summary,
    finances: operations?.finances ?? [],
    upcoming_payments: upcomingPayments,
    guests: guests.summary,
    accommodation: accommodation.summary,
    seating: seating.summary,
    issues: allIssues.filter((item) => enabled.has(item.check_id)),
  };
}
