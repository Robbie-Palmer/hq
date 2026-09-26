import { z } from "zod";

import { ActorProfileSchema } from "./actor";
import { OwnerPolicySchema } from "./policy";
import {
  ExecutionSessionIdentitySchema,
  WorkerAdapterIdentitySchema,
} from "./session";
import { TaskRequirementsSchema } from "./task";

export const PortableContractSchema = z.union([
  TaskRequirementsSchema,
  ActorProfileSchema,
  OwnerPolicySchema,
  WorkerAdapterIdentitySchema,
  ExecutionSessionIdentitySchema,
]);
export type PortableContract = z.infer<typeof PortableContractSchema>;
