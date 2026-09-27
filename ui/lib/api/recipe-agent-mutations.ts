import {
  type MutationActorType,
  MutationActorTypeSchema,
} from "recipe-domain/mutation";
import {
  PantryLocationSchema,
  type PantryMutationValue,
} from "recipe-domain/pantry";
import { z } from "zod";
import { apiRequest } from "@/lib/api/http";

export type AgentMutationHistoryItem = {
  stableItemId: string;
  ingredientSlug: string;
  beforeValue: PantryMutationValue | null;
  afterValue: PantryMutationValue | null;
  beforeVersion: string | null;
  afterVersion: string;
};

export type AgentMutationHistory = {
  id: string;
  actorType: MutationActorType;
  agentId: string | null;
  agentName: string | null;
  hostId: string | null;
  hostName: string | null;
  capability: string;
  targetType: string;
  targetId: string;
  reason: string;
  compensatesChangeSetId: string | null;
  createdAt: string;
  items: AgentMutationHistoryItem[];
};

const mutationValueSchema = z
  .object({
    ingredientSlug: z.string(),
    location: PantryLocationSchema,
  })
  .strict();

const mutationItemSchema = z
  .object({
    stableItemId: z.uuid(),
    ingredientSlug: z.string(),
    beforeValue: mutationValueSchema.nullable(),
    afterValue: mutationValueSchema.nullable(),
    beforeVersion: z.string().regex(/^\d+$/).nullable(),
    afterVersion: z.string().regex(/^\d+$/),
  })
  .strict();

const mutationHistorySchema = z
  .object({
    id: z.uuid(),
    actorType: MutationActorTypeSchema,
    agentId: z.string().nullable(),
    agentName: z.string().nullable(),
    hostId: z.string().nullable(),
    hostName: z.string().nullable(),
    capability: z.string(),
    targetType: z.string(),
    targetId: z.string(),
    reason: z.string(),
    compensatesChangeSetId: z.uuid().nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    items: z.array(mutationItemSchema),
  })
  .strict();

export async function listAgentMutations(
  signal?: AbortSignal,
): Promise<AgentMutationHistory[]> {
  const body = await apiRequest<unknown>("/api/profile/agent-mutations", {
    signal,
    fallbackMessage: "Agent change history could not be loaded.",
  });
  const parsed = z
    .object({ items: z.array(mutationHistorySchema) })
    .safeParse(body);
  if (!parsed.success) {
    throw new Error("The agent change history response was invalid.");
  }
  return parsed.data.items;
}

export async function undoAgentMutation(changeSetId: string): Promise<void> {
  const body = await apiRequest<unknown>(
    `/api/profile/agent-mutations/${encodeURIComponent(changeSetId)}/undo`,
    {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      json: {},
      fallbackMessage: "The agent change could not be undone.",
    },
  );
  const parsed = z
    .object({
      applied: z.literal(true),
      changeSetId: z.uuid(),
      replayed: z.boolean(),
    })
    .strict()
    .safeParse(body);
  if (!parsed.success) throw new Error("The undo response was invalid.");
}
