"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Home, Settings, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CookConnectionList } from "@/components/recipes/cook-connection-list";
import { RecipeAvatar } from "@/components/recipes/recipe-avatar";
import { Button } from "@/components/ui/button";
import {
  getHouseholdMembers,
  getHouseholds,
  type Household,
  type HouseholdMember,
} from "@/lib/api/households";
import { authClient } from "@/lib/auth-client";
import { ownCookConnectionsQuery } from "@/lib/query/public-cook-queries";

type ProfileData = {
  household: Household | null;
  members: HouseholdMember[];
  profile: HouseholdMember["user"];
  role: HouseholdMember["role"] | null;
};

function loadErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "We couldn't load this profile.";
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
export function ProfileView({ userId }: Readonly<{ userId?: string | null }>) {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const [data, setData] = useState<ProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const ownConnectionsEnabled = Boolean(
    session && (!userId || userId === session.user.id),
  );
  const ownConnections = useQuery({
    ...ownCookConnectionsQuery(session?.user.id ?? "anonymous"),
    enabled: ownConnectionsEnabled,
  });

  useEffect(() => {
    if (sessionPending) return;
    if (!session) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const currentUserId = session.user.id;

    void getHouseholds(controller.signal)
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
      .then(async (households) => {
        const household = households[0];
        const selectedUserId = userId || currentUserId;
        if (!household) {
          if (selectedUserId !== currentUserId) {
            throw new Error("This profile isn't part of your household.");
          }
          if (!controller.signal.aborted) {
            setData({
              household: null,
              members: [],
              profile: {
                id: session.user.id,
                email: session.user.email,
                name: session.user.name,
                image: session.user.image ?? null,
              },
              role: null,
            });
          }
          return;
        }
        const members = await getHouseholdMembers(
          household.id,
          controller.signal,
        );
        const membership = members.find(
          (member) => member.user.id === selectedUserId,
        );
        if (!membership) {
          throw new Error("This profile isn't part of your household.");
        }
        if (!controller.signal.aborted) {
          setData({
            household,
            members,
            profile: membership.user,
            role: membership.role,
          });
        }
      })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) setError(loadErrorMessage(loadError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [session, sessionPending, userId]);

  if (
    sessionPending ||
    loading ||
    (ownConnectionsEnabled && ownConnections.isPending)
  ) {
    return (
      <div className="container mx-auto flex max-w-5xl flex-1 items-center justify-center px-4 py-20">
        <p className="rt-mono text-[var(--ink-3)]">Loading kitchen profile…</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto max-w-xl flex-1 px-4 py-20 text-center">
        <p className="rt-mono text-[var(--terracotta)]">Profile</p>
        <h1 className="rt-display mt-3 text-5xl">
          Log in to meet your household.
        </h1>
        <p className="rt-body mt-4 text-[var(--ink-2)]">
          Household profiles are shared only with the people you cook with.
        </p>
      </div>
    );
  }

  if (!data || error) {
    return (
      <div className="container mx-auto max-w-xl flex-1 px-4 py-20 text-center">
        <p className="rt-mono text-[var(--terracotta)]">Profile unavailable</p>
        <h1 className="rt-display mt-3 text-5xl">Nothing cooking here yet.</h1>
        <p className="rt-body mt-4 text-[var(--ink-2)]">{error}</p>
        <Button asChild variant="outline" className="mt-6">
          <Link href="/recipes/settings?section=household">
            Household settings
          </Link>
        </Button>
      </div>
    );
  }

  const { household, members, profile, role } = data;
  const currentUserId = session.user.id;
  const isSelf = profile.id === currentUserId;
  const firstName = profile.name.trim().split(/\s+/)[0] || "Chef";

  return (
    <div className="container mx-auto w-full max-w-5xl flex-1 px-4 py-8 md:py-12">
      <header className="flex flex-col gap-5 border-b border-dashed border-[var(--line-strong)] pb-8 sm:flex-row sm:items-center">
        <RecipeAvatar
          name={profile.name}
          email={profile.email}
          image={profile.image}
          size={88}
          className="shadow-[var(--paper-shadow)]"
        />
        <div className="min-w-0 flex-1">
          <p className="rt-mono text-[var(--terracotta)]">
            {isSelf ? "Your profile" : "Household profile"}
            {role ? ` · ${role}` : ""}
          </p>
          <h1 className="rt-display mt-2 text-5xl sm:text-6xl">
            {firstName}&apos;s{" "}
            <span className="text-[var(--terracotta)]">kitchen.</span>
          </h1>
          <p className="rt-body mt-2 text-sm text-[var(--ink-2)]">
            {isSelf
              ? "Your home for the recipes and people you cook with."
              : `You and ${firstName} share ${household?.name}.`}
          </p>
        </div>
        {isSelf && (
          <Button asChild variant="outline">
            <Link href="/recipes/settings">
              <Settings /> Settings
            </Link>
          </Button>
        )}
      </header>

      {isSelf && ownConnections.data ? (
        <section aria-label="Cook connections" className="mt-8">
          <div className="grid gap-3 sm:grid-cols-2">
            <CookConnectionList
              label="Followers"
              cooks={ownConnections.data.followers}
              count={ownConnections.data.followersCount}
            />
            <CookConnectionList
              label="Following"
              cooks={ownConnections.data.following}
              count={ownConnections.data.followingCount}
            />
          </div>
        </section>
      ) : null}

      {isSelf && ownConnections.error ? (
        <p
          role="alert"
          className="rt-body mt-8 rounded-xl border border-dashed border-[var(--line-strong)] p-4 text-sm text-[var(--terracotta-deep)]"
        >
          {loadErrorMessage(ownConnections.error)}
        </p>
      ) : null}

      {household && (
        <section className="mt-8 rounded-xl border border-[var(--line-strong)] bg-[var(--card)] p-5 shadow-[var(--paper-shadow)] sm:p-6">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--paper-warm)] text-[var(--terracotta-deep)]">
              <Home aria-hidden="true" className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="rt-mono text-[var(--terracotta)]">Household</p>
              <h2 className="rt-display mt-1 text-3xl">{household.name}</h2>
              <p className="rt-body mt-1 text-sm text-[var(--ink-3)]">
                {members.length} {members.length === 1 ? "person" : "people"}{" "}
                sharing a kitchen
              </p>
            </div>
            <Users aria-hidden="true" className="size-5 text-[var(--ink-3)]" />
          </div>

          <div className="mt-5 divide-y divide-dashed divide-[var(--line)] border-t border-dashed border-[var(--line)]">
            {members.map((member) => {
              const memberIsSelf = member.user.id === currentUserId;
              const active = member.user.id === profile.id;
              return (
                <Link
                  key={member.id}
                  href={`/recipes/profile?user=${encodeURIComponent(member.user.id)}`}
                  aria-current={active ? "page" : undefined}
                  className="group flex items-center gap-3 rounded-lg px-2 py-4 transition-colors hover:bg-[var(--paper-warm)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--terracotta)]"
                >
                  <RecipeAvatar
                    name={member.user.name}
                    email={member.user.email}
                    image={member.user.image}
                    size={44}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="rt-body truncate font-semibold text-[var(--ink)]">
                      {member.user.name}
                      {memberIsSelf ? " · you" : ""}
                    </p>
                    <p className="rt-mono text-[var(--ink-3)]">{member.role}</p>
                  </div>
                  {active ? (
                    <span className="rt-mono rounded-full bg-[var(--sage)] px-2 py-1 text-white">
                      Viewing
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-sm text-[var(--ink-3)] group-hover:text-[var(--terracotta-deep)]">
                      View profile{" "}
                      <ArrowRight aria-hidden="true" className="size-4" />
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
