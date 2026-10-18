import { z } from "zod";

const OptionalTextSchema = z.string().trim().min(1).optional();
const IdentifierSchema = z.string().trim().min(1);

export const ChecklistStatusSchema = z.enum([
  "not_started",
  "in_progress",
  "blocked",
  "complete",
  "not_applicable",
]);
export type ChecklistStatus = z.infer<typeof ChecklistStatusSchema>;

export const ChecklistPrioritySchema = z.enum([
  "low",
  "normal",
  "high",
  "critical",
]);
export type ChecklistPriority = z.infer<typeof ChecklistPrioritySchema>;

export const ChecklistScheduleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("due_date"), dueDate: z.iso.date() }),
  z
    .object({
      kind: z.literal("date_range"),
      startsOn: z.iso.date(),
      endsOn: z.iso.date(),
    })
    .refine((schedule) => schedule.startsOn <= schedule.endsOn, {
      message: "A checklist date range must end on or after it starts",
      path: ["endsOn"],
    }),
]);
export type ChecklistSchedule = z.infer<typeof ChecklistScheduleSchema>;

export const ChecklistFinancialLinkSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("commitment"), recordId: IdentifierSchema }),
  z.object({ kind: z.literal("decision"), recordId: IdentifierSchema }),
  z.object({ kind: z.literal("payment_action"), recordId: IdentifierSchema }),
  z.object({ kind: z.literal("reconciliation"), recordId: IdentifierSchema }),
]);
export type ChecklistFinancialLink = z.infer<
  typeof ChecklistFinancialLinkSchema
>;

export const ChecklistStatusChangeSchema = z.object({
  status: ChecklistStatusSchema,
  changedAt: z.iso.datetime({ offset: true }),
  changedBy: z.string().trim().min(1),
});
export type ChecklistStatusChange = z.infer<typeof ChecklistStatusChangeSchema>;

export const PlanningChecklistItemSchema = z
  .object({
    id: IdentifierSchema,
    title: z.string().trim().min(1),
    description: OptionalTextSchema,
    category: z.string().trim().min(1),
    owner: z.string().trim().min(1),
    schedule: ChecklistScheduleSchema.optional(),
    priority: ChecklistPrioritySchema.default("normal"),
    status: ChecklistStatusSchema.default("not_started"),
    dependencyIds: z
      .array(IdentifierSchema)
      .default([])
      .transform((ids) => Array.from(new Set(ids))),
    notes: OptionalTextSchema,
    externalLink: z.url().optional(),
    financialLinks: z.array(ChecklistFinancialLinkSchema).default([]),
    statusHistory: z.array(ChecklistStatusChangeSchema).min(1),
  })
  .superRefine((item, context) => {
    if (item.dependencyIds.includes(item.id)) {
      context.addIssue({
        code: "custom",
        message: "A checklist item cannot depend on itself",
        path: ["dependencyIds"],
      });
    }
    if (item.statusHistory.at(-1)?.status !== item.status) {
      context.addIssue({
        code: "custom",
        message: "The latest status history entry must match the item status",
        path: ["statusHistory"],
      });
    }
    for (let index = 1; index < item.statusHistory.length; index += 1) {
      const previous = item.statusHistory[index - 1];
      const current = item.statusHistory[index];
      if (
        previous != null &&
        current != null &&
        previous.changedAt > current.changedAt
      ) {
        context.addIssue({
          code: "custom",
          message: "Checklist status history must be chronological",
          path: ["statusHistory", index, "changedAt"],
        });
      }
    }
  });
export type PlanningChecklistItem = z.infer<typeof PlanningChecklistItemSchema>;

const LabelsSchema = z
  .array(z.string().trim().min(1))
  .default([])
  .transform((labels) => Array.from(new Set(labels)));

export const PlanningCaseSchema = z.object({
  id: IdentifierSchema,
  name: z.string().trim().min(1),
  description: OptionalTextSchema,
  labels: LabelsSchema,
  targetDate: z.iso.date().optional(),
  checklistItems: z.array(PlanningChecklistItemSchema).default([]),
});
export type PlanningCase = z.infer<typeof PlanningCaseSchema>;
