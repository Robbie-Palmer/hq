"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Link2, Loader2, Share2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { RecipeAvatar } from "@/components/recipes/recipe-avatar";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  getHouseholdMembers,
  type HouseholdMember,
} from "@/lib/api/households";
import {
  type ShoppingListScope,
  shareCurrentShoppingList,
} from "@/lib/api/shopping-lists";
import { authClient } from "@/lib/auth-client";
import { recipeQueryKeys } from "@/lib/query/recipe-query-keys";

type HouseholdShoppingListScope = Extract<
  ShoppingListScope,
  { type: "household" }
>;

export function ShareShoppingList({
  scope,
}: Readonly<{ scope: HouseholdShoppingListScope }>) {
  const [open, setOpen] = useState(false);
  const { data: session } = authClient.useSession();
  const userId = session?.user.id ?? "pending";
  const members = useQuery({
    queryKey: recipeQueryKeys.householdMembers(userId, scope.household.id),
    queryFn: ({ signal }) => getHouseholdMembers(scope.household.id, signal),
    enabled: open && Boolean(session),
    staleTime: 30_000,
  });
  const share = useMutation({
    mutationFn: (member: HouseholdMember) =>
      shareCurrentShoppingList(member.user.id),
    onSuccess: (_result, member) => {
      toast.success(`${member.user.name} has been notified`);
      setOpen(false);
    },
    onError: () => {
      toast.error("The shopping list could not be shared.");
    },
  });
  const recipients =
    members.data?.filter((member) => member.user.id !== session?.user.id) ?? [];

  const copyLink = async () => {
    try {
      const url = new URL("/recipes/shopping", window.location.origin);
      await navigator.clipboard.writeText(url.toString());
      toast.success("Household shopping list link copied");
      setOpen(false);
    } catch {
      toast.error("The household shopping list link could not be copied.");
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rt-mono text-[var(--ink-3)] hover:text-[var(--terracotta)] transition-colors"
        >
          <Share2 className="h-3.5 w-3.5" /> share
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <p className="rt-display text-xl text-[var(--ink)]">
          Share shopping list
        </p>
        <p className="rt-body mt-1 text-sm text-[var(--ink-3)]">
          Notify someone in {scope.household.name}, or copy the link for another
          app.
        </p>

        <div className="mt-3 space-y-1">
          {members.isPending && (
            <p className="rt-body flex items-center gap-2 py-3 text-sm text-[var(--ink-3)]">
              <Loader2 className="size-4 animate-spin" /> Loading household
            </p>
          )}
          {members.isError && (
            <p
              role="alert"
              className="rt-body py-2 text-sm text-[var(--berry)]"
            >
              Household members could not be loaded.
            </p>
          )}
          {members.isSuccess && recipients.length === 0 && (
            <p className="rt-body py-2 text-sm text-[var(--ink-3)]">
              There is nobody else in this household yet.
            </p>
          )}
          {recipients.map((member) => (
            <button
              key={member.id}
              type="button"
              disabled={share.isPending}
              onClick={() => share.mutate(member)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-[var(--paper-warm)] disabled:opacity-50"
              aria-label={`Share with ${member.user.name}`}
            >
              <RecipeAvatar
                name={member.user.name}
                email={member.user.email}
                image={member.user.image}
                size={34}
              />
              <span className="min-w-0 flex-1">
                <span className="rt-body block truncate font-semibold">
                  {member.user.name}
                </span>
                <span className="rt-mono block truncate text-[var(--ink-3)]">
                  {member.user.email}
                </span>
              </span>
              {share.isPending && share.variables.id === member.id ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
            </button>
          ))}
        </div>

        <div className="mt-3 border-t border-[var(--line)] pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={copyLink}
            className="w-full justify-start text-[var(--ink-2)]"
          >
            <Link2 /> Copy link
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
