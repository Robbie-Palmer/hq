import { z } from "zod";

import { ActorProfileSchema } from "./actor";
import { AuthenticationAllowlistEntrySchema } from "./authentication";
import { ComplexityScaleSchema } from "./complexity";
import { OwnerPolicySchema } from "./policy";
import {
  ExecutionSessionIdentitySchema,
  WorkerAdapterIdentitySchema,
} from "./session";
import { TaskRequirementsSchema } from "./task";

export const PortableContractSchema = z.union([
  TaskRequirementsSchema,
  ComplexityScaleSchema,
  ActorProfileSchema,
  OwnerPolicySchema,
  WorkerAdapterIdentitySchema,
  ExecutionSessionIdentitySchema,
  AuthenticationAllowlistEntrySchema,
]);
export type PortableContract = z.infer<typeof PortableContractSchema>;
