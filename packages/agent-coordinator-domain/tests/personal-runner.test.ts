import { describe, expect, it, vi } from "vitest";

import { buildMatchingInput, preflightProfile } from "../../../scripts/agent-coordinator";
import type { WorkGraphCoordinator } from "../src/work-graph";

const profile = {
  label: "primary",
  codexHome: "/private/codex-primary",
  actorId: "codex:primary",
};

const config = {
  schemaVersion: 1 as const,
  profiles: [profile],
  workingDirectory: ".",
  readyLimit: 10,
  proposalTtlSeconds: 300,
  leaseDurationSeconds: 1800,
  capacityPreflight: true,
};

describe("personal runner", () => {
  it("builds an advisory input from ready work without claiming it", async () => {
    const claim = vi.fn();
    const graph = {
      claim,
      listReadyCandidates: vi.fn().mockResolvedValue({
        items: [{
          id: "ticket-1",
          title: "Implement bounded change",
          lifecycle: "open",
          parentId: null,
          rank: 1,
          priorityRank: null,
          schedulingInitiativeId: null,
          schedulingProjectId: null,
          expedited: false,
          expediteReason: null,
          stage: "ready",
          currentLease: null,
          priority: {
            initiativeRank: 1,
            projectRank: 1,
            ticketRank: 1,
            expedited: false,
            effectiveExpedited: false,
            donatedFromWorkItemId: null,
          },
        }],
        nextCursor: null,
      }),
      readRequirements: vi.fn().mockResolvedValue({
        workItemId: "ticket-1",
        brief: {
          kind: "brief",
          content: "Make the change.",
          sourceWorkItemId: "ticket-1",
          inheritanceDepth: 0,
        },
        acceptanceCriteria: {
          kind: "acceptance_criteria",
          content: "Tests pass.",
          sourceWorkItemId: "ticket-1",
          inheritanceDepth: 0,
        },
      }),
    } as unknown as WorkGraphCoordinator;

    const input = await buildMatchingInput(
      graph,
      profile,
      config,
      new Date("2026-10-08T08:00:00.000Z"),
    );

    expect(input.queue.items[0]?.task.taskId).toBe("ticket-1");
    expect(input.workerInventory.workers[0]?.actor.actorId).toBe("codex:primary");
    expect(claim).not.toHaveBeenCalled();
  });

  it("fails authentication before attempting a capacity probe", async () => {
    const execute = vi.fn().mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "not logged in",
    });

    await expect(
      preflightProfile(profile, "/repo", true, execute),
    ).rejects.toThrow("is not authenticated");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      "codex",
      ["login", "status"],
      expect.objectContaining({
        environment: expect.objectContaining({
          CODEX_HOME: "/private/codex-primary",
        }),
      }),
    );
  });
});
