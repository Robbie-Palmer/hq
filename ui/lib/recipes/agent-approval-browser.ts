import { fromPromise } from "xstate";
import {
  decideAgentApproval,
  FreshSessionRequiredError,
  getAgent,
  getAgentHost,
} from "@/lib/api/agents";
import { authClient } from "@/lib/auth-client";
import {
  readBrowserStorage,
  removeBrowserStorage,
  writeBrowserStorageJson,
} from "@/lib/browser/storage";
import {
  type ApprovalPageState,
  type ApprovalProvider,
  agentApprovalMachine,
  type PendingReauthentication,
  ReauthenticationRequiredError,
} from "@/lib/recipes/agent-approval-machine";

const REAUTH_FLOW = "agent-approval";
const REAUTH_RETURN_PARAM = "agent_reauth";
const REAUTH_STORAGE_KEY = "recipe-agent-approval-reauth:v1";
const REAUTH_MAX_AGE_MS = 15 * 60 * 1000;
const APPROVAL_PROVIDERS: ApprovalProvider[] = ["google", "github"];

function isProvider(value: unknown): value is ApprovalProvider {
  return value === "google" || value === "github";
}

function clearStoredReauthentication() {
  removeBrowserStorage("sessionStorage", REAUTH_STORAGE_KEY);
}

function readStoredReauthentication(): PendingReauthentication | null {
  try {
    const raw = readBrowserStorage("sessionStorage", REAUTH_STORAGE_KEY);
    clearStoredReauthentication();
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingReauthentication>;
    if (
      typeof value.agentId !== "string" ||
      typeof value.code !== "string" ||
      (value.action !== "approve" && value.action !== "deny") ||
      typeof value.createdAt !== "number" ||
      !isProvider(value.provider) ||
      typeof value.userId !== "string" ||
      Date.now() - value.createdAt > REAUTH_MAX_AGE_MS
    ) {
      return null;
    }
    return value as PendingReauthentication;
  } catch {
    return null;
  }
}

function reauthenticationError(params: URLSearchParams): string | null {
  const code = params.get("error");
  if (!code) return null;
  if (code === "agent_reauth_identity_mismatch") {
    return "Use the same account that started this approval request.";
  }
  if (code === "access_denied") {
    return "Identity confirmation was canceled.";
  }
  return "Your identity could not be confirmed. Try again.";
}

function readApprovalPageState(): ApprovalPageState {
  const params = new URLSearchParams(globalThis.location.search);
  const agentId = params.get("agent_id")?.trim();
  const code = params.get("code")?.trim();
  const returning = params.get(REAUTH_RETURN_PARAM) === "complete";
  const reauthentication = returning ? readStoredReauthentication() : null;
  let intent = null;
  if (agentId && code) {
    intent = { agentId, code };
  } else if (reauthentication) {
    intent = {
      agentId: reauthentication.agentId,
      code: reauthentication.code,
    };
  }

  globalThis.history.replaceState(null, "", globalThis.location.pathname);
  return {
    error: returning ? reauthenticationError(params) : null,
    intent,
    reauthentication,
    resume: returning && !params.has("error"),
  };
}

function storePendingReauthentication(value: PendingReauthentication) {
  return writeBrowserStorageJson("sessionStorage", REAUTH_STORAGE_KEY, value);
}

export const browserAgentApprovalMachine = agentApprovalMachine.provide({
  actors: {
    readPageState: fromPromise(() => Promise.resolve(readApprovalPageState())),
    loadAgent: fromPromise(({ input, signal }) =>
      getAgent(input.intent.agentId, signal),
    ),
    loadHost: fromPromise(({ input, signal }) =>
      getAgentHost(input.hostId, signal),
    ),
    decideApproval: fromPromise(async ({ input }) => {
      try {
        await decideAgentApproval({
          agentId: input.intent.agentId,
          code: input.intent.code,
          action: input.action,
        });
      } catch (cause) {
        if (cause instanceof FreshSessionRequiredError) {
          throw new ReauthenticationRequiredError(cause.message);
        }
        throw cause;
      }
    }),
    loadProviders: fromPromise(async () => {
      const accounts = await authClient.listAccounts();
      if (accounts.error) {
        throw new Error("The linked sign-in methods could not be loaded.");
      }
      const linked = new Set(
        (accounts.data ?? []).map((account) => account.providerId),
      );
      return APPROVAL_PROVIDERS.filter((provider) => linked.has(provider));
    }),
    startOAuth: fromPromise(async ({ input }) => {
      if (!storePendingReauthentication(input.pending)) {
        return {
          error: "This browser could not preserve the approval request.",
        };
      }

      const callbackURL = new URL(
        globalThis.location.pathname,
        globalThis.location.origin,
      );
      callbackURL.searchParams.set(REAUTH_RETURN_PARAM, "complete");
      try {
        const response = await authClient.signIn.social({
          provider: input.pending.provider,
          callbackURL: callbackURL.href,
          errorCallbackURL: callbackURL.href,
          additionalData: { flow: REAUTH_FLOW },
          additionalParams: { prompt: "select_account" },
        });
        if (response.error) {
          clearStoredReauthentication();
          return {
            error:
              response.error.message ??
              "Identity confirmation could not start.",
          };
        }
        return { error: null };
      } catch {
        clearStoredReauthentication();
        return {
          error: "Identity confirmation could not start. Try again.",
        };
      }
    }),
  },
});
