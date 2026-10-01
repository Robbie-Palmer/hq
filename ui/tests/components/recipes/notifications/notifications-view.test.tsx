import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentApprovalNotification,
  HouseholdNotification,
  NotificationPage,
  RecipeRecommendationNotification,
} from "@/lib/api/notifications";
import { recipeQueryKeys } from "@/lib/query/recipe-query-keys";

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  getNotificationPage: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  clearAllNotifications: vi.fn(),
  performNotificationAction: vi.fn(),
  updateNotification: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: mocks.useSession },
}));

vi.mock("@/lib/api/notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/notifications")>()),
  getNotificationPage: mocks.getNotificationPage,
  markAllNotificationsRead: mocks.markAllNotificationsRead,
  clearAllNotifications: mocks.clearAllNotifications,
  performNotificationAction: mocks.performNotificationAction,
  updateNotification: mocks.updateNotification,
}));

import { NotificationsView } from "@/components/recipes/notifications/notifications-view";

function renderNotifications() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    ...render(<NotificationsView />, {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      ),
    }),
    queryClient,
  };
}

const invitation = {
  id: "notification-1",
  eventId: "event-1",
  kind: "household_invited",
  actor: { id: "user-alex", name: "Alex" },
  actions: ["accept", "decline"],
  detail: {
    type: "household",
    household: { id: "household-1", name: "Park Road" },
    invitationStatus: "pending",
  },
  readAt: null,
  occurredAt: "2026-07-14T12:00:00.000Z",
} satisfies HouseholdNotification;

const acceptedInvitation = {
  ...invitation,
  actions: [],
  detail: { ...invitation.detail, invitationStatus: "accepted" },
  readAt: "2026-07-14T12:01:00.000Z",
} satisfies HouseholdNotification;

describe("NotificationsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useSession.mockReturnValue({
      data: { user: { id: "user-1" } },
      isPending: false,
    });
    mocks.getNotificationPage.mockResolvedValue({
      items: [invitation],
      nextOffset: null,
      unreadCount: 1,
    });
    mocks.markAllNotificationsRead.mockResolvedValue(undefined);
    mocks.clearAllNotifications.mockResolvedValue(undefined);
    mocks.performNotificationAction.mockResolvedValue(acceptedInvitation);
    mocks.updateNotification.mockResolvedValue(undefined);
  });

  it("keeps an accepted invitation as a read, resolved notification", async () => {
    const user = userEvent.setup();
    renderNotifications();

    await user.click(await screen.findByRole("button", { name: "Accept" }));

    expect(
      await screen.findByText(
        "You accepted Alex's invitation to join Park Road.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("accepted", { exact: true })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(screen.getByText(/0 unread/)).toBeInTheDocument();
    expect(mocks.performNotificationAction).toHaveBeenCalledWith(
      "notification-1",
      "accept",
    );
    expect(mocks.updateNotification).not.toHaveBeenCalled();
  });

  it("shows the initial notification load error", async () => {
    mocks.getNotificationPage.mockRejectedValue(
      new Error("Notification service unavailable"),
    );

    renderNotifications();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Notification service unavailable",
    );
  });

  it("adds a recommended recipe to the recipe box", async () => {
    const recommendation = {
      id: "notification-recipe-1",
      eventId: "event-recipe-1",
      kind: "recipe_recommended",
      actor: { id: "user-alex", name: "Alex" },
      actions: ["add_to_recipe_box"],
      detail: {
        type: "recipe_recommendation",
        recipe: {
          slug: "weekday-stew",
          title: "Weekday Stew",
          available: true,
        },
        saved: false,
      },
      readAt: null,
      occurredAt: "2026-07-14T12:00:00.000Z",
    } satisfies RecipeRecommendationNotification;
    const savedRecommendation = {
      ...recommendation,
      actions: [],
      detail: { ...recommendation.detail, saved: true },
      readAt: "2026-07-14T12:01:00.000Z",
    } satisfies RecipeRecommendationNotification;
    mocks.getNotificationPage.mockResolvedValue({
      items: [recommendation],
      nextOffset: null,
      unreadCount: 1,
    });
    mocks.performNotificationAction.mockResolvedValue(savedRecommendation);
    const user = userEvent.setup();
    const { queryClient } = renderNotifications();
    const invalidateQueries = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockRejectedValue(new Error("Background refresh failed"));

    await user.click(
      await screen.findByRole("button", { name: "Add to recipe box" }),
    );

    expect(
      await screen.findByText("Added to your recipe box"),
    ).toBeInTheDocument();
    expect(mocks.performNotificationAction).toHaveBeenCalledWith(
      "notification-recipe-1",
      "add_to_recipe_box",
    );
    expect(screen.getByText(/0 unread/)).toBeInTheDocument();
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: recipeQueryKeys.recipeBox("user-1"),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: recipeQueryKeys.bootstrap("user-1"),
    });
  });

  it("links a shared shopping-list notification to the household list", async () => {
    const sharedList = {
      id: "notification-shopping-1",
      eventId: "event-shopping-1",
      kind: "shopping_list_shared",
      actor: { id: "user-alex", name: "Alex" },
      actions: [],
      detail: {
        type: "household",
        household: { id: "household-1", name: "Park Road" },
        invitationStatus: null,
      },
      readAt: null,
      occurredAt: "2026-09-07T12:00:00.000Z",
    } satisfies HouseholdNotification;
    mocks.getNotificationPage.mockResolvedValue({
      items: [sharedList],
      nextOffset: null,
      unreadCount: 1,
    });

    renderNotifications();

    expect(
      await screen.findByText(
        "Alex shared Park Road's shopping list with you.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "View shopping list" }),
    ).toHaveAttribute("href", "/recipes/shopping");
  });

  it("links a pending agent request to the approval page", async () => {
    const approval = {
      id: "notification-agent-1",
      eventId: "event-agent-1",
      kind: "agent_approval_requested",
      actor: null,
      actions: [],
      detail: {
        type: "agent_approval",
        agent: { id: "agent-1", name: "Meal planner" },
        capabilities: ["recipes.search", "recipes.read"],
        status: "pending",
        expiresAt: "2026-08-22T14:05:00.000Z",
        reviewUrl:
          "/recipes/settings/agents/approve?agent_id=agent-1&code=WXYZ-9876",
      },
      readAt: null,
      occurredAt: "2026-08-22T14:00:00.000Z",
    } satisfies AgentApprovalNotification;
    mocks.getNotificationPage.mockResolvedValue({
      items: [approval],
      nextOffset: null,
      unreadCount: 1,
    });

    renderNotifications();

    expect(await screen.findByText("Meal planner")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Review request" }),
    ).toHaveAttribute(
      "href",
      "/recipes/settings/agents/approve?agent_id=agent-1&code=WXYZ-9876",
    );
    expect(
      screen.getByText(/recipes.search, recipes.read/),
    ).toBeInTheDocument();
  });

  it("prevents dismissing an invitation while its response is pending", async () => {
    let resolveResponse:
      | ((notification: HouseholdNotification) => void)
      | undefined;
    mocks.performNotificationAction.mockReturnValue(
      new Promise<HouseholdNotification>((resolve) => {
        resolveResponse = resolve;
      }),
    );
    const user = userEvent.setup();
    renderNotifications();

    await user.click(await screen.findByRole("button", { name: "Accept" }));

    expect(
      screen.getByRole("button", { name: "Dismiss notification" }),
    ).toBeDisabled();
    resolveResponse?.(acceptedInvitation);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Dismiss notification" }),
      ).not.toBeDisabled(),
    );
  });

  it("marks all as read without removing notifications", async () => {
    const user = userEvent.setup();
    renderNotifications();

    await user.click(
      await screen.findByRole("button", { name: "Mark all read" }),
    );

    await waitFor(() =>
      expect(mocks.markAllNotificationsRead).toHaveBeenCalledOnce(),
    );
    expect(
      screen.getByText(/invited you to join Park Road/),
    ).toBeInTheDocument();
    expect(screen.getByText(/0 unread/)).toBeInTheDocument();
  });

  it("uses the complete archive unread count instead of the loaded page", async () => {
    mocks.getNotificationPage.mockResolvedValue({
      items: [acceptedInvitation],
      nextOffset: 100,
      unreadCount: 4,
    });

    renderNotifications();

    expect(await screen.findByText(/4 unread/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mark all read" }),
    ).toBeInTheDocument();
  });

  it("hides the previous user's archive while the replacement session loads", async () => {
    let resolveReplacement: ((page: NotificationPage) => void) | undefined;
    const replacementPage = new Promise<NotificationPage>((resolve) => {
      resolveReplacement = resolve;
    });
    mocks.getNotificationPage
      .mockResolvedValueOnce({
        items: [invitation],
        nextOffset: null,
        unreadCount: 1,
      })
      .mockReturnValueOnce(replacementPage);
    const { rerender } = renderNotifications();
    expect(
      await screen.findByText(/invited you to join Park Road/),
    ).toBeInTheDocument();

    mocks.useSession.mockReturnValue({
      data: { user: { id: "user-2" } },
      isPending: false,
    });
    rerender(<NotificationsView />);

    expect(screen.queryByText(/invited you to join Park Road/)).toBeNull();
    resolveReplacement?.({ items: [], nextOffset: null, unreadCount: 0 });
    expect(
      await screen.findByText("You're all caught up."),
    ).toBeInTheDocument();
  });

  it("clears every notification from the archive", async () => {
    const user = userEvent.setup();
    renderNotifications();

    await user.click(await screen.findByRole("button", { name: "Clear all" }));

    await waitFor(() =>
      expect(mocks.clearAllNotifications).toHaveBeenCalledOnce(),
    );
    expect(screen.getByText("You're all caught up.")).toBeInTheDocument();
    expect(screen.queryByText(/invited you to join Park Road/)).toBeNull();
  });

  it("loads subsequent archive pages", async () => {
    const older = {
      ...invitation,
      id: "notification-2",
      eventId: "event-2",
      kind: "household_member_left",
      actor: { id: "user-sam", name: "Sam" },
      actions: [],
      detail: { ...invitation.detail, invitationStatus: null },
      readAt: "2026-07-14T13:00:00.000Z",
      occurredAt: "2026-06-01T12:00:00.000Z",
    } satisfies HouseholdNotification;
    mocks.getNotificationPage
      .mockResolvedValueOnce({
        items: [invitation],
        nextOffset: 100,
        unreadCount: 1,
      })
      .mockResolvedValueOnce({
        items: [older],
        nextOffset: null,
        unreadCount: 1,
      });
    const user = userEvent.setup();
    renderNotifications();

    await user.click(await screen.findByRole("button", { name: "Load more" }));

    expect(await screen.findByText("Sam left Park Road.")).toBeInTheDocument();
    expect(mocks.getNotificationPage).toHaveBeenLastCalledWith(100);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });
});
