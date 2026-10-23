import { z } from "zod";
import { parseContract } from "./parse";

export const nixFlakeContractSchema = z
  .object({
    schema_version: z.literal(1),
    contract: z.literal("nix-flake"),
    supported_systems: z.array(z.string().min(1)).min(1),
    ownership: z.record(z.string(), z.string().min(1)),
    inputs: z
      .object({
        locked: z.boolean(),
        follow_shared_nixpkgs_when_exposed: z.boolean(),
        allow_unlocked_production_builds: z.boolean(),
      })
      .strict(),
    outputs: z
      .object({
        per_system: z.record(z.string(), z.string()),
        top_level: z.record(z.string(), z.string()),
      })
      .strict(),
    secrets: z
      .object({
        allow_values_in_store: z.boolean(),
        allowed_declarations: z.array(z.string().min(1)),
        materialization: z.string().min(1),
      })
      .strict(),
    cache_and_recovery: z.record(z.string(), z.union([z.string(), z.boolean()])),
    mise_tasks: z.record(z.string(), z.string()),
  })
  .strict();

export type NixFlakeContract = z.infer<typeof nixFlakeContractSchema>;

export function parseNixFlakeContract(value: unknown): NixFlakeContract {
  return parseContract(value, nixFlakeContractSchema, "Nix flake contract");
}
