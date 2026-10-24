import {
  QueryClient,
  QueryClientProvider,
  type QueryClientProviderProps,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { SubmitEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHouseholdSettings } from "@/hooks/use-household-settings";
import type {
  Household,
  HouseholdEquipment,
  HouseholdEquipmentItem,
  HouseholdInvitation,
  HouseholdMember,
  IncomingHouseholdInvitation,
} from "@/lib/api/households";
import type { HouseholdSettingsData } from "@/lib/query/household-queries";
import { recipeQueryKeys } from "@/lib/query/recipe-query-keys";

const mocks = vi.hoisted(() => ({
  acceptHouseholdInvitation: vi.fn(),
  addHouseholdEquipment: vi.fn(),
  createHousehold: vi.fn(),
  declineHouseholdInvitation: vi.fn(),
  deleteHousehold: vi.fn(),
  getHouseholdEquipment: vi.fn(),
  getHouseholdInvitations: vi.fn(),
  getHouseholdMembers: vi.fn(),
  getHouseholds: vi.fn(),
  getIncomingHouseholdInvitations: vi.fn(),
  inviteHouseholdMember: vi.fn(),
  leaveHousehold: vi.fn(),
  removeHouseholdEquipment: vi.fn(),
  removeHouseholdMember: vi.fn(),
  renameHousehold: vi.fn(),
  revokeHouseholdInvitation: vi.fn(),
  saveHouseholdEquipmentMatchMode: vi.fn(),
}));

vi.mock("@/lib/api/households", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/households")>()),
  ...mocks,
}));

const household: Household = {
  id: "household-1",
  name: "Park Road",
  slug: "park-road",
  logo: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  membership: { id: "membership-owner", role: "owner" },
};

const member: HouseholdMember = {
  id: "membership-2",
  role: "member",
  createdAt: "2026-10-02T00:00:00.000Z",
  user: {
    id: "user-2",
    email: "sam@example.com",
    name: "Sam",
    image: null,
  },
};

const invitation: HouseholdInvitation = {
  id: "invitation-1",
  householdId: household.id,
  email: "alex@example.com",
  role: "member",
  status: "pending",
  expiresAt: "2026-11-01T00:00:00.000Z",
  createdAt: "2026-10-03T00:00:00.000Z",
};

const incoming: IncomingHouseholdInvitation = {
  ...invitation,
  id: "incoming-1",
  household: { id: "household-2", name: "River Street" },
};

const pan: HouseholdEquipmentItem = {
  slug: "frying-pan",
  name: "Frying pan",
  category: "cookware",
  createdAt: "2026-10-04T00:00:00.000Z",
  retired: false,
};

const pot: HouseholdEquipmentItem = {
  ...pan,
  slug: "stock-pot",
  name: "Stock pot",
};

const equipment: HouseholdEquipment = {
  catalog: [
    { slug: pan.slug, name: pan.name, category: "cookware" },
    { slug: pot.slug, name: pot.name, category: "cookware" },
  ],
  owned: [pan],
  recipeMatchMode: "warn",
};

function householdData(
  currentHousehold: Household | null = household,
): HouseholdSettingsData {
  return {
    household: currentHousehold,
    equipment: currentHousehold ? equipment : null,
    members: currentHousehold ? [member] : [],
    invitations: currentHousehold ? [invitation] : [],
    incoming: currentHousehold ? [] : [incoming],
    detailError: null,
  };
}

function createQueryClient(data: HouseholdSettingsData) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Number.POSITIVE_INFINITY, retry: false },
    },
  });
  queryClient.setQueryData(recipeQueryKeys.householdSettings("user-1"), data);
  return queryClient;
}

function wrapper(queryClient: QueryClient) {
  return function QueryWrapper({
    children,
  }: Readonly<Pick<QueryClientProviderProps, "children">>) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function submitEvent(): SubmitEvent<HTMLFormElement> {
  return { preventDefault: vi.fn() } as unknown as SubmitEvent<HTMLFormElement>;
}

function renderHouseholdSettings(data = householdData()) {
  const queryClient = createQueryClient(data);
  return {
    queryClient,
    ...renderHook(() => useHouseholdSettings("user-1"), {
      wrapper: wrapper(queryClient),
    }),
  };
}

describe("useHouseholdSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.getHouseholds.mockResolvedValue([household]);
    mocks.getHouseholdMembers.mockResolvedValue([member]);
    mocks.getHouseholdInvitations.mockResolvedValue([invitation]);
    mocks.getIncomingHouseholdInvitations.mockResolvedValue([]);
    mocks.getHouseholdEquipment.mockResolvedValue(equipment);
    mocks.renameHousehold.mockResolvedValue({
      ...household,
      name: "Garden House",
    });
    mocks.inviteHouseholdMember.mockResolvedValue({
      ...invitation,
      id: "invitation-2",
      email: "new@example.com",
    });
    mocks.addHouseholdEquipment.mockResolvedValue(pot);
    mocks.saveHouseholdEquipmentMatchMode.mockResolvedValue({
      recipeMatchMode: "hide",
    });
  });

  it("runs owner mutations and updates the household cache", async () => {
    const { queryClient, result } = renderHouseholdSettings();

    act(() => result.current.setName("  Garden House  "));
    act(() => result.current.onRename(submitEvent()));
    await waitFor(() =>
      expect(result.current.notice).toBe("Household name saved."),
    );
    expect(mocks.renameHousehold).toHaveBeenCalledWith(
      household.id,
      "Garden House",
    );

    act(() => result.current.setInviteEmail(" New@Example.com "));
    act(() => result.current.onInvite(submitEvent()));
    await waitFor(() =>
      expect(result.current.notice).toBe(
        "Invitation created for new@example.com.",
      ),
    );
    expect(mocks.inviteHouseholdMember).toHaveBeenCalledWith(
      household.id,
      "new@example.com",
    );

    act(() => result.current.removeMember(member));
    await waitFor(() => expect(result.current.notice).toBe("Sam was removed."));
    expect(mocks.removeHouseholdMember).toHaveBeenCalledWith(
      household.id,
      member.id,
    );

    act(() => result.current.revokeInvitation(invitation));
    await waitFor(() =>
      expect(result.current.notice).toBe(
        "Invitation for alex@example.com revoked.",
      ),
    );

    act(() => result.current.setEquipmentSlug(pot.slug));
    act(() => result.current.onAddEquipment(submitEvent()));
    await waitFor(() =>
      expect(result.current.notice).toBe("Stock pot added to the household."),
    );

    act(() => result.current.onRemoveEquipment(pan));
    await waitFor(() =>
      expect(result.current.notice).toBe(
        "Frying pan removed from the household.",
      ),
    );

    act(() => result.current.onEquipmentMatchModeChange("hide"));
    await waitFor(() =>
      expect(result.current.notice).toBe(
        "Equipment matching preference saved.",
      ),
    );

    const cached = queryClient.getQueryData<HouseholdSettingsData>(
      recipeQueryKeys.householdSettings("user-1"),
    );
    expect(cached?.household?.name).toBe("Garden House");
    expect(cached?.members).toEqual([]);
    expect(cached?.invitations.map((item) => item.email)).toEqual([
      "new@example.com",
    ]);
    expect(cached?.equipment?.owned).toEqual([pot]);
    expect(cached?.equipment?.recipeMatchMode).toBe("hide");
  });

  it("creates a household and handles incoming invitations", async () => {
    const { result } = renderHouseholdSettings(householdData(null));

    act(() => result.current.setName("  New household  "));
    act(() => result.current.onCreate(submitEvent()));
    await waitFor(() =>
      expect(result.current.notice).toBe("Household created."),
    );
    expect(mocks.createHousehold).toHaveBeenCalledWith("New household");

    act(() => result.current.declineInvitation(incoming));
    await waitFor(() =>
      expect(result.current.notice).toBe("Invitation declined."),
    );
    expect(mocks.declineHouseholdInvitation).toHaveBeenCalledWith(incoming.id);

    act(() => result.current.acceptInvitation(incoming));
    await waitFor(() =>
      expect(result.current.notice).toBe("Welcome to River Street."),
    );
    expect(mocks.acceptHouseholdInvitation).toHaveBeenCalledWith(incoming.id);
  });

  it("leaves and deletes a household only after confirmation", async () => {
    const first = renderHouseholdSettings();
    mocks.getHouseholds.mockResolvedValue([]);

    act(() => first.result.current.leaveCurrentHousehold());
    await waitFor(() =>
      expect(first.result.current.notice).toBe("You've left the household."),
    );
    expect(mocks.leaveHousehold).toHaveBeenCalledWith(household.id);
    first.unmount();

    mocks.getHouseholds.mockResolvedValue([household]);
    const second = renderHouseholdSettings();
    mocks.getHouseholds.mockResolvedValue([]);

    act(() => second.result.current.deleteCurrentHousehold());
    await waitFor(() =>
      expect(second.result.current.notice).toBe("Household deleted."),
    );
    expect(mocks.deleteHousehold).toHaveBeenCalledWith(household.id);
  });
});
