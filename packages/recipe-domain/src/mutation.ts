import { z } from "zod";

export const MUTATION_ACTOR_TYPES = ["agent", "user"] as const;

export const MutationActorTypeSchema = z.enum(MUTATION_ACTOR_TYPES);

export type MutationActorType = z.infer<typeof MutationActorTypeSchema>;

export type MutationActor =
  | {
      type: "agent";
      userId: string;
      agentId: string;
      agentName: string;
      hostId: string;
      hostName?: string;
    }
  | {
      type: "user";
      userId: string;
    };
