import { describe, expect, it, vi } from "vitest";

import {
  assertTicketRouteSupported,
  buildWorkerPrompt,
  classifyDocumentationTicketIds,
  deriveTicketRoute,
  isDocumentationOnlyTicket,
  refreshRoutingProviders,
  selectCodexProvider,
  selectCodexProviders,
  selectModel,
  selectReasoningEffort,
  selectRuntimeMode,
  startTurnWithProviderRecovery,
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
  it("settles the review loop before the one-ticket owner-review gate", () => {
    const prompt = buildWorkerPrompt("ticket-1", "/opt/bin/work-graph");

    expect(prompt).toContain("/opt/bin/work-graph");
    expect(prompt).toContain("claim and execute only ticket ticket-1");
    expect(prompt).toContain("never claim another ticket");
    expect(prompt).toContain("already installed and usable");
    expect(prompt).toContain("do not resolve it through PATH or reinstall it");
    expect(prompt).toContain("open a draft pull request");
    expect(prompt).toContain("Complete the pull request review loop at your discretion");
    expect(prompt).toContain("once per unchanged head");
    expect(prompt).toContain("then mark it ready for review");
    expect(prompt).toContain("request owner approval in Work Graph and stop");
    expect(prompt).toContain("Do not merge the pull request, release the ticket");
    expect(prompt).toContain("do not run mise trust again");
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

  it("caps critical architecture work at high reasoning", () => {
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
      reasoningEffort: "high",
      runtimeMode: "full-access",
    });
  });

  it("does not mistake a billing domain model for an external mutation", () => {
    const selection = ticket({
      title: "Model project costs, usage, time, allocation, and provenance",
      context: [
        {
          kind: "acceptance_criteria",
          content: "Represent billing periods, payment provenance, and allocated cost.",
        },
      ],
    });
    const route = deriveTicketRoute(selection);

    expect(route).toMatchObject({
      protectedMutation: false,
      runtimeMode: "full-access",
    });
    expect(() =>
      assertTicketRouteSupported(selection.ticket.id, route),
    ).not.toThrow();
  });

  it("rejects protected mutations instead of entering a prompt-heavy sandbox", () => {
    const selection = ticket({
      title: "Rotate the production credential",
      expedited: true,
      expediteReason: "Credential expires today",
      context: [
        {
          kind: "acceptance_criteria",
          content: "Rotate the credential and deploy to production.",
        },
      ],
    });
    const route = deriveTicketRoute(selection);

    expect(route).toMatchObject({
      protectedMutation: true,
      runtimeMode: "full-access",
      serviceTier: "priority",
    });
    expect(() => assertTicketRouteSupported(selection.ticket.id, route)).toThrow(
      "excluded until a scoped permission boundary is ready",
    );
  });

  it("rejects plural payment mutations before a full-access launch", () => {
    const selection = ticket({ title: "Refund payments" });
    const route = deriveTicketRoute(selection);

    expect(route.protectedMutation).toBe(true);
    expect(() => assertTicketRouteSupported(selection.ticket.id, route)).toThrow(
      "excluded until a scoped permission boundary is ready",
    );
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

  it.each([
    "Add the recipe detail page",
    "Fix the login page redirect",
    "Add a copy button to code blocks",
  ])("keeps implementation ticket %s eligible", (title) => {
    expect(isDocumentationOnlyTicket(ticket({ title }))).toBe(false);
  });

  it("classifies a coordinator ticket batch with the shared rules", () => {
    const tickets = [
      ticket({ id: "docs", title: "Update README.md" }).ticket,
      ticket({ id: "page", title: "Fix the login page redirect" }).ticket,
      ticket({ id: "code", title: "Implement the parser" }).ticket,
    ];

    expect(classifyDocumentationTicketIds(tickets)).toEqual(["docs"]);
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

  it("orders every approved profile behind the deterministic first choice", () => {
    const providers = [provider("codex"), provider("codex_2")];
    const selected = selectCodexProviders(
      providers,
      "ticket-a",
      "gpt-5.6-sol",
    );

    expect(selected.map(({ instanceId }) => instanceId)).toEqual([
      selectCodexProvider(providers, "ticket-a", "gpt-5.6-sol").instanceId,
      selectCodexProvider(providers, "ticket-b", "gpt-5.6-sol").instanceId,
    ]);
  });

  it("does not add fallback profiles when an explicit profile is selected", () => {
    expect(
      selectCodexProviders(
        [provider("codex"), provider("codex_2")],
        "ticket-a",
        "gpt-5.6-sol",
        "codex_2",
      ).map(({ instanceId }) => instanceId),
    ).toEqual(["codex_2"]);
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

  it("stops a capacity-limited provider before retrying the same thread", async () => {
    const calls: string[] = [];
    const failedTurn = {
      completion: Promise.resolve({
        state: "error",
        error: "Codex usage limit reached.",
      }),
    };
    const runningTurn = { completion: new Promise(() => undefined) };
    const startTurn = vi.fn((input: { modelSelection: { instanceId: string } }) => {
      calls.push(`start:${input.modelSelection.instanceId}`);
      return Promise.resolve(
        input.modelSelection.instanceId === "codex_2"
          ? failedTurn
          : runningTurn,
      );
    });
    const stopSession = vi.fn(() => {
      calls.push("stop");
      return Promise.resolve();
    });
    const get = vi.fn(() => {
      calls.push("get");
      return Promise.resolve({ session: { status: "stopped" } });
    });
    const providers = [provider("codex_2"), provider("codex")];

    const recovered = await startTurnWithProviderRecovery({
      attempts: providers.map((current) => ({
        provider: current,
        modelSelection: {
          instanceId: current.instanceId,
          model: "gpt-5.6-sol",
          options: [],
        },
      })),
      buildTurnInput: ({ modelSelection }) => ({ modelSelection }),
      startupObservationMs: 1,
      stopTimeoutMs: 100,
      threadId: "thread-1",
      threads: { get, startTurn, stopSession },
    } as Parameters<typeof startTurnWithProviderRecovery>[0]);

    expect(recovered.provider.instanceId).toBe("codex");
    expect(recovered.attemptedProviders).toEqual(["codex_2", "codex"]);
    expect(calls).toEqual(["start:codex_2", "stop", "get", "start:codex"]);
  });

  it("stops but does not reroute a non-capacity startup failure", async () => {
    const startTurn = vi.fn(() =>
      Promise.resolve({
        completion: Promise.resolve({
          state: "error",
          error: "Repository setup failed.",
        }),
      }),
    );
    const stopSession = vi.fn(() => Promise.resolve());

    await expect(
      startTurnWithProviderRecovery({
        attempts: [provider("codex_2"), provider("codex")].map((current) => ({
          provider: current,
          modelSelection: {
            instanceId: current.instanceId,
            model: "gpt-5.6-sol",
            options: [],
          },
        })),
        buildTurnInput: ({ modelSelection }) => ({ modelSelection }),
        startupObservationMs: 1,
        stopTimeoutMs: 100,
        threadId: "thread-1",
        threads: {
          get: vi.fn(() =>
            Promise.resolve({ session: { status: "stopped" } }),
          ),
          startTurn,
          stopSession,
        },
      } as Parameters<typeof startTurnWithProviderRecovery>[0]),
    ).rejects.toThrow("Repository setup failed");
    expect(stopSession).toHaveBeenCalledOnce();
    expect(startTurn).toHaveBeenCalledOnce();
  });

  it("cleans up when startup observation itself fails", async () => {
    const stopSession = vi.fn(() => Promise.resolve());

    await expect(
      startTurnWithProviderRecovery({
        attempts: [provider("codex")].map((current) => ({
          provider: current,
          modelSelection: {
            instanceId: current.instanceId,
            model: "gpt-5.6-sol",
            options: [],
          },
        })),
        buildTurnInput: ({ modelSelection }) => ({ modelSelection }),
        startupObservationMs: 1,
        stopTimeoutMs: 100,
        threadId: "thread-1",
        threads: {
          get: vi.fn(() => Promise.resolve({ session: null })),
          startTurn: vi.fn(() =>
            Promise.resolve({
              completion: Promise.reject(new Error("watch disconnected")),
            }),
          ),
          stopSession,
        },
      } as Parameters<typeof startTurnWithProviderRecovery>[0]),
    ).rejects.toThrow("watch disconnected");
    expect(stopSession).toHaveBeenCalledOnce();
  });

  it("reports every provider when all approved profiles hit capacity", async () => {
    const startTurn = vi.fn(() =>
      Promise.resolve({
        completion: Promise.resolve({
          state: "error",
          error: "Provider capacity exhausted.",
        }),
      }),
    );
    const providers = [provider("codex_2"), provider("codex")];

    await expect(
      startTurnWithProviderRecovery({
        attempts: providers.map((current) => ({
          provider: current,
          modelSelection: {
            instanceId: current.instanceId,
            model: "gpt-5.6-sol",
            options: [],
          },
        })),
        buildTurnInput: ({ modelSelection }) => ({ modelSelection }),
        startupObservationMs: 1,
        stopTimeoutMs: 100,
        threadId: "thread-1",
        threads: {
          get: vi.fn(() => Promise.resolve({ session: null })),
          startTurn,
          stopSession: vi.fn(() => Promise.resolve()),
        },
      } as Parameters<typeof startTurnWithProviderRecovery>[0]),
    ).rejects.toThrow(
      "All approved Codex providers failed during startup: codex_2, codex",
    );
    expect(startTurn).toHaveBeenCalledTimes(2);
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

  it("rejects a model override outside the approved route", () => {
    const current = provider("codex");
    current.models.push({
      ...current.models[0],
      slug: "gpt-6-astra",
      name: "GPT-6 Astra",
    });

    expect(() =>
      selectModel(
        [current],
        deriveTicketRoute(ticket()),
        "gpt-6-astra",
      ),
    ).toThrow("outside the approved route policy");
  });

  it("rejects reasoning overrides above high", () => {
    const route = deriveTicketRoute(ticket());

    expect(selectReasoningEffort(route, "high")).toBe("high");
    expect(() => selectReasoningEffort(route, "xhigh")).toThrow();
  });

  it("rejects prompt-heavy runtime overrides", () => {
    const route = deriveTicketRoute(ticket());

    expect(selectRuntimeMode(route)).toBe("full-access");
    expect(() => selectRuntimeMode(route, "auto-accept-edits")).toThrow(
      "outside the approved route policy",
    );
  });
});
