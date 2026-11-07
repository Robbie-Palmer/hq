import {
  assign,
  fromPromise,
  type InspectionEvent,
  isMachineSnapshot,
  setup,
} from "xstate";
import type { AgentDetail, AgentHost } from "@/lib/api/agents";

export type ApprovalAction = "approve" | "deny";
export type ApprovalProvider = "google" | "github";

export type ApprovalIntent = {
  agentId: string;
  code: string;
};

export type ApprovalSession = {
  email: string;
  userId: string;
};

export type PendingReauthentication = ApprovalIntent & {
  action: ApprovalAction;
  createdAt: number;
  provider: ApprovalProvider;
  userId: string;
};

export type ApprovalPageState = {
  error: string | null;
  intent: ApprovalIntent | null;
  reauthentication: PendingReauthentication | null;
  resume: boolean;
};

type Reauthentication = {
  action: ApprovalAction;
  providers: ApprovalProvider[];
  userId: string;
};

type AgentApprovalContext = {
  action: ApprovalAction | null;
  agent: AgentDetail | null;
  error: string | null;
  host: AgentHost | null;
  intent: ApprovalIntent | null;
  pendingProvider: ApprovalProvider | null;
  reauthentication: Reauthentication | null;
  resumeAction: PendingReauthentication | null;
  session: ApprovalSession | null;
  sessionPending: boolean;
};

export type AgentApprovalInput = {
  session: ApprovalSession | null;
  sessionPending: boolean;
};

export type AgentApprovalEvent =
  | {
      type: "SESSION_CHANGED";
      session: ApprovalSession | null;
      pending: boolean;
    }
  | { type: "APPROVE" }
  | { type: "DENY" }
  | { type: "SELECT_PROVIDER"; provider: ApprovalProvider }
  | { type: "CANCEL_REAUTHENTICATION" }
  | { type: "CANCEL" };

type OAuthResult = { error: string | null };

export class ReauthenticationRequiredError extends Error {
  constructor(message = "Confirm your identity to continue.") {
    super(message);
    this.name = "ReauthenticationRequiredError";
  }
}

const missingActor = (name: string) =>
  Promise.reject(new Error(`Missing agent approval actor: ${name}`));

function actorOutput(event: AgentApprovalEvent): unknown {
  return "output" in event ? event.output : undefined;
}

function actorError(event: AgentApprovalEvent): unknown {
  return "error" in event ? event.error : undefined;
}

const agentApprovalSetup = setup({
  types: {
    context: {} as AgentApprovalContext,
    events: {} as AgentApprovalEvent,
    input: {} as AgentApprovalInput,
  },
  actors: {
    readPageState: fromPromise<ApprovalPageState>(() =>
      missingActor("readPageState"),
    ),
    loadAgent: fromPromise<AgentDetail, { intent: ApprovalIntent }>(() =>
      missingActor("loadAgent"),
    ),
    loadHost: fromPromise<AgentHost, { hostId: string }>(() =>
      missingActor("loadHost"),
    ),
    decideApproval: fromPromise<
      void,
      { action: ApprovalAction; intent: ApprovalIntent }
    >(() => missingActor("decideApproval")),
    loadProviders: fromPromise<
      ApprovalProvider[],
      { action: ApprovalAction; userId: string }
    >(() => missingActor("loadProviders")),
    startOAuth: fromPromise<
      OAuthResult,
      {
        intent: ApprovalIntent;
        pending: PendingReauthentication;
      }
    >(() => missingActor("startOAuth")),
  },
  guards: {
    hasNoIntent: ({ context }) => context.intent === null,
    sessionIsPending: ({ context }) => context.sessionPending,
    hasNoSession: ({ context }) => context.session === null,
    sessionEventIsPending: ({ event }) =>
      event.type === "SESSION_CHANGED" && event.pending,
    sessionEventIsSignedOut: ({ event }) =>
      event.type === "SESSION_CHANGED" && !event.pending && !event.session,
    sessionEventIsSignedIn: ({ event }) =>
      event.type === "SESSION_CHANGED" && Boolean(event.session),
    hasAgent: ({ context }) => context.agent !== null,
    canResume: ({ context }) =>
      Boolean(
        context.agent &&
          context.resumeAction &&
          context.session?.userId === context.resumeAction.userId,
      ),
    resumeIdentityChanged: ({ context }) =>
      Boolean(
        context.agent &&
          context.resumeAction &&
          context.session?.userId !== context.resumeAction.userId,
      ),
    hasReauthentication: ({ context }) => context.reauthentication !== null,
    canReauthenticate: ({ context, event }) =>
      context.session !== null &&
      event.type.startsWith("xstate.error.actor.") &&
      actorError(event) instanceof ReauthenticationRequiredError,
    hasProviders: ({ event }) => {
      const output = actorOutput(event);
      return (
        event.type.startsWith("xstate.done.actor.") &&
        Array.isArray(output) &&
        output.length > 0
      );
    },
    selectedApprove: ({ context }) => context.action === "approve",
    providerIsAvailable: ({ context, event }) =>
      event.type === "SELECT_PROVIDER" &&
      Boolean(context.reauthentication?.providers.includes(event.provider)),
  },
  actions: {
    storePageState: assign(({ event }) => {
      if (!event.type.startsWith("xstate.done.actor.")) return {};
      const page = actorOutput(event) as ApprovalPageState;
      return {
        error: page.error,
        intent: page.intent,
        reauthentication:
          page.reauthentication && !page.resume
            ? {
                action: page.reauthentication.action,
                providers: [page.reauthentication.provider],
                userId: page.reauthentication.userId,
              }
            : null,
        resumeAction:
          page.reauthentication && page.resume ? page.reauthentication : null,
      };
    }),
    storeSession: assign(({ event }) =>
      event.type === "SESSION_CHANGED"
        ? { session: event.session, sessionPending: event.pending }
        : {},
    ),
    storeAgent: assign(({ event }) =>
      event.type.startsWith("xstate.done.actor.")
        ? { agent: actorOutput(event) as AgentDetail }
        : {},
    ),
    storeHost: assign(({ event }) =>
      event.type.startsWith("xstate.done.actor.")
        ? { host: actorOutput(event) as AgentHost }
        : {},
    ),
    storeRequestError: assign(({ event }) => {
      const error = actorError(event);
      return {
        error:
          event.type.startsWith("xstate.error.actor.") && error instanceof Error
            ? error.message
            : "The agent request could not be loaded.",
      };
    }),
    selectDecision: assign(({ event }) => ({
      action: event.type === "APPROVE" ? "approve" : "deny",
      error: null,
    })),
    prepareResume: assign(({ context }) => ({
      action: context.resumeAction?.action ?? null,
      error: null,
      resumeAction: null,
    })),
    prepareIdentityMismatch: assign(({ context }) => ({
      error: "Use the same account that started this approval request.",
      reauthentication: context.resumeAction
        ? {
            action: context.resumeAction.action,
            providers: [context.resumeAction.provider],
            userId: context.resumeAction.userId,
          }
        : null,
      resumeAction: null,
    })),
    storeDecisionError: assign(({ event }) => {
      const error = actorError(event);
      return {
        action: null,
        error:
          event.type.startsWith("xstate.error.actor.") && error instanceof Error
            ? error.message
            : "The approval decision could not be saved.",
      };
    }),
    clearError: assign({ error: null }),
    storeProviders: assign(({ context, event }) => ({
      reauthentication:
        context.action &&
        context.session &&
        event.type.startsWith("xstate.done.actor.")
          ? {
              action: context.action,
              providers: actorOutput(event) as ApprovalProvider[],
              userId: context.session.userId,
            }
          : null,
    })),
    storeProviderLoadError: assign({
      action: null,
      error: "Your sign-in methods could not be loaded. Try again.",
      reauthentication: null,
    }),
    storeNoProvidersError: assign({
      action: null,
      error: "No linked sign-in method can confirm your identity.",
      reauthentication: null,
    }),
    selectProvider: assign(({ event }) => ({
      error: null,
      pendingProvider: event.type === "SELECT_PROVIDER" ? event.provider : null,
    })),
    storeOAuthResult: assign(({ event }) => ({
      error:
        event.type.startsWith("xstate.done.actor.") && actorOutput(event)
          ? (actorOutput(event) as OAuthResult).error
          : null,
      pendingProvider: null,
    })),
    storeOAuthError: assign({
      error: "Identity confirmation could not start. Try again.",
      pendingProvider: null,
    }),
    cancelReauthentication: assign({
      action: null,
      pendingProvider: null,
      reauthentication: null,
    }),
  },
});

export const agentApprovalMachine = agentApprovalSetup.createMachine({
  id: "agentApproval",
  initial: "bootstrapping",
  context: ({ input }) => ({
    action: null,
    agent: null,
    error: null,
    host: null,
    intent: null,
    pendingProvider: null,
    reauthentication: null,
    resumeAction: null,
    session: input.session,
    sessionPending: input.sessionPending,
  }),
  on: {
    CANCEL: { target: "#agentApproval.cancelled" },
  },
  states: {
    bootstrapping: {
      invoke: {
        id: "readPageState",
        src: "readPageState",
        onDone: { target: "routing", actions: "storePageState" },
        onError: {
          target: "missingIntent",
          actions: "storeRequestError",
        },
      },
    },
    routing: {
      always: [
        { guard: "hasNoIntent", target: "missingIntent" },
        { guard: "sessionIsPending", target: "waitingForSession" },
        { guard: "hasNoSession", target: "signedOut" },
        { target: "loadingAgent" },
      ],
    },
    waitingForSession: {
      on: {
        SESSION_CHANGED: [
          {
            guard: "sessionEventIsPending",
            actions: "storeSession",
          },
          {
            guard: "sessionEventIsSignedOut",
            target: "signedOut",
            actions: "storeSession",
          },
          {
            guard: "sessionEventIsSignedIn",
            target: "loadingAgent",
            actions: "storeSession",
          },
        ],
      },
    },
    signedOut: {
      on: {
        SESSION_CHANGED: {
          guard: "sessionEventIsSignedIn",
          target: "loadingAgent",
          actions: "storeSession",
        },
      },
    },
    missingIntent: {},
    loadingAgent: {
      on: {
        SESSION_CHANGED: {
          guard: "sessionEventIsSignedOut",
          target: "signedOut",
          actions: "storeSession",
        },
      },
      invoke: {
        id: "loadAgent",
        src: "loadAgent",
        input: ({ context }) => ({ intent: context.intent as ApprovalIntent }),
        onDone: { target: "active", actions: "storeAgent" },
        onError: { target: "active", actions: "storeRequestError" },
      },
    },
    active: {
      type: "parallel",
      on: {
        SESSION_CHANGED: [
          {
            guard: "sessionEventIsSignedOut",
            target: "signedOut",
            actions: "storeSession",
          },
          { actions: "storeSession" },
        ],
      },
      states: {
        request: {
          initial: "routing",
          states: {
            routing: {
              always: [
                { guard: "hasAgent", target: "loadingHost" },
                { target: "failed" },
              ],
            },
            loadingHost: {
              invoke: {
                id: "loadHost",
                src: "loadHost",
                input: ({ context }) => ({
                  hostId: (context.agent as AgentDetail).hostId,
                }),
                onDone: { target: "ready", actions: "storeHost" },
                onError: { target: "ready" },
              },
            },
            ready: {},
            failed: {},
          },
        },
        workflow: {
          initial: "routing",
          states: {
            routing: {
              always: [
                {
                  guard: "canResume",
                  target: "deciding",
                  actions: "prepareResume",
                },
                {
                  guard: "resumeIdentityChanged",
                  target: "reauthenticating",
                  actions: "prepareIdentityMismatch",
                },
                {
                  guard: "hasReauthentication",
                  target: "reauthenticating",
                },
                { target: "review" },
              ],
            },
            review: {
              on: {
                APPROVE: {
                  guard: "hasAgent",
                  target: "deciding",
                  actions: "selectDecision",
                },
                DENY: {
                  target: "deciding",
                  actions: "selectDecision",
                },
              },
            },
            deciding: {
              invoke: {
                id: "decideApproval",
                src: "decideApproval",
                input: ({ context }) => ({
                  action: context.action as ApprovalAction,
                  intent: context.intent as ApprovalIntent,
                }),
                onDone: [
                  {
                    guard: "selectedApprove",
                    target: "#agentApproval.approved",
                  },
                  { target: "#agentApproval.denied" },
                ],
                onError: [
                  {
                    guard: "canReauthenticate",
                    target: "loadingProviders",
                    actions: "clearError",
                  },
                  { target: "review", actions: "storeDecisionError" },
                ],
              },
            },
            loadingProviders: {
              invoke: {
                id: "loadProviders",
                src: "loadProviders",
                input: ({ context }) => ({
                  action: context.action as ApprovalAction,
                  userId: (context.session as ApprovalSession).userId,
                }),
                onDone: [
                  {
                    guard: "hasProviders",
                    target: "reauthenticating",
                    actions: "storeProviders",
                  },
                  { target: "review", actions: "storeNoProvidersError" },
                ],
                onError: {
                  target: "review",
                  actions: "storeProviderLoadError",
                },
              },
            },
            reauthenticating: {
              initial: "ready",
              states: {
                ready: {
                  on: {
                    SELECT_PROVIDER: {
                      guard: "providerIsAvailable",
                      target: "startingOAuth",
                      actions: "selectProvider",
                    },
                    CANCEL_REAUTHENTICATION: {
                      target: "#agentApproval.active.workflow.review",
                      actions: "cancelReauthentication",
                    },
                  },
                },
                startingOAuth: {
                  invoke: {
                    id: "startOAuth",
                    src: "startOAuth",
                    input: ({ context }) => ({
                      intent: context.intent as ApprovalIntent,
                      pending: {
                        ...(context.intent as ApprovalIntent),
                        action: (context.reauthentication as Reauthentication)
                          .action,
                        createdAt: Date.now(),
                        provider: context.pendingProvider as ApprovalProvider,
                        userId: (context.reauthentication as Reauthentication)
                          .userId,
                      },
                    }),
                    onDone: {
                      target: "ready",
                      actions: "storeOAuthResult",
                    },
                    onError: {
                      target: "ready",
                      actions: "storeOAuthError",
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    approved: { type: "final" },
    denied: { type: "final" },
    cancelled: { type: "final" },
  },
});

export type AgentApprovalTrace = {
  format: () => string;
  inspect: (event: InspectionEvent) => void;
  lines: readonly string[];
};

export function createAgentApprovalTrace(
  label = "agent approval",
): AgentApprovalTrace {
  const lines: string[] = [];
  const record = (line: string) => {
    lines.push(line);
    if (lines.length > 60) lines.shift();
  };
  return {
    lines,
    inspect(event) {
      if (event.actorRef.sessionId !== event.rootId) return;
      if (event.type === "@xstate.event") {
        record(`event ${event.event.type}`);
      }
      if (
        event.type === "@xstate.snapshot" &&
        isMachineSnapshot(event.snapshot)
      ) {
        record(
          `transition ${event.event.type} -> ${JSON.stringify(event.snapshot.value)}`,
        );
      }
    },
    format: () => `${label} trace:\n${lines.join("\n")}`,
  };
}
