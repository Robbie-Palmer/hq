"use client";

import { useMachine } from "@xstate/react";
import { Bot, Check, LoaderCircle, Lock, X } from "lucide-react";
import Link from "next/link";
import { useDebugValue, useEffect, useRef } from "react";
import type { ActorRefFrom, SnapshotFrom } from "xstate";
import {
  AUTH_PROVIDERS,
  type Provider,
  ProviderIcon,
} from "@/components/recipes/auth-providers";
import { Button } from "@/components/ui/button";
import type { AgentDetail } from "@/lib/api/agents";
import { authClient } from "@/lib/auth-client";
import { browserAgentApprovalMachine } from "@/lib/recipes/agent-approval-browser";
import {
  type ApprovalSession,
  createAgentApprovalTrace,
} from "@/lib/recipes/agent-approval-machine";

function dateLabel(value: string | null): string {
  if (!value) return "No expiry supplied";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown expiry";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
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
  const approvalSession: ApprovalSession | null = session
    ? { email: session.user.email, userId: session.user.id }
    : null;
  const traceRef = useRef<ReturnType<typeof createAgentApprovalTrace> | null>(
    null,
  );
  traceRef.current ??= createAgentApprovalTrace("AgentApprovalView");
  const [snapshot, send] = useMachine(browserAgentApprovalMachine, {
    input: { session: approvalSession, sessionPending },
    inspect: traceRef.current.inspect,
  });
  useDebugValue(traceRef.current.format());

  useEffect(() => {
    send({
      type: "SESSION_CHANGED",
      pending: sessionPending,
      session: session
        ? { email: session.user.email, userId: session.user.id }
        : null,
    });
  }, [send, session, sessionPending]);

  return (
    <AgentApprovalContent
      accountEmail={session?.user.email ?? null}
      send={send}
      sessionPending={sessionPending}
      snapshot={snapshot}
    />
  );
}

type ApprovalSnapshot = SnapshotFrom<typeof browserAgentApprovalMachine>;
type ApprovalSend = ActorRefFrom<typeof browserAgentApprovalMachine>["send"];

function AgentApprovalContent({
  accountEmail,
  send,
  sessionPending,
  snapshot,
}: Readonly<{
  accountEmail: string | null;
  send: ApprovalSend;
  sessionPending: boolean;
  snapshot: ApprovalSnapshot;
}>) {
  if (
    sessionPending ||
    snapshot.matches("bootstrapping") ||
    snapshot.matches("routing") ||
    snapshot.matches("waitingForSession") ||
    snapshot.matches("loadingAgent")
  ) {
    return <ApprovalLoading />;
  }

  if (!accountEmail || snapshot.matches("signedOut")) {
    return <SignedOutApproval />;
  }

  if (snapshot.matches("missingIntent")) {
    return <MissingApprovalIntent />;
  }

  if (snapshot.matches("approved") || snapshot.matches("denied")) {
    const result = snapshot.matches("approved") ? "approved" : "denied";
    return <ApprovalResult result={result} />;
  }

  return (
    <ActiveAgentApproval
      accountEmail={accountEmail}
      send={send}
      snapshot={snapshot}
    />
  );
}

function ApprovalLoading() {
  return (
    <output
      aria-label="Loading agent access request"
      className="container mx-auto flex max-w-xl items-center justify-center px-4 py-24"
    >
      <LoaderCircle className="size-6 animate-spin text-[var(--ink-3)]" />
    </output>
  );
}

function SignedOutApproval() {
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

function MissingApprovalIntent() {
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

function ApprovalResult({
  result,
}: Readonly<{ result: "approved" | "denied" }>) {
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

function ActiveAgentApproval({
  accountEmail,
  send,
  snapshot,
}: Readonly<{
  accountEmail: string;
  send: ApprovalSend;
  snapshot: ApprovalSnapshot;
}>) {
  const { agent, host } = snapshot.context;

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
        <ApprovalRequestDetails
          accountEmail={accountEmail}
          agent={agent}
          hostName={host?.name}
        />
      )}
      <ApprovalWorkflowControls send={send} snapshot={snapshot} />
    </ApprovalCard>
  );
}

function ApprovalRequestDetails({
  accountEmail,
  agent,
  hostName,
}: Readonly<{
  accountEmail: string;
  agent: AgentDetail;
  hostName?: string;
}>) {
  const grants = agent.capabilityGrants.filter(
    (grant) => grant.status === "pending",
  );
  return (
    <div className="mt-5 rounded-xl border border-[var(--line-strong)] bg-[var(--paper-warm)] p-4">
      <p className="rt-mono text-[var(--ink-3)]">Requested access</p>
      <ul className="mt-3 space-y-3">
        {grants.map((grant) => (
          <li key={grant.capability}>
            <p className="rt-mono text-[var(--ink)]">{grant.capability}</p>
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
          <dd>{hostName ?? agent.hostId}</dd>
        </div>
        <div className="flex gap-1">
          <dt>Account</dt>
          <dd>{accountEmail}</dd>
        </div>
        <div className="flex gap-1">
          <dt>Access expires</dt>
          <dd>{dateLabel(agent.expiresAt)}</dd>
        </div>
      </dl>
    </div>
  );
}

function ApprovalWorkflowControls({
  send,
  snapshot,
}: Readonly<{ send: ApprovalSend; snapshot: ApprovalSnapshot }>) {
  const { action, agent, error, pendingProvider, reauthentication } =
    snapshot.context;
  const pendingAction = snapshot.matches({
    active: { workflow: "deciding" },
  })
    ? action
    : null;
  const loadingProviders = snapshot.matches({
    active: { workflow: "loadingProviders" },
  });
  const showReauthentication =
    loadingProviders ||
    snapshot.matches({ active: { workflow: "reauthenticating" } });
  return (
    <>
      {error && (
        <p role="alert" className="rt-body mt-4 text-[var(--destructive)]">
          {error}
        </p>
      )}
      {showReauthentication ? (
        <ReauthenticationPrompt
          action={reauthentication?.action ?? action ?? "approve"}
          providers={
            loadingProviders
              ? null
              : ((reauthentication?.providers ?? []) as Provider[])
          }
          pendingProvider={pendingProvider}
          onSelect={(provider) => send({ type: "SELECT_PROVIDER", provider })}
          onCancel={() => send({ type: "CANCEL_REAUTHENTICATION" })}
        />
      ) : (
        <ApprovalActions
          agentAvailable={Boolean(agent)}
          pendingAction={pendingAction}
          onDecide={(nextAction) =>
            send({ type: nextAction === "approve" ? "APPROVE" : "DENY" })
          }
        />
      )}
    </>
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
