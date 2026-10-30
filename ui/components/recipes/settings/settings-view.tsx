"use client";

import {
  Bot,
  Home,
  KeyRound,
  Leaf,
  LoaderCircle,
  Lock,
  Scale,
  User,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/generic/styles";
import { AccountPanel } from "./account-panel";
import { AgentsPanel } from "./agents-panel";
import { DietPanel } from "./diet-panel";
import { HouseholdPanel } from "./household-panel";
import { SecurityPanel } from "./security-panel";
import { UnitsPanel } from "./units-panel";

const SECTIONS = [
  { id: "account", label: "Account", icon: User },
  { id: "units", label: "Units & measurements", icon: Scale },
  { id: "household", label: "Household", icon: Home },
  { id: "diet", label: "Your diet", icon: Leaf },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "signin", label: "Sign-in & security", icon: KeyRound },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

export function SettingsView() {
  const { data: session, isPending } = authClient.useSession();
  const [section, setSection] = useState<SectionId>("account");

  // A failed account link redirects back with ?error=<code>; open on the panel
  // that surfaces and clears it so the message isn't hidden behind a tab.
  useEffect(() => {
    const params = new URLSearchParams(globalThis.location.search);
    if (params.has("error")) {
      setSection("signin");
      return;
    }
    const requestedSection = params.get("section");
    if (SECTIONS.some(({ id }) => id === requestedSection)) {
      setSection(requestedSection as SectionId);
    }
  }, []);

  if (isPending) {
    return (
      <div className="container mx-auto flex max-w-5xl items-center justify-center px-4 py-24">
        <LoaderCircle className="size-6 animate-spin text-[var(--ink-3)]" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto max-w-5xl px-4 py-16">
        <div className="mx-auto max-w-md rounded-2xl border border-[var(--line-strong)] bg-[var(--card)] p-8 text-center">
          <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--paper-warm)]">
            <Lock className="size-5 text-[var(--terracotta)]" />
          </span>
          <h1 className="rt-display text-3xl">Log in to open settings.</h1>
          <p className="rt-body mt-2 text-[var(--ink-2)]">
            Use the account menu in the top-right to log in with Google or
            GitHub, then manage your account here.
          </p>
          <Button
            asChild
            className="mt-5 bg-[var(--terracotta)] text-white hover:bg-[var(--terracotta-deep)]"
          >
            <Link href="/recipes">Back to recipes</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-5xl px-4 pt-5 pb-10 md:pt-7 md:pb-14">
      <header className="mb-6">
        <p className="rt-mono text-[var(--terracotta)]">Settings</p>
        <h1 className="rt-display mt-1 text-5xl md:text-6xl">
          Your kitchen, your way.
        </h1>
      </header>

      <div className="grid gap-6 md:grid-cols-[220px_1fr] md:gap-10">
        <nav
          aria-label="Settings sections"
          className="flex gap-2 overflow-x-auto pb-1 md:flex-col md:gap-1 md:overflow-visible md:border-r md:border-[var(--line)] md:pr-4"
        >
          {SECTIONS.map(({ id, label, icon: Icon }) => {
            const on = section === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "rt-body flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-left text-[0.95rem] transition-colors",
                  on
                    ? "bg-[var(--ink)] font-semibold text-[var(--paper)]"
                    : "text-[var(--ink-2)] hover:bg-[var(--paper-warm)]",
                )}
              >
                <Icon className="size-4" />
                {label}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0">
          {section === "account" && <AccountPanel user={session.user} />}
          {section === "units" && <UnitsPanel />}
          {section === "household" && (
            <HouseholdPanel currentUser={session.user} />
          )}
          {section === "diet" && <DietPanel />}
          {section === "agents" && <AgentsPanel />}
          {section === "signin" && (
            <SecurityPanel currentSessionToken={session.session.token} />
          )}
        </div>
      </div>
    </div>
  );
}
