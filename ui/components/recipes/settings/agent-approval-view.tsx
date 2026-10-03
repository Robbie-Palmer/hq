"use client";

import { isAbortError } from "browser-base/errors";
import { Bot, Check, LoaderCircle, Lock, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AUTH_PROVIDERS,
  type Provider,
  ProviderIcon,
} from "@/components/recipes/auth-providers";
import { Button } from "@/components/ui/button";
import {
  type AgentDetail,
  type AgentHost,
  decideAgentApproval,
  FreshSessionRequiredError,
  getAgent,
  getAgentHost,
} from "@/lib/api/agents";
import { authClient } from "@/lib/auth-client";

type ApprovalIntent = {
  agentId: string;
  code: string;
};

type PendingReauthentication = ApprovalIntent & {
  action: "approve" | "deny";
  createdAt: number;
  provider: Provider;
  userId: string;
};

type ApprovalPageState = {
  error: string | null;
  intent: ApprovalIntent | null;
  reauthentication: PendingReauthentication | null;
  resume: boolean;
};

const REAUTH_FLOW = "agent-approval";
const REAUTH_RETURN_PARAM = "agent_reauth";
const REAUTH_STORAGE_KEY = "recipe-agent-approval-reauth:v1";
const REAUTH_MAX_AGE_MS = 15 * 60 * 1000;

function isProvider(value: unknown): value is Provider {
  return value === "google" || value === "github";
}

function clearStoredReauthentication() {
  try {
    globalThis.sessionStorage.removeItem(REAUTH_STORAGE_KEY);
  } catch {
    // The in-memory approval state still lets the user retry this page.
  }
}

function readStoredReauthentication(): PendingReauthentication | null {
  try {
    const raw = globalThis.sessionStorage.getItem(REAUTH_STORAGE_KEY);
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
  const intent =
    agentId && code
      ? { agentId, code }
      : reauthentication
        ? {
            agentId: reauthentication.agentId,
            code: reauthentication.code,
          }
        : null;

  globalThis.history.replaceState(null, "", globalThis.location.pathname);
  return {
    error: returning ? reauthenticationError(params) : null,
    intent,
    reauthentication,
    resume: returning && !params.has("error"),
  };
}

function storePendingReauthentication(value: PendingReauthentication): boolean {
  try {
    globalThis.sessionStorage.setItem(
      REAUTH_STORAGE_KEY,
      JSON.stringify(value),
    );
    return true;
  } catch {
    return false;
  }
}

function dateLabel(value: string | null): string {
  if (!value) return "No expiry supplied";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown expiry";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

async function loadApprovalRequest(
  intent: ApprovalIntent,
  signal: AbortSignal,
  onAgent: (agent: AgentDetail) => void,
): Promise<AgentHost | null> {
  const loadedAgent = await getAgent(intent.agentId, signal);
  if (signal.aborted) return null;
  onAgent(loadedAgent);
  try {
    return await getAgentHost(loadedAgent.hostId, signal);
  } catch (cause) {
    if (isAbortError(cause)) throw cause;
    return null;
  }
}

function approvalResult(action: "approve" | "deny") {
  return action === "approve" ? "approved" : "denied";
}

function approvalError(cause: unknown) {
  return cause instanceof Error
    ? cause.message
    : "The approval decision could not be saved.";
}

function ApprovalActions({
  agentAvailable,
  onDecide,
  pendingAction,
}: Readonly<{
  agentAvailable: boolean;
  onDecide: (action: "approve" | "deny") => void;
  pendingAction: "approve" | "deny" | null;
}>) {
  return (
    <div className="mt-6 flex flex-wrap gap-3">
      <Button
        type="button"
        onClick={() => onDecide("approve")}
        disabled={!agentAvailable || pendingAction !== null}
        className="bg-[var(--terracotta)] text-white hover:bg-[var(--terracotta-deep)]"
      >
        {pendingAction === "approve" && (
          <LoaderCircle className="size-4 animate-spin" />
        )}
        Approve access
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={() => onDecide("deny")}
        disabled={pendingAction !== null}
      >
        {pendingAction === "deny" && (
          <LoaderCircle className="size-4 animate-spin" />
        )}
        Deny
      </Button>
    </div>
  );
}

function ReauthenticationPrompt({
  action,
  onCancel,
  onSelect,
  pendingProvider,
  providers,
}: Readonly<{
  action: "approve" | "deny";
  onCancel: () => void;
  onSelect: (provider: Provider) => void;
  pendingProvider: Provider | null;
  providers: Provider[] | null;
}>) {
  return (
    <div className="mt-6 rounded-xl border border-[var(--line-strong)] bg-[var(--paper-warm)] p-4">
      <div className="flex gap-3">
        <Lock className="mt-0.5 size-5 shrink-0 text-[var(--terracotta)]" />
        <div>
          <h2 className="rt-display text-xl">Confirm it's you</h2>
          <p className="rt-body mt-1 text-sm text-[var(--ink-2)]">
            Choose a linked sign-in account. You will return here and the
            {action === "approve" ? " approval" : " denial"} will continue.
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {providers === null ? (
          <output
            aria-label="Loading sign-in methods"
            className="flex items-center gap-2 text-sm text-[var(--ink-3)]"
          >
            <LoaderCircle className="size-4 animate-spin" />
            Loading sign-in methods…
          </output>
        ) : (
          providers.map((providerId) => {
            const provider = AUTH_PROVIDERS.find(
              (candidate) => candidate.id === providerId,
            );
            if (!provider) return null;
            return (
              <Button
                key={provider.id}
                type="button"
                variant="outline"
                disabled={pendingProvider !== null}
                onClick={() => onSelect(provider.id)}
              >
                {pendingProvider === provider.id ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <ProviderIcon path={provider.iconPath} />
                )}
                Confirm with {provider.name}
              </Button>
            );
          })
        )}
        <Button
          type="button"
          variant="ghost"
          disabled={pendingProvider !== null}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function AgentApprovalView() {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const initialized = useRef(false);
  const [intent, setIntent] = useState<ApprovalIntent | null | undefined>();
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [host, setHost] = useState<AgentHost | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<"approve" | "deny" | null>(
    null,
  );
  const [result, setResult] = useState<"approved" | "denied" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reauthentication, setReauthentication] = useState<{
    action: "approve" | "deny";
    providers: Provider[] | null;
    userId: string;
  } | null>(null);
  const [resumeAction, setResumeAction] =
    useState<PendingReauthentication | null>(null);
  const [pendingProvider, setPendingProvider] = useState<Provider | null>(null);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const pageState = readApprovalPageState();
    setIntent(pageState.intent);
    setError(pageState.error);
    if (pageState.reauthentication) {
      if (pageState.resume) {
        setResumeAction(pageState.reauthentication);
      } else {
        setReauthentication({
          action: pageState.reauthentication.action,
          providers: [pageState.reauthentication.provider],
          userId: pageState.reauthentication.userId,
        });
      }
    }
  }, []);

  useEffect(() => {
    if (!session || !intent) return;
    const controller = new AbortController();
    setLoading(true);

    void loadApprovalRequest(intent, controller.signal, (loadedAgent) => {
      setAgent(loadedAgent);
      setLoading(false);
    })
      .then((loadedHost) => {
        if (!controller.signal.aborted) setHost(loadedHost);
      })
      .catch((cause: unknown) => {
        if (isAbortError(cause)) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "The agent request could not be loaded.",
        );
        setLoading(false);
      });

    return () => controller.abort();
  }, [intent, session]);

  const prepareReauthentication = useCallback(
    async (action: "approve" | "deny", userId: string) => {
      setReauthentication({ action, providers: null, userId });
      const accounts = await authClient.listAccounts().catch(() => null);
      if (!accounts) {
        setReauthentication(null);
        setError("Your sign-in methods could not be loaded. Try again.");
        return;
      }
      if (accounts.error) {
        setReauthentication(null);
        setError("Your sign-in methods could not be loaded. Try again.");
        return;
      }
      const linked = new Set(
        (accounts.data ?? []).map((account) => account.providerId),
      );
      const providers = AUTH_PROVIDERS.map((provider) => provider.id).filter(
        (provider) => linked.has(provider),
      );
      if (providers.length === 0) {
        setReauthentication(null);
        setError("No linked sign-in method can confirm your identity.");
        return;
      }
      setReauthentication({ action, providers, userId });
    },
    [],
  );

  const decide = useCallback(
    async (action: "approve" | "deny") => {
      if (!intent || !session) return;
      setPendingAction(action);
      setError(null);
      try {
        await decideAgentApproval({
          agentId: intent.agentId,
          code: intent.code,
          action,
        });
        setResult(approvalResult(action));
      } catch (cause) {
        if (cause instanceof FreshSessionRequiredError) {
          await prepareReauthentication(action, session.user.id);
          return;
        }
        setError(approvalError(cause));
      } finally {
        setPendingAction(null);
      }
    },
    [intent, prepareReauthentication, session],
  );

  useEffect(() => {
    if (!resumeAction || !agent || !session || pendingAction || result) return;
    setResumeAction(null);
    if (session.user.id !== resumeAction.userId) {
      setError("Use the same account that started this approval request.");
      setReauthentication({
        action: resumeAction.action,
        providers: [resumeAction.provider],
        userId: resumeAction.userId,
      });
      return;
    }
    void decide(resumeAction.action);
  }, [agent, decide, pendingAction, result, resumeAction, session]);

  async function startReauthentication(provider: Provider) {
    if (!intent || !reauthentication) return;
    const stored = storePendingReauthentication({
      ...intent,
      action: reauthentication.action,
      createdAt: Date.now(),
      provider,
      userId: reauthentication.userId,
    });
    if (!stored) {
      setError("This browser could not preserve the approval request.");
      return;
    }

    setPendingProvider(provider);
    setError(null);
    const callbackURL = new URL(
      globalThis.location.pathname,
      globalThis.location.origin,
    );
    callbackURL.searchParams.set(REAUTH_RETURN_PARAM, "complete");
    try {
      const response = await authClient.signIn.social({
        provider,
        callbackURL: callbackURL.href,
        errorCallbackURL: callbackURL.href,
        additionalData: { flow: REAUTH_FLOW },
        additionalParams: { prompt: "select_account" },
      });
      if (response.error) {
        clearStoredReauthentication();
        setError(
          response.error.message ?? "Identity confirmation could not start.",
        );
      }
    } catch {
      clearStoredReauthentication();
      setError("Identity confirmation could not start. Try again.");
    } finally {
      setPendingProvider(null);
    }
  }

  if (sessionPending || intent === undefined || loading) {
    return (
      <output
        aria-label="Loading agent access request"
        className="container mx-auto flex max-w-xl items-center justify-center px-4 py-24"
      >
        <LoaderCircle className="size-6 animate-spin text-[var(--ink-3)]" />
      </output>
    );
  }

  if (!session) {
    return (
      <ApprovalCard
        icon={<Lock className="size-5" />}
        title="Log in to review this request."
      >
        <p className="rt-body text-[var(--ink-2)]">
          Use the account menu above, then reopen the approval link from your
          agent host.
        </p>
      </ApprovalCard>
    );
  }

  if (!intent) {
    return (
      <ApprovalCard
        icon={<X className="size-5" />}
        title="This approval link is incomplete."
      >
        <p className="rt-body text-[var(--ink-2)]">
          Start the connection again from the agent host to get a fresh link.
        </p>
      </ApprovalCard>
    );
  }

  if (result) {
    return (
      <ApprovalCard
        icon={<Check className="size-5" />}
        title={`Agent access ${result}.`}
      >
        <p className="rt-body text-[var(--ink-2)]">
          You can close this page and return to the agent host.
        </p>
        <Button asChild variant="outline" className="mt-5">
          <Link href="/recipes">Back to recipes</Link>
        </Button>
      </ApprovalCard>
    );
  }

  return (
    <ApprovalCard
      icon={<Bot className="size-5" />}
      title={agent ? `Allow ${agent.name}?` : "Review agent access"}
    >
      <p className="rt-body text-[var(--ink-2)]">
        This agent will act as you, but only for the capabilities listed below.
        It will not receive your browser session.
      </p>

      {agent && (
        <div className="mt-5 rounded-xl border border-[var(--line-strong)] bg-[var(--paper-warm)] p-4">
          <p className="rt-mono text-[var(--ink-3)]">Requested access</p>
          <ul className="mt-3 space-y-3">
            {agent.capabilityGrants
              .filter((grant) => grant.status === "pending")
              .map((grant) => (
                <li key={grant.capability}>
                  <p className="rt-mono text-[var(--ink)]">
                    {grant.capability}
                  </p>
                  {grant.description && (
                    <p className="rt-body mt-0.5 text-sm text-[var(--ink-2)]">
                      {grant.description}
                    </p>
                  )}
                </li>
              ))}
          </ul>
          <dl className="rt-mono mt-4 space-y-1 text-xs text-[var(--ink-3)]">
            <div className="flex gap-1">
              <dt>Host</dt>
              <dd>{host?.name ?? agent.hostId}</dd>
            </div>
            <div className="flex gap-1">
              <dt>Account</dt>
              <dd>{session.user.email}</dd>
            </div>
            <div className="flex gap-1">
              <dt>Access expires</dt>
              <dd>{dateLabel(agent.expiresAt)}</dd>
            </div>
          </dl>
        </div>
      )}

      {error && (
        <p role="alert" className="rt-body mt-4 text-[var(--destructive)]">
          {error}
        </p>
      )}

      {reauthentication ? (
        <ReauthenticationPrompt
          action={reauthentication.action}
          providers={reauthentication.providers}
          pendingProvider={pendingProvider}
          onSelect={(provider) => void startReauthentication(provider)}
          onCancel={() => setReauthentication(null)}
        />
      ) : (
        <ApprovalActions
          agentAvailable={Boolean(agent)}
          pendingAction={pendingAction}
          onDecide={(action) => void decide(action)}
        />
      )}
    </ApprovalCard>
  );
}

function ApprovalCard({
  children,
  icon,
  title,
}: Readonly<{
  children: React.ReactNode;
  icon: React.ReactNode;
  title: string;
}>) {
  return (
    <div className="container mx-auto max-w-xl px-4 py-16">
      <div className="rounded-2xl border border-[var(--line-strong)] bg-[var(--card)] p-6 sm:p-8">
        <span className="mb-4 flex size-12 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--paper-warm)] text-[var(--terracotta)]">
          {icon}
        </span>
        <p className="rt-mono text-[var(--terracotta)]">Agent access</p>
        <h1 className="rt-display mt-1 text-4xl">{title}</h1>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
