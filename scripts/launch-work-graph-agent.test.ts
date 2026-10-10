import { describe, expect, it, vi } from "vitest";

import {
  assertTicketRouteSupported,
  buildWorkerPrompt,
  deriveTicketRoute,
  isDocumentationOnlyTicket,
  refreshRoutingProviders,
  selectCodexProvider,
  selectModel,
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
        slug: "gpt-5.6-sol",
        name: "GPT-5.6 Sol",
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
    expect(prompt).toContain("do not run mise trust again");
    expect(prompt).not.toMatch(/safe|authori[sz]ed|ask|approval/iu);
  });

  it("uses a routine route and human-on-the-loop runtime for a bounded edit", () => {
    expect(deriveTicketRoute(ticket())).toMatchObject({
      complexity: "routine",
      workKind: "implementation",
      preferredModels: ["gpt-5.6-sol"],
      reasoningEffort: "medium",
      runtimeMode: "full-access",
      serviceTier: "default",
    });
  });

  it("uses Sol high and never Astra for standard Codex work", () => {
    expect(
      deriveTicketRoute(
        ticket({
          context: [
            { kind: "acceptance_criteria", content: "Ship the tested change." },
            { kind: "architecture_decision", title: "Follow Decision 010." },
          ],
        }),
      ),
    ).toMatchObject({
      complexity: "standard",
      preferredModels: ["gpt-5.6-sol"],
      reasoningEffort: "high",
    });
  });

  it("raises Sol reasoning without selecting Astra for architecture work", () => {
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
      preferredModels: ["gpt-5.6-sol"],
      reasoningEffort: "xhigh",
      runtimeMode: "full-access",
    });
  });

  it("sandboxes a concrete protected mutation without approving every read", () => {
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
      runtimeMode: "auto-accept-edits",
      serviceTier: "priority",
    });
  });

  it.each([
    "Publish ideas for sampling bias",
    "Preserve automated macrodissection design",
    "Define the telemetry questions",
    "Update the deployment runbook",
  ])("excludes documentation ticket %s", (title) => {
    expect(isDocumentationOnlyTicket(ticket({ title }))).toBe(true);
    expect(deriveTicketRoute(ticket({ title }))).toMatchObject({
      workKind: "documentation",
      preferredModels: ["gpt-5.6-sol"],
    });
  });

  it("does not exclude implementation work that mentions documentation", () => {
    expect(
      isDocumentationOnlyTicket(
        ticket({
          title: "Implement documentation provenance checks",
          context: [
            {
              kind: "acceptance_criteria",
              content: "Reject stale documentation during the build.",
            },
          ],
        }),
      ),
    ).toBe(false);
  });

  it("rejects a documentation route before creating a T3 thread", () => {
    const documentationRoute = deriveTicketRoute(
      ticket({ title: "Update the deployment runbook" }),
    );
    expect(() =>
      assertTicketRouteSupported("ticket-1", documentationRoute),
    ).toThrow("Documentation ticket ticket-1 is excluded");

    expect(() =>
      assertTicketRouteSupported("ticket-1", deriveTicketRoute(ticket())),
    ).not.toThrow();
  });

  it("refreshes provider status before routing", async () => {
    const providers = [provider("codex")];
    const refreshProviders = vi.fn().mockResolvedValue({ providers });

    await expect(
      refreshRoutingProviders({ server: { refreshProviders } }),
    ).resolves.toEqual(providers);
    expect(refreshProviders).toHaveBeenCalledOnce();
    expect(refreshProviders).toHaveBeenCalledWith({ refreshModels: false });
  });

  it("spreads new tickets deterministically across ready Codex profiles", () => {
    const providers = [provider("codex"), provider("codex_2")];
    const first = selectCodexProvider(
      providers,
      "ticket-a",
      "gpt-5.6-sol",
    );
    const repeated = selectCodexProvider(
      providers,
      "ticket-a",
      "gpt-5.6-sol",
    );
    const other = selectCodexProvider(
      providers,
      "ticket-b",
      "gpt-5.6-sol",
    );

    expect(repeated.instanceId).toBe(first.instanceId);
    expect(other.instanceId).not.toBe(first.instanceId);
  });

  it("does not fall through an unavailable explicit profile", () => {
    expect(() =>
      selectCodexProvider(
        [provider("codex"), provider("codex_2", "error")],
        "ticket-a",
        "gpt-5.6-sol",
        "codex_2",
      ),
    ).toThrow("not ready, authenticated, and compatible");
  });

  it("keeps an offered policy model eligible when the catalog marks it legacy", () => {
    const legacy = provider("codex");
    const route = deriveTicketRoute(ticket());

    expect(
      selectModel(
        [{ ...legacy, models: legacy.models.map((model) => ({ ...model, isLegacy: true })) }],
        route,
      ),
    ).toBe("gpt-5.6-sol");
  });

  it("rejects a withdrawn policy model without substituting an unapproved model", () => {
    const current = provider("codex");

    expect(() =>
      selectModel(
        [{ ...current, models: current.models.map((model) => ({ ...model, slug: "gpt-6.1-sol" })) }],
        deriveTicketRoute(ticket()),
      ),
    ).toThrow("No ready authenticated Codex provider offers the selected policy model");
  });
});
