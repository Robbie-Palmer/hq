import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type Actor,
  type AnyActorLogic,
  createActor,
  fromPromise,
} from "xstate";
import {
  getAdjacencyMap,
  getShortestPaths,
  getSimplePaths,
  toDirectedGraph,
} from "xstate/graph";
import type { AgentDetail, AgentHost } from "@/lib/api/agents";
import {
  type ApprovalAction,
  type ApprovalIntent,
  type ApprovalPageState,
  type ApprovalProvider,
  type ApprovalSession,
  agentApprovalMachine,
  createAgentApprovalTrace,
  type PendingReauthentication,
  ReauthenticationRequiredError,
} from "@/lib/recipes/agent-approval-machine";

const intent: ApprovalIntent = { agentId: "agent-1", code: "ABCD-1234" };
const session: ApprovalSession = {
  email: "cook@example.test",
  userId: "user-1",
};
const agent: AgentDetail = {
  activatedAt: null,
  capabilityGrants: [{ capability: "recipes.search", status: "pending" }],
  createdAt: "2026-08-22T09:00:00.000Z",
  expiresAt: "2026-09-21T09:00:00.000Z",
  hostId: "host-1",
  id: "agent-1",
  lastUsedAt: null,
  mode: "delegated",
  name: "Meal planner",
  status: "pending",
};
const host: AgentHost = {
  id: "host-1",
  name: "Kitchen helper host",
  status: "active",
};
const pageState: ApprovalPageState = {
  error: null,
  intent,
  reauthentication: null,
  resume: false,
};

type ActorFunctions = {
  readPageState: () => Promise<ApprovalPageState>;
  loadAgent: (
    input: { intent: ApprovalIntent },
    signal: AbortSignal,
  ) => Promise<AgentDetail>;
  loadHost: (
    input: { hostId: string },
    signal: AbortSignal,
  ) => Promise<AgentHost>;
  decideApproval: (input: {
    action: ApprovalAction;
    intent: ApprovalIntent;
  }) => Promise<void>;
  loadProviders: (input: {
    action: ApprovalAction;
    userId: string;
  }) => Promise<ApprovalProvider[]>;
  startOAuth: (input: {
    intent: ApprovalIntent;
    pending: PendingReauthentication;
  }) => Promise<{ error: string | null }>;
};

const runningActors: Actor<AnyActorLogic>[] = [];

afterEach(() => {
  for (const actorRef of runningActors) actorRef.stop();
  runningActors.length = 0;
});

function createTestMachine(overrides: Partial<ActorFunctions> = {}) {
  const actors: ActorFunctions = {
    readPageState: async () => pageState,
    loadAgent: async () => agent,
    loadHost: async () => host,
    decideApproval: async () => undefined,
    loadProviders: async () => ["github"],
    startOAuth: async () => ({ error: null }),
    ...overrides,
  };
  return agentApprovalMachine.provide({
    actors: {
      readPageState: fromPromise(() => actors.readPageState()),
      loadAgent: fromPromise(({ input, signal }) =>
        actors.loadAgent(input, signal),
      ),
      loadHost: fromPromise(({ input, signal }) =>
        actors.loadHost(input, signal),
      ),
      decideApproval: fromPromise(({ input }) => actors.decideApproval(input)),
      loadProviders: fromPromise(({ input }) => actors.loadProviders(input)),
      startOAuth: fromPromise(({ input }) => actors.startOAuth(input)),
    },
  });
}

function startMachine(
  machine = createTestMachine(),
  input: { session: ApprovalSession | null; sessionPending: boolean } = {
    session,
    sessionPending: false,
  },
) {
  const trace = createAgentApprovalTrace("test sequence");
  const actorRef = createActor(machine, { input, inspect: trace.inspect });
  runningActors.push(actorRef);
  actorRef.start();
  return { actorRef, trace };
}

async function waitForSnapshot(
  actorRef: Actor<AnyActorLogic>,
  trace: ReturnType<typeof createAgentApprovalTrace>,
  predicate: (snapshot: ReturnType<typeof actorRef.getSnapshot>) => boolean,
) {
  try {
    await vi.waitFor(() =>
      expect(predicate(actorRef.getSnapshot())).toBe(true),
    );
  } catch (cause) {
    throw new Error(trace.format(), { cause });
  }
}

describe("agentApprovalMachine", () => {
  it("loads the request and records approval", async () => {
    const decideApproval = vi.fn<ActorFunctions["decideApproval"]>();
    const { actorRef, trace } = startMachine(
      createTestMachine({ decideApproval }),
    );

    await waitForSnapshot(actorRef, trace, (snapshot) =>
      snapshot.matches({ active: { workflow: "review" } }),
    );
    actorRef.send({ type: "APPROVE" });
    await waitForSnapshot(actorRef, trace, (snapshot) =>
      snapshot.matches("approved"),
    );

    expect(decideApproval).toHaveBeenCalledWith({
      action: "approve",
      intent,
    });
    expect(trace.format()).toContain("event APPROVE");
    expect(trace.format()).toContain("transition APPROVE");
  });

  it("records denial as a separate final state", async () => {
    const decideApproval = vi.fn<ActorFunctions["decideApproval"]>();
    const { actorRef, trace } = startMachine(
      createTestMachine({ decideApproval }),
    );

    await waitForSnapshot(actorRef, trace, (snapshot) =>
      snapshot.matches({ active: { workflow: "review" } }),
    );
    actorRef.send({ type: "DENY" });
    await waitForSnapshot(actorRef, trace, (snapshot) =>
      snapshot.matches("denied"),
    );

    expect(decideApproval).toHaveBeenCalledWith({ action: "deny", intent });
  });

  it("recovers through reauthentication and resumes after OAuth", async () => {
    const startOAuth = vi.fn<ActorFunctions["startOAuth"]>();
    startOAuth.mockResolvedValue({ error: null });
    const staleDecision = vi
      .fn<ActorFunctions["decideApproval"]>()
      .mockRejectedValueOnce(new ReauthenticationRequiredError());
    const first = startMachine(
      createTestMachine({ decideApproval: staleDecision, startOAuth }),
    );

    await waitForSnapshot(first.actorRef, first.trace, (snapshot) =>
      snapshot.matches({ active: { workflow: "review" } }),
    );
    first.actorRef.send({ type: "APPROVE" });
    await waitForSnapshot(first.actorRef, first.trace, (snapshot) =>
      snapshot.matches({
        active: {
          workflow: { reauthenticating: "ready" },
        },
      }),
    );

    first.actorRef.send({ type: "SELECT_PROVIDER", provider: "google" });
    expect(
      first.actorRef.getSnapshot().matches({
        active: { workflow: { reauthenticating: "ready" } },
      }),
      first.trace.format(),
    ).toBe(true);

    first.actorRef.send({ type: "SELECT_PROVIDER", provider: "github" });
    await waitForSnapshot(first.actorRef, first.trace, () =>
      Boolean(startOAuth.mock.calls.length),
    );
    expect(startOAuth.mock.calls[0]?.[0]).toMatchObject({
      intent,
      pending: {
        action: "approve",
        agentId: intent.agentId,
        code: intent.code,
        provider: "github",
        userId: session.userId,
      },
    });

    const resumeDecision = vi.fn<ActorFunctions["decideApproval"]>();
    const resumedPage: ApprovalPageState = {
      error: null,
      intent,
      reauthentication: {
        ...intent,
        action: "approve",
        createdAt: 1,
        provider: "github",
        userId: session.userId,
      },
      resume: true,
    };
    const resumed = startMachine(
      createTestMachine({
        readPageState: async () => resumedPage,
        decideApproval: resumeDecision,
      }),
    );
    await waitForSnapshot(resumed.actorRef, resumed.trace, (snapshot) =>
      snapshot.matches("approved"),
    );
    expect(resumeDecision).toHaveBeenCalledWith({
      action: "approve",
      intent,
    });
  });

  it("keeps request failure explicit and permits only denial", async () => {
    const decideApproval = vi.fn<ActorFunctions["decideApproval"]>();
    const { actorRef, trace } = startMachine(
      createTestMachine({
        loadAgent: async () => {
          throw new Error("The agent request response was invalid.");
        },
        decideApproval,
      }),
    );
    await waitForSnapshot(actorRef, trace, (snapshot) =>
      snapshot.matches({
        active: { request: "failed", workflow: "review" },
      }),
    );

    actorRef.send({ type: "APPROVE" });
    expect(
      actorRef.getSnapshot().matches({
        active: { request: "failed", workflow: "review" },
      }),
      trace.format(),
    ).toBe(true);
    expect(decideApproval).not.toHaveBeenCalled();

    actorRef.send({ type: "DENY" });
    await waitForSnapshot(actorRef, trace, (snapshot) =>
      snapshot.matches("denied"),
    );
  });

  it("stops an in-flight actor when cancellation exits its state", async () => {
    let loadingSignal: AbortSignal | undefined;
    const machine = createTestMachine({
      loadAgent: (_input, signal) => {
        loadingSignal = signal;
        return new Promise(() => undefined);
      },
    });
    const { actorRef, trace } = startMachine(machine);
    await waitForSnapshot(actorRef, trace, () => Boolean(loadingSignal));

    actorRef.send({ type: "CANCEL" });
    await waitForSnapshot(actorRef, trace, (snapshot) =>
      snapshot.matches("cancelled"),
    );
    expect(loadingSignal?.aborted, trace.format()).toBe(true);
  });

  it("stops host loading when approval leaves the active state", async () => {
    let hostSignal: AbortSignal | undefined;
    const machine = createTestMachine({
      loadHost: (_input, signal) => {
        hostSignal = signal;
        return new Promise(() => undefined);
      },
    });
    const { actorRef, trace } = startMachine(machine);
    await waitForSnapshot(actorRef, trace, (snapshot) =>
      snapshot.matches({
        active: { request: "loadingHost", workflow: "review" },
      }),
    );

    actorRef.send({ type: "APPROVE" });
    await waitForSnapshot(actorRef, trace, (snapshot) =>
      snapshot.matches("approved"),
    );
    expect(hostSignal?.aborted, trace.format()).toBe(true);
  });

  it("cannot turn a forbidden event into an impossible result", async () => {
    const machine = createTestMachine({
      readPageState: async () => ({ ...pageState, intent: null }),
    });
    const { actorRef, trace } = startMachine(machine);
    await waitForSnapshot(actorRef, trace, (snapshot) =>
      snapshot.matches("missingIntent"),
    );
    const before = actorRef.getSnapshot().value;

    actorRef.send({ type: "APPROVE" });
    actorRef.send({ type: "DENY" });
    actorRef.send({ type: "SELECT_PROVIDER", provider: "github" });

    expect(actorRef.getSnapshot().value, trace.format()).toEqual(before);
    expect(actorRef.getSnapshot().status).toBe("active");
  });
});

describe("agentApprovalMachine graph", () => {
  it("keeps every stable state reachable within the bounded graph", () => {
    const shortestPaths = graphScenarios().flatMap((scenario) =>
      boundedGraphPaths(scenario, "shortest"),
    );
    const reachedStateIds = new Set(
      shortestPaths.flatMap((path) =>
        "_nodes" in path.state
          ? path.state._nodes.map((node: { id: string }) => node.id)
          : [],
      ),
    );
    const expectedStableStates = [
      "agentApproval.bootstrapping",
      "agentApproval.waitingForSession",
      "agentApproval.signedOut",
      "agentApproval.missingIntent",
      "agentApproval.loadingAgent",
      "agentApproval.active.request.loadingHost",
      "agentApproval.active.request.ready",
      "agentApproval.active.request.failed",
      "agentApproval.active.workflow.review",
      "agentApproval.active.workflow.deciding",
      "agentApproval.active.workflow.loadingProviders",
      "agentApproval.active.workflow.reauthenticating.ready",
      "agentApproval.active.workflow.reauthenticating.startingOAuth",
      "agentApproval.approved",
      "agentApproval.denied",
      "agentApproval.cancelled",
    ];

    expect([...reachedStateIds].sort()).toEqual(
      expect.arrayContaining(expectedStableStates),
    );
    expect(shortestPaths).toHaveLength(227);
  });

  it("keeps declared and traversed transitions within bounded paths", () => {
    const scenarios = graphScenarios();
    const simplePaths = scenarios.flatMap((scenario) =>
      boundedGraphPaths(scenario, "simple"),
    );
    const adjacencyMaps = scenarios.map((scenario) =>
      getAdjacencyMap(agentApprovalMachine as AnyActorLogic, {
        events: scenario.events,
        input: scenario.input,
        limit: 250,
        serializeState: serializeGraphState,
      }),
    );
    const traversedTransitions = adjacencyMaps.reduce(
      (total, adjacency) =>
        total +
        Object.values(adjacency).reduce(
          (count, node) => count + Object.keys(node.transitions).length,
          0,
        ),
      0,
    );
    const directedGraph = toDirectedGraph(agentApprovalMachine);
    const declaredTransitions = countDirectedEdges(directedGraph);

    expect({
      declaredTransitions,
      simplePaths: simplePaths.length,
      traversedTransitions,
    }).toEqual({
      declaredTransitions: 27,
      simplePaths: 494,
      traversedTransitions: 1_594,
    });
  });
});

function graphScenarios() {
  const resumed: PendingReauthentication = {
    ...intent,
    action: "approve",
    createdAt: 1,
    provider: "github",
    userId: session.userId,
  };
  const pageLoaded = {
    type: "xstate.done.actor.readPageState",
    output: pageState,
  };
  const agentLoaded = { type: "xstate.done.actor.loadAgent", output: agent };
  const hostLoaded = { type: "xstate.done.actor.loadHost", output: host };
  const hostFailed = {
    type: "xstate.error.actor.loadHost",
    error: new Error("Host failed"),
  };
  const decisionSaved = {
    type: "xstate.done.actor.decideApproval",
    output: undefined,
  };
  const common = [pageLoaded, agentLoaded, hostLoaded, { type: "CANCEL" }];
  return [
    {
      name: "normal decisions",
      input: { session, sessionPending: false },
      events: [...common, { type: "APPROVE" }, { type: "DENY" }, decisionSaved],
    },
    {
      name: "optional host failure",
      input: { session, sessionPending: false },
      events: [
        pageLoaded,
        agentLoaded,
        hostFailed,
        { type: "APPROVE" },
        decisionSaved,
        { type: "CANCEL" },
      ],
    },
    {
      name: "request failure",
      input: { session, sessionPending: false },
      events: [
        pageLoaded,
        {
          type: "xstate.error.actor.loadAgent",
          error: new Error("Request failed"),
        },
        { type: "APPROVE" },
        { type: "DENY" },
        decisionSaved,
        { type: "CANCEL" },
      ],
    },
    {
      name: "decision failure",
      input: { session, sessionPending: false },
      events: [
        ...common,
        { type: "APPROVE" },
        {
          type: "xstate.error.actor.decideApproval",
          error: new Error("Decision failed"),
        },
      ],
    },
    {
      name: "reauthentication",
      input: { session, sessionPending: false },
      events: [
        ...common,
        { type: "APPROVE" },
        {
          type: "xstate.error.actor.decideApproval",
          error: new ReauthenticationRequiredError(),
        },
        { type: "xstate.done.actor.loadProviders", output: ["github"] },
        { type: "SELECT_PROVIDER", provider: "github" },
        { type: "SELECT_PROVIDER", provider: "google" },
        { type: "xstate.done.actor.startOAuth", output: { error: null } },
        { type: "CANCEL_REAUTHENTICATION" },
      ],
    },
    {
      name: "no linked providers",
      input: { session, sessionPending: false },
      events: [
        ...common,
        { type: "APPROVE" },
        {
          type: "xstate.error.actor.decideApproval",
          error: new ReauthenticationRequiredError(),
        },
        { type: "xstate.done.actor.loadProviders", output: [] },
      ],
    },
    {
      name: "provider load failure",
      input: { session, sessionPending: false },
      events: [
        ...common,
        { type: "APPROVE" },
        {
          type: "xstate.error.actor.decideApproval",
          error: new ReauthenticationRequiredError(),
        },
        {
          type: "xstate.error.actor.loadProviders",
          error: new Error("Providers failed"),
        },
      ],
    },
    {
      name: "oauth failure",
      input: { session, sessionPending: false },
      events: [
        ...common,
        { type: "APPROVE" },
        {
          type: "xstate.error.actor.decideApproval",
          error: new ReauthenticationRequiredError(),
        },
        { type: "xstate.done.actor.loadProviders", output: ["github"] },
        { type: "SELECT_PROVIDER", provider: "github" },
        {
          type: "xstate.error.actor.startOAuth",
          error: new Error("OAuth failed"),
        },
      ],
    },
    {
      name: "resume",
      input: { session, sessionPending: false },
      events: [
        {
          type: "xstate.done.actor.readPageState",
          output: { ...pageState, reauthentication: resumed, resume: true },
        },
        agentLoaded,
        hostLoaded,
        decisionSaved,
        { type: "CANCEL" },
      ],
    },
    {
      name: "resume identity mismatch",
      input: {
        session: { email: "other@example.test", userId: "user-2" },
        sessionPending: false,
      },
      events: [
        {
          type: "xstate.done.actor.readPageState",
          output: { ...pageState, reauthentication: resumed, resume: true },
        },
        agentLoaded,
        hostLoaded,
        { type: "SELECT_PROVIDER", provider: "github" },
        { type: "xstate.done.actor.startOAuth", output: { error: null } },
        { type: "CANCEL_REAUTHENTICATION" },
        { type: "CANCEL" },
      ],
    },
    {
      name: "oauth interruption",
      input: { session, sessionPending: false },
      events: [
        {
          type: "xstate.done.actor.readPageState",
          output: {
            error: "Identity confirmation was canceled.",
            intent,
            reauthentication: resumed,
            resume: false,
          },
        },
        agentLoaded,
        hostLoaded,
        { type: "CANCEL_REAUTHENTICATION" },
        { type: "CANCEL" },
      ],
    },
    {
      name: "missing intent",
      input: { session, sessionPending: false },
      events: [
        {
          type: "xstate.done.actor.readPageState",
          output: { ...pageState, intent: null },
        },
        { type: "CANCEL" },
      ],
    },
    {
      name: "page failure",
      input: { session, sessionPending: false },
      events: [
        {
          type: "xstate.error.actor.readPageState",
          error: new Error("Page state failed"),
        },
        { type: "CANCEL" },
      ],
    },
    {
      name: "pending session",
      input: { session: null, sessionPending: true },
      events: [
        pageLoaded,
        { type: "SESSION_CHANGED", session: null, pending: true },
        { type: "SESSION_CHANGED", session: null, pending: false },
        { type: "SESSION_CHANGED", session, pending: false },
        agentLoaded,
        hostLoaded,
        { type: "CANCEL" },
      ],
    },
    {
      name: "signed out",
      input: { session: null, sessionPending: false },
      events: [
        pageLoaded,
        { type: "SESSION_CHANGED", session, pending: false },
        agentLoaded,
        hostLoaded,
        { type: "CANCEL" },
      ],
    },
  ];
}

function serializeGraphState(snapshot: { context?: unknown; value?: unknown }) {
  return JSON.stringify({
    value: snapshot.value,
    context: graphContext(snapshot.context),
  });
}

function boundedGraphPaths(
  scenario: ReturnType<typeof graphScenarios>[number],
  kind: "shortest" | "simple",
) {
  const options = {
    events: scenario.events,
    input: scenario.input,
    limit: 250,
    serializeState: serializeGraphState,
  };
  try {
    return kind === "shortest"
      ? getShortestPaths(agentApprovalMachine as AnyActorLogic, options)
      : getSimplePaths(agentApprovalMachine as AnyActorLogic, options);
  } catch (cause) {
    throw new Error(`Graph scenario exceeded its bound: ${scenario.name}`, {
      cause,
    });
  }
}

function graphContext(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const context = value as Record<string, unknown>;
  return {
    action: context.action,
    agent: Boolean(context.agent),
    error: context.error,
    host: Boolean(context.host),
    intent: Boolean(context.intent),
    pendingProvider: context.pendingProvider,
    reauthentication: context.reauthentication,
    resumeAction: context.resumeAction,
    session: context.session,
    sessionPending: context.sessionPending,
  };
}

function countDirectedEdges(graph: ReturnType<typeof toDirectedGraph>): number {
  return (
    graph.edges.length +
    graph.children.reduce(
      (count, child) => count + countDirectedEdges(child),
      0,
    )
  );
}
