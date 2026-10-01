import { Bell, BookHeart, Bot, House, ShoppingBasket } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type {
  AgentApprovalNotification,
  HouseholdNotification,
  InAppNotification,
  RecipeRecommendationNotification,
} from "@/lib/api/notifications";

type RendererProps<T extends InAppNotification = InAppNotification> = Readonly<{
  item: T;
  acting: boolean;
  onAction: (actionKey: string) => void;
}>;

function copyForHousehold(item: HouseholdNotification) {
  const actor = item.actor?.name ?? "Someone";
  const household = item.detail.household.name;
  switch (item.kind) {
    case "household_invited":
      if (item.detail.invitationStatus === "accepted") {
        return `You accepted ${actor}'s invitation to join ${household}.`;
      }
      if (item.detail.invitationStatus === "declined") {
        return `You declined ${actor}'s invitation to join ${household}.`;
      }
      if (item.detail.invitationStatus === "expired") {
        return `${actor}'s invitation to join ${household} expired.`;
      }
      if (item.detail.invitationStatus === "unavailable") {
        return `${actor}'s invitation to join ${household} is no longer available.`;
      }
      return `${actor} invited you to join ${household}.`;
    case "household_removed":
      return `${actor} removed you from ${household}.`;
    case "household_deleted":
      return `${actor} deleted ${household}.`;
    case "household_invite_accepted":
      return `${actor} accepted your invitation to ${household}.`;
    case "household_invite_declined":
      return `${actor} declined your invitation to ${household}.`;
    case "household_member_left":
      return `${actor} left ${household}.`;
    case "shopping_list_shared":
      return `${actor} shared ${household}'s shopping list with you.`;
  }
}

function HouseholdNotificationContent({
  item,
  acting,
  onAction,
}: RendererProps<HouseholdNotification>) {
  const status =
    item.kind === "household_invited" ? item.detail.invitationStatus : null;
  const Icon = item.kind === "shopping_list_shared" ? ShoppingBasket : House;
  return (
    <>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-[var(--ink)] bg-[var(--sage)] text-white">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="rt-body text-[0.95rem] text-[var(--ink-2)]">
          {copyForHousehold(item)}
        </p>
        {item.kind === "shopping_list_shared" && (
          <Button asChild className="mt-2" size="sm">
            <Link href="/recipes/shopping">View shopping list</Link>
          </Button>
        )}
        {item.actions.length > 0 && (
          <div className="mt-2 flex gap-2">
            {item.actions.map((actionKey) => (
              <Button
                key={actionKey}
                size="sm"
                variant={actionKey === "accept" ? "default" : "outline"}
                disabled={acting}
                onClick={() => onAction(actionKey)}
              >
                {actionKey === "accept" ? "Accept" : "Decline"}
              </Button>
            ))}
          </div>
        )}
        {status && status !== "pending" && (
          <p className="rt-mono mt-2 capitalize text-[var(--ink-3)]">
            {status === "unavailable" ? "No longer available" : status}
          </p>
        )}
      </div>
    </>
  );
}

function RecipeRecommendationContent({
  item,
  acting,
  onAction,
}: RendererProps<RecipeRecommendationNotification>) {
  const actor = item.actor?.name ?? "Someone";
  const recipe = item.detail.recipe;
  return (
    <>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-[var(--ink)] bg-[var(--butter)] text-[var(--ink)]">
        <BookHeart className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="rt-body text-[0.95rem] text-[var(--ink-2)]">
          {actor} recommended{" "}
          {recipe.available ? (
            <Link
              href={`/recipes/${encodeURIComponent(recipe.slug)}`}
              className="font-semibold text-[var(--ink)] underline decoration-[var(--terracotta)] underline-offset-2"
            >
              {recipe.title}
            </Link>
          ) : (
            <strong>{recipe.title}</strong>
          )}{" "}
          to you.
        </p>
        {item.actions.includes("add_to_recipe_box") && (
          <Button
            className="mt-2"
            size="sm"
            disabled={acting}
            onClick={() => onAction("add_to_recipe_box")}
          >
            Add to recipe box
          </Button>
        )}
        {item.detail.saved && (
          <p className="rt-mono mt-2 text-[var(--sage)]">
            Added to your recipe box
          </p>
        )}
        {!recipe.available && (
          <p className="rt-mono mt-2 text-[var(--ink-3)]">
            This recipe is no longer available
          </p>
        )}
      </div>
    </>
  );
}

function AgentApprovalContent({
  item,
}: RendererProps<AgentApprovalNotification>) {
  const { agent, capabilities, reviewUrl, status } = item.detail;
  const capabilityList = capabilities.join(", ");
  return (
    <>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-[var(--ink)] bg-[var(--terracotta)] text-white">
        <Bot className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="rt-body text-[0.95rem] text-[var(--ink-2)]">
          <strong className="text-[var(--ink)]">{agent.name}</strong> requested
          delegated access
          {capabilityList ? ` to ${capabilityList}` : ""}.
        </p>
        {reviewUrl && (
          <Button asChild className="mt-2" size="sm">
            <Link href={reviewUrl}>Review request</Link>
          </Button>
        )}
        {status !== "pending" && (
          <p className="rt-mono mt-2 capitalize text-[var(--ink-3)]">
            {status === "unavailable" ? "No longer available" : status}
          </p>
        )}
      </div>
    </>
  );
}

function UnsupportedNotificationContent({ item }: RendererProps) {
  return (
    <>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-[var(--ink)] bg-[var(--paper-warm)] text-[var(--ink-2)]">
        <Bell className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="rt-body text-[0.95rem] text-[var(--ink-2)]">
          New activity ({item.kind.replaceAll("_", " ")}).
        </p>
      </div>
    </>
  );
}

export function NotificationContent(props: RendererProps) {
  if (!props.item.detail) return <UnsupportedNotificationContent {...props} />;
  if (props.item.detail.type === "agent_approval") {
    return (
      <AgentApprovalContent
        {...props}
        item={props.item as AgentApprovalNotification}
      />
    );
  }
  if (props.item.detail.type === "recipe_recommendation") {
    return (
      <RecipeRecommendationContent
        {...props}
        item={props.item as RecipeRecommendationNotification}
      />
    );
  }
  return (
    <HouseholdNotificationContent
      {...props}
      item={props.item as HouseholdNotification}
    />
  );
}
