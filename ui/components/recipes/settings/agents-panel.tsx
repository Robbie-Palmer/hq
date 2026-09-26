"use client";

import { isAbortError } from "browser-base/errors";
import { Bot, Clock, LoaderCircle, RotateCcw, ShieldX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  type AgentMutationHistory,
  type AgentSummary,
  listAgentMutations,
  listAgents,
  revokeAgent,
  undoAgentMutation,
} from "@/lib/api/agents";
import { PanelHead } from "./panel-head";

function dateLabel(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function statusLabel(status: AgentSummary["status"]): string {
  if (status === "active") return "Active";
  if (status === "pending") return "Waiting for approval";
  if (status === "expired") return "Expired";
  if (status === "revoked") return "Revoked";
  if (status === "rejected") return "Denied";
  return "Claimed";
}

function canRevoke(agent: AgentSummary): boolean {
  return agent.status === "active" || agent.status === "pending";
}

export function AgentsPanel() {
  const [agents, setAgents] = useState<AgentSummary[] | null>(null);
  const [mutations, setMutations] = useState<AgentMutationHistory[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const loadControllerRef = useRef<AbortController | null>(null);

  async function load(signal?: AbortSignal) {
    setError(null);
    try {
      const [nextAgents, nextMutations] = await Promise.all([
        listAgents(signal),
        listAgentMutations(signal),
      ]);
      setAgents(nextAgents);
      setMutations(nextMutations);
    } catch (cause) {
      if (isAbortError(cause)) return;
      setError(
        cause instanceof Error ? cause.message : "Agents could not be loaded.",
      );
    }
  }

  async function undo(change: AgentMutationHistory) {
    const itemCount = change.items.length;
    if (
      !window.confirm(
        `Undo ${itemCount} pantry ${itemCount === 1 ? "change" : "changes"} made by ${change.agentName ?? "this agent"}?`,
      )
    ) {
      return;
    }
    setUndoingId(change.id);
    setError(null);
    try {
      await undoAgentMutation(change.id);
      await load(loadControllerRef.current?.signal);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The agent change could not be undone.",
      );
    } finally {
      setUndoingId(null);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load the user's agents once when this panel mounts
  useEffect(() => {
    const controller = new AbortController();
    loadControllerRef.current = controller;
    void load(controller.signal);
    return () => {
      controller.abort();
      loadControllerRef.current = null;
    };
  }, []);

  async function revoke(agent: AgentSummary) {
    if (
      !window.confirm(`Revoke ${agent.name}? Its access will stop immediately.`)
    ) {
      return;
    }
    setRevokingId(agent.id);
    setError(null);
    try {
      await revokeAgent(agent.id);
      setAgents(
        (current) =>
          current?.map((item) =>
            item.id === agent.id ? { ...item, status: "revoked" } : item,
          ) ?? null,
      );
      const signal = loadControllerRef.current?.signal;
      if (signal) await load(signal);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Agent access could not be revoked.",
      );
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div>
      <PanelHead
        kicker="AGENTS"
        title="Who can read your cooking data."
        sub="Each agent has its own access grant. Revoking one agent leaves your other agents and signed-in devices alone."
      />

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-[var(--berry)]/40 bg-[var(--card)] p-4 text-[var(--berry)]"
        >
          <p className="rt-body">{error}</p>
          {agents === null && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void load()}
            >
              Try again
            </Button>
          )}
        </div>
      )}

      {agents === null && !error && (
        <output
          aria-label="Loading agents"
          className="flex items-center gap-2 py-4 text-[var(--ink-3)]"
        >
          <LoaderCircle className="size-4 animate-spin" />
          <span className="rt-mono">Checking agent access…</span>
        </output>
      )}

      {agents?.length === 0 && (
        <div className="rounded-xl border border-dashed border-[var(--line-strong)] bg-[var(--card)] p-6 text-center">
          <Bot className="mx-auto size-6 text-[var(--terracotta)]" />
          <p className="rt-display mt-3 text-3xl">No agents connected.</p>
          <p className="rt-body mx-auto mt-2 max-w-lg text-sm text-[var(--ink-2)]">
            Agents can help find recipes and make sense of your cooking history.
            Access is read-only for now, so an agent cannot change anything.
          </p>
          <p className="rt-body mx-auto mt-3 max-w-lg text-sm text-[var(--ink-3)]">
            Start the connection from an Agent Auth-compatible app. You will get
            an approval request here showing exactly what it wants to read.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {agents?.map((agent) => {
          const grants = agent.capabilityGrants.filter(
            (grant) => grant.status === "active" || grant.status === "pending",
          );
          return (
            <article
              key={agent.id}
              className="rounded-xl border border-[var(--line-strong)] bg-[var(--card)] p-4 shadow-[var(--paper-shadow)]"
            >
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--paper-warm)] text-[var(--terracotta-deep)]">
                  <Bot className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="rt-display text-2xl">{agent.name}</h3>
                    <span className="rt-mono text-[var(--ink-3)]">
                      {statusLabel(agent.status)}
                    </span>
                  </div>
                  <p className="rt-body mt-0.5 text-sm text-[var(--ink-2)]">
                    Hosted by {agent.hostName}
                  </p>

                  {grants.length > 0 && (
                    <ul
                      aria-label={`${agent.name} capabilities`}
                      className="mt-3 flex flex-wrap gap-2"
                    >
                      {grants.map((grant) => (
                        <li
                          key={`${grant.capability}:${grant.status}`}
                          className="rt-mono rounded-full border border-[var(--line)] bg-[var(--paper-warm)] px-2.5 py-1 text-xs text-[var(--ink-2)]"
                        >
                          {grant.capability}
                        </li>
                      ))}
                    </ul>
                  )}

                  <dl className="rt-mono mt-3 grid gap-1 text-xs text-[var(--ink-3)] sm:grid-cols-2">
                    <div className="flex items-center gap-1.5">
                      <Clock className="size-3" />
                      <dt>Last used</dt>
                      <dd>{dateLabel(agent.lastUsedAt)}</dd>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock className="size-3" />
                      <dt>Expires</dt>
                      <dd>{dateLabel(agent.expiresAt)}</dd>
                    </div>
                  </dl>
                </div>
              </div>

              {canRevoke(agent) && (
                <div className="mt-4 border-t border-dashed border-[var(--line)] pt-3 text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-[var(--terracotta-deep)]"
                    disabled={revokingId !== null}
                    onClick={() => void revoke(agent)}
                  >
                    {revokingId === agent.id ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <ShieldX />
                    )}
                    Revoke access
                  </Button>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {mutations && mutations.length > 0 && (
        <section className="mt-8 border-t border-[var(--line)] pt-6">
          <p className="rt-mono text-[var(--terracotta)]">RECENT CHANGES</p>
          <h3 className="rt-display mt-1 text-3xl">Agent activity</h3>
          <div className="mt-4 space-y-3">
            {mutations.map((change) => (
              <article
                key={change.id}
                className="rounded-xl border border-[var(--line-strong)] bg-[var(--card)] p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="rt-body font-semibold">
                      {change.compensatesChangeSetId
                        ? "Change undone"
                        : (change.agentName ?? "Recipe agent")}
                    </p>
                    <p className="rt-body mt-1 text-sm text-[var(--ink-2)]">
                      {change.reason}
                    </p>
                    <p className="rt-mono mt-2 text-xs text-[var(--ink-3)]">
                      {change.items.length}{" "}
                      {change.items.length === 1 ? "item" : "items"} ·{" "}
                      {dateLabel(change.createdAt)}
                    </p>
                  </div>
                  {change.actorType === "agent" &&
                    !change.compensatesChangeSetId && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={undoingId !== null}
                        onClick={() => void undo(change)}
                      >
                        {undoingId === change.id ? (
                          <LoaderCircle className="animate-spin" />
                        ) : (
                          <RotateCcw />
                        )}
                        Undo
                      </Button>
                    )}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
