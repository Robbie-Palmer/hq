import { z } from "zod";
import {
  ChecklistFinancialLinkSchema,
  ChecklistPrioritySchema,
  ChecklistScheduleSchema,
  ChecklistStatusSchema,
  type PlanningCase,
  PlanningCaseSchema,
  type PlanningChecklistItem,
  PlanningChecklistItemSchema,
} from "./model";

export const CreatePlanningChecklistItemInputSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  category: z.string().trim().min(1),
  owner: z.string().trim().min(1),
  schedule: ChecklistScheduleSchema.optional(),
  priority: ChecklistPrioritySchema.default("normal"),
  status: ChecklistStatusSchema.default("not_started"),
  dependencyIds: z.array(z.string().trim().min(1)).default([]),
  notes: z.string().trim().min(1).optional(),
  externalLink: z.url().optional(),
  financialLinks: z.array(ChecklistFinancialLinkSchema).default([]),
  changedBy: z.string().trim().min(1),
});
export type CreatePlanningChecklistItemInput = z.input<
  typeof CreatePlanningChecklistItemInputSchema
>;

export const PlanningChecklistStatusChangeInputSchema = z.object({
  itemId: z.string().trim().min(1),
  status: ChecklistStatusSchema,
  changedBy: z.string().trim().min(1),
});
export type PlanningChecklistStatusChangeInput = z.infer<
  typeof PlanningChecklistStatusChangeInputSchema
>;

export function createPlanningChecklistItem(
  id: string,
  input: CreatePlanningChecklistItemInput,
  changedAt: string,
): PlanningChecklistItem {
  const parsed = CreatePlanningChecklistItemInputSchema.parse(input);
  const { changedBy, ...item } = parsed;
  return PlanningChecklistItemSchema.parse({
    id,
    ...item,
    statusHistory: [{ status: item.status, changedAt, changedBy }],
  });
}

export function setPlanningChecklistItemStatus(
  planningCase: PlanningCase,
  input: PlanningChecklistStatusChangeInput,
  changedAt: string,
): PlanningCase {
  const parsed = PlanningChecklistStatusChangeInputSchema.parse(input);
  const current = planningCase.checklistItems.find(
    (item) => item.id === parsed.itemId,
  );
  if (current == null)
    throw new Error(`No checklist item found with ID ${parsed.itemId}`);
  if (current.status === parsed.status) return planningCase;
  const updated = PlanningChecklistItemSchema.parse({
    ...current,
    status: parsed.status,
    statusHistory: [
      ...current.statusHistory,
      {
        status: parsed.status,
        changedAt,
        changedBy: parsed.changedBy,
      },
    ],
  });
  return PlanningCaseSchema.parse({
    ...planningCase,
    checklistItems: planningCase.checklistItems.map((item) =>
      item.id === updated.id ? updated : item,
    ),
  });
}
