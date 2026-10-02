import { describe, expect, it } from "vitest";
import { MUTATION_ACTOR_TYPES, MutationActorTypeSchema } from "../src/mutation";

describe("mutation actors", () => {
  it("owns and validates the actor-type vocabulary", () => {
    expect(MUTATION_ACTOR_TYPES).toEqual(["agent", "user"]);
    expect(MutationActorTypeSchema.parse("agent")).toBe("agent");
    expect(MutationActorTypeSchema.parse("user")).toBe("user");
    expect(MutationActorTypeSchema.safeParse("service").success).toBe(false);
  });
});
