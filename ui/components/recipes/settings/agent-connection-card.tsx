"use client";

import { Check, Clipboard, LoaderCircle, PlugZap } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type AgentHostEnrollment,
  createAgentHostEnrollment,
} from "@/lib/api/agents";

function expiryLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function AgentConnectionCard() {
  const [hostName, setHostName] = useState("Codex");
  const [enrollment, setEnrollment] = useState<AgentHostEnrollment | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  async function createConnection() {
    const name = hostName.trim();
    if (!name) return;
    setError(null);
    setIsCreating(true);
    try {
      const created = await createAgentHostEnrollment(name);
      setEnrollment(created);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The agent connection code could not be created.",
      );
    } finally {
      setIsCreating(false);
    }
  }

  async function copyCode() {
    if (!enrollment) return;
    try {
      await navigator.clipboard.writeText(enrollment.token);
      setCopied(true);
      setError(null);
    } catch {
      setCopied(false);
      setError("The code could not be copied. Select it manually instead.");
    }
  }

  return (
    <section className="mb-6 rounded-xl border border-[var(--line-strong)] bg-[var(--card)] p-5 shadow-[var(--paper-shadow)]">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--paper-warm)] text-[var(--terracotta-deep)]">
          <PlugZap className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="rt-display text-2xl">Connect an agent host</h3>
          <p className="rt-body mt-1 text-sm text-[var(--ink-2)]">
            Create a one-use code, then give it to the agent host you want to
            connect. The code expires after one hour.
          </p>
        </div>
      </div>

      {!enrollment && (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label htmlFor="agent-host-name" className="min-w-0 flex-1">
            <span className="rt-mono text-xs text-[var(--ink-3)]">
              Host name
            </span>
            <Input
              id="agent-host-name"
              value={hostName}
              maxLength={100}
              className="mt-1"
              onChange={(event) => setHostName(event.target.value)}
            />
          </label>
          <Button
            type="button"
            disabled={isCreating || hostName.trim().length === 0}
            onClick={() => void createConnection()}
          >
            {isCreating && <LoaderCircle className="animate-spin" />}
            Create connection code
          </Button>
        </div>
      )}

      {enrollment && (
        <div className="mt-4 space-y-3">
          <p className="rt-body text-sm text-[var(--ink-2)]">
            Give this code to your agent before{" "}
            {expiryLabel(enrollment.expiresAt)}. It binds that host to your
            account but does not grant pantry access yet.
          </p>
          <div className="rounded-lg border border-[var(--line)] bg-[var(--paper-warm)] p-3">
            <code className="rt-mono block break-all text-xs text-[var(--ink-2)]">
              {enrollment.token}
            </code>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void copyCode()}
            >
              {copied ? <Check /> : <Clipboard />}
              {copied ? "Copied" : "Copy code"}
            </Button>
            <p className="rt-body text-sm text-[var(--ink-3)]">
              After enrollment, the agent will ask you to approve each
              capability it needs.
            </p>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="rt-body mt-3 text-sm text-[var(--berry)]">
          {error}
        </p>
      )}
    </section>
  );
}
