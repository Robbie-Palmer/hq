import { describe, expect, it } from "vitest";

import {
  buildWorkerPrompt,
  deriveTicketRoute,
  selectCodexProvider,
} from "./launch-work-graph-agent.js";

function ticket(
  input: Partial<{
    id: string;
    title: string;
    expedited: boolean;
    expediteReason: string | null;
    context: Array<{
      kind: string;
      content?: string;
      title?: string;
    }>;
  }> = {},
) {
  return {
    ticket: {
      id: input.id ?? "ticket-1",
      title: input.title ?? "Fix a broken link",
      expedited: input.expedited ?? false,
      expediteReason: input.expediteReason ?? null,
    },
    context: input.context ?? [
      { kind: "brief", content: "Fix one broken link." },
    ],
  };
}

function provider(instanceId: string, status: "ready" | "error" = "ready") {
  return {
    instanceId,
    driver: "codex",
    enabled: true,
    installed: true,
    status,
    auth: { status: "authenticated" },
    checkedAt: "2026-10-08T00:00:00.000Z",
    version: "1",
    models: [
      {
        slug: "gpt-6.1-sol",
        name: "GPT-6.1-Sol",
        isCustom: false,
        capabilities: null,
      },
    ],
    slashCommands: [],
    skills: [],
  };
}

describe("Work Graph ticket routing", () => {
  it("leaves autonomy policy to Work Graph and repository instructions", () => {
    const prompt = buildWorkerPrompt("ticket-1");

    expect(prompt).toContain("claim and execute ticket ticket-1");
    expect(prompt).toContain("Follow its context and the repository instructions");
    expect(prompt).not.toMatch(/safe|authori[sz]ed|ask|approval/iu);
  });

  it("uses a routine route and human-on-the-loop runtime for a bounded edit", () => {
    expect(deriveTicketRoute(ticket())).toMatchObject({
      complexity: "routine",
      preferredModels: ["gpt-6-luna", "gpt-6.1-sol"],
      reasoningEffort: "medium",
      runtimeMode: "full-access",
      serviceTier: "default",
    });
  });

  it("raises model strength without forcing approvals for architecture work", () => {
    expect(
      deriveTicketRoute(
        ticket({
          title: "Choose an orchestration architecture",
          context: [
            {
              kind: "brief",
              content: "Design a distributed orchestration protocol.",
            },
            { kind: "acceptance_criteria", content: "Record the decision." },
            { kind: "architecture_decision", title: "ADR 010" },
          ],
        }),
      ),
    ).toMatchObject({
      complexity: "critical",
      preferredModels: ["gpt-6-astra", "gpt-6.1-sol"],
      reasoningEffort: "xhigh",
      runtimeMode: "full-access",
    });
  });

  it("requires approvals only for a concrete protected mutation", () => {
    expect(
      deriveTicketRoute(
        ticket({
          title: "Rotate the production credential",
          expedited: true,
          expediteReason: "Credential expires today",
          context: [
            {
              kind: "acceptance_criteria",
              content: "Rotate the credential and deploy to production.",
            },
          ],
        }),
      ),
    ).toMatchObject({
      runtimeMode: "approval-required",
      serviceTier: "priority",
    });
  });

  it("spreads new tickets deterministically across ready Codex profiles", () => {
    const providers = [provider("codex"), provider("codex_2")];
    const first = selectCodexProvider(
      providers,
      "ticket-a",
      "gpt-6.1-sol",
    );
    const repeated = selectCodexProvider(
      providers,
      "ticket-a",
      "gpt-6.1-sol",
    );
    const other = selectCodexProvider(
      providers,
      "ticket-b",
      "gpt-6.1-sol",
    );

    expect(repeated.instanceId).toBe(first.instanceId);
    expect(other.instanceId).not.toBe(first.instanceId);
  });

  it("does not fall through an unavailable explicit profile", () => {
    expect(() =>
      selectCodexProvider(
        [provider("codex"), provider("codex_2", "error")],
        "ticket-a",
        "gpt-6.1-sol",
        "codex_2",
      ),
    ).toThrow("not ready, authenticated, and compatible");
  });
});
