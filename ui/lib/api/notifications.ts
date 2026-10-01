import { apiRequest } from "@/lib/api/http";

export type HouseholdNotificationKind =
  | "household_invited"
  | "household_removed"
  | "household_deleted"
  | "household_invite_accepted"
  | "household_invite_declined"
  | "household_member_left"
  | "shopping_list_shared";

type NotificationBase = {
  id: string;
  eventId: string;
  kind: string;
  actor: { id: string | null; name: string | null } | null;
  actions: string[];
  readAt: string | null;
  occurredAt: string;
};

export type HouseholdNotification = NotificationBase & {
  kind: HouseholdNotificationKind;
  detail: {
    type: "household";
    household: { id: string | null; name: string };
    invitationStatus:
      | "pending"
      | "accepted"
      | "declined"
      | "expired"
      | "unavailable"
      | null;
  };
};

export type RecipeRecommendationNotification = NotificationBase & {
  kind: "recipe_recommended";
  detail: {
    type: "recipe_recommendation";
    recipe: {
      slug: string;
      title: string;
      available: boolean;
    };
    saved: boolean;
  };
};

export type AgentApprovalNotification = NotificationBase & {
  kind: "agent_approval_requested";
  detail: {
    type: "agent_approval";
    agent: { id: string; name: string };
    capabilities: string[];
    status: "pending" | "approved" | "denied" | "expired" | "unavailable";
    expiresAt: string;
    reviewUrl: string | null;
  };
};

export type UnsupportedNotification = NotificationBase & {
  detail: null;
};

export type InAppNotification =
  | AgentApprovalNotification
  | HouseholdNotification
  | RecipeRecommendationNotification
  | UnsupportedNotification;

export type NotificationPage = {
  items: InAppNotification[];
  nextOffset: number | null;
  unreadCount: number;
};

export async function getNotificationPage(
  offset = 0,
  signal?: AbortSignal,
): Promise<NotificationPage> {
  return apiRequest(`/api/notifications?offset=${offset}`, {
    signal,
    fallbackMessage: "Notification request failed.",
  });
}

export async function getUnreadNotificationCount(
  signal?: AbortSignal,
): Promise<number> {
  const response = await apiRequest<{ unreadCount: number }>(
    "/api/notifications/unread-count",
    {
      signal,
      fallbackMessage: "Notification request failed.",
    },
  );
  return response.unreadCount;
}

export async function getNotifications(signal?: AbortSignal) {
  return (await getNotificationPage(0, signal)).items;
}

export async function updateNotification(
  id: string,
  update: { read?: boolean; dismissed?: boolean },
) {
  await apiRequest(`/api/notifications/${id}`, {
    method: "PATCH",
    json: update,
    responseType: "void",
    fallbackMessage: "Notification request failed.",
  });
}

export async function performNotificationAction(
  id: string,
  actionKey: string,
): Promise<InAppNotification> {
  const body = await apiRequest<{ item: InAppNotification }>(
    `/api/notifications/${id}/actions/${actionKey}`,
    {
      method: "POST",
      fallbackMessage: "Notification request failed.",
    },
  );
  return body.item;
}

export async function markAllNotificationsRead() {
  await apiRequest("/api/notifications/read-all", {
    method: "POST",
    responseType: "void",
    fallbackMessage: "Notification request failed.",
  });
}

export async function clearAllNotifications() {
  await apiRequest("/api/notifications/clear-all", {
    method: "POST",
    responseType: "void",
    fallbackMessage: "Notification request failed.",
  });
}
