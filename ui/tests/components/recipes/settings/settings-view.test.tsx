import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsView } from "@/components/recipes/settings/settings-view";
import {
  parseUnitPreference,
  resetUnitPreferenceServerSnapshot,
  UNIT_PREFERENCE_STORAGE_KEY,
} from "@/tests/support/recipe-state";
import { fireEvent, render, screen, waitFor } from "@/tests/test-utils";

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  updateUser: vi.fn(),
  listAccounts: vi.fn(),
  listSessions: vi.fn(),
  linkSocial: vi.fn(),
  unlinkAccount: vi.fn(),
  revokeSession: vi.fn(),
  getHouseholds: vi.fn(),
  createHousehold: vi.fn(),
  getHouseholdMembers: vi.fn(),
  getHouseholdInvitations: vi.fn(),
  getIncomingHouseholdInvitations: vi.fn(),
  listAgents: vi.fn(),
  listAgentMutations: vi.fn(),
  revokeAgent: vi.fn(),
  undoAgentMutation: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: mocks.useSession,
    updateUser: mocks.updateUser,
    listAccounts: mocks.listAccounts,
    listSessions: mocks.listSessions,
    linkSocial: mocks.linkSocial,
    unlinkAccount: mocks.unlinkAccount,
    revokeSession: mocks.revokeSession,
  },
}));

vi.mock("@/lib/api/households", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/households")>()),
  getHouseholds: mocks.getHouseholds,
  createHousehold: mocks.createHousehold,
  getHouseholdMembers: mocks.getHouseholdMembers,
  getHouseholdInvitations: mocks.getHouseholdInvitations,
  getIncomingHouseholdInvitations: mocks.getIncomingHouseholdInvitations,
}));

vi.mock("@/lib/api/agents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/agents")>()),
  listAgents: mocks.listAgents,
  listAgentMutations: mocks.listAgentMutations,
  revokeAgent: mocks.revokeAgent,
  undoAgentMutation: mocks.undoAgentMutation,
}));

function renderSettingsView() {
  return render(<SettingsView />);
}

function storedUnitPreference() {
  return parseUnitPreference(localStorage.getItem(UNIT_PREFERENCE_STORAGE_KEY));
}

const signedIn = {
  data: {
    user: {
      id: "robbie-user",
      name: "Robbie",
      email: "robbie@example.com",
      image: null,
    },
    session: { token: "current-token" },
  },
  isPending: false,
};

describe("SettingsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetUnitPreferenceServerSnapshot();
    window.history.replaceState({}, "", "/recipes/settings");
    mocks.useSession.mockReturnValue(signedIn);
    mocks.updateUser.mockResolvedValue({ data: null, error: null });
    mocks.listAccounts.mockResolvedValue({
      data: [{ providerId: "google", accountId: "g1" }],
      error: null,
    });
    mocks.listSessions.mockResolvedValue({
      data: [
        {
          token: "current-token",
          userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Chrome/120",
          updatedAt: new Date(),
        },
      ],
      error: null,
    });
    mocks.getHouseholds.mockResolvedValue([]);
    mocks.getHouseholdMembers.mockResolvedValue([]);
    mocks.getHouseholdInvitations.mockResolvedValue([]);
    mocks.getIncomingHouseholdInvitations.mockResolvedValue([]);
    mocks.listAgents.mockResolvedValue([]);
    mocks.listAgentMutations.mockResolvedValue([]);
    mocks.revokeAgent.mockResolvedValue(undefined);
    mocks.undoAgentMutation.mockResolvedValue(undefined);
    mocks.createHousehold.mockResolvedValue({});
  });

  it("prompts to sign in when there is no session", () => {
    mocks.useSession.mockReturnValue({ data: null, isPending: false });
    renderSettingsView();

    expect(screen.getByText("Log in to open settings.")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /back to recipes/i }),
    ).toHaveAttribute("href", "/recipes");
  });

  it("shows the account panel with name and email", () => {
    renderSettingsView();

    expect(screen.getByLabelText("Display name")).toHaveValue("Robbie");
    expect(screen.getByText("robbie@example.com")).toBeInTheDocument();
  });

  it("saves a new display name after editing", async () => {
    const user = userEvent.setup();
    renderSettingsView();

    const input = screen.getByLabelText("Display name");
    await user.clear(input);
    await user.type(input, "Rob");
    await user.tab();

    await waitFor(() =>
      expect(mocks.updateUser).toHaveBeenCalledWith({ name: "Rob" }),
    );
  });

  it("rejects an empty display name without saving", async () => {
    const user = userEvent.setup();
    renderSettingsView();

    const input = screen.getByLabelText("Display name");
    await user.clear(input);
    await user.tab();

    expect(await screen.findByText(/can't be empty/i)).toBeInTheDocument();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("shows linked accounts and offers to link the other provider", async () => {
    const user = userEvent.setup();
    renderSettingsView();

    await user.click(
      screen.getByRole("button", { name: /sign-in & security/i }),
    );

    expect(await screen.findByText("Google")).toBeInTheDocument();
    expect(
      screen.getByText("can't unlink your only sign-in"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /github/i })).toBeInTheDocument();
    expect(screen.getByText("this device")).toBeInTheDocument();
  });

  it("opens agent access management from settings", async () => {
    const user = userEvent.setup();
    renderSettingsView();

    await user.click(screen.getByRole("button", { name: "Agents" }));

    expect(
      await screen.findByText("Who can read your cooking data."),
    ).toBeInTheDocument();
    expect(screen.getByText("No agents connected.")).toBeInTheDocument();
  });

  it("saves a custom units ladder from the units settings panel", async () => {
    const user = userEvent.setup();
    renderSettingsView();

    await user.click(
      screen.getByRole("button", { name: /units & measurements/i }),
    );
    await user.click(screen.getByRole("button", { name: "US" }));

    expect(screen.getByRole("button", { name: "US" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByText(/US uses teaspoons and tablespoons/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Metric uses teaspoons and tablespoons/i),
    ).not.toBeInTheDocument();
    expect(storedUnitPreference()).toMatchObject({ preset: "us" });

    const threshold = screen.getByRole("spinbutton", {
      name: /oz upper threshold in grams/i,
    });
    expect(threshold).toHaveAttribute("step", "any");
    fireEvent.change(threshold, { target: { value: "500" } });

    expect(storedUnitPreference()).toMatchObject({
      preset: "us",
      weight: [{ unit: "oz", upTo: 453.592 }, { unit: "lb" }],
    });

    fireEvent.blur(threshold);

    expect(screen.getByText(/Custom uses the units/i)).toBeInTheDocument();
    expect(storedUnitPreference()).toMatchObject({
      preset: "custom",
      weight: [{ unit: "oz", upTo: 500 }, { unit: "lb" }],
    });

    await user.click(screen.getByRole("button", { name: /remove lbs/i }));
    expect(screen.getByRole("button", { name: /remove oz/i })).toBeDisabled();
  });

  it("allows a custom ladder to be restored after choosing a preset", async () => {
    const user = userEvent.setup();
    renderSettingsView();

    await user.click(
      screen.getByRole("button", { name: /units & measurements/i }),
    );
    await user.click(screen.getByRole("button", { name: "US" }));
    await user.click(screen.getByRole("button", { name: /add g/i }));
    await user.click(screen.getByRole("button", { name: "Metric" }));

    expect(screen.getByText("Custom ladder replaced.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo" }));

    expect(storedUnitPreference()).toMatchObject({
      preset: "custom",
      weight: [{ unit: "g" }, { unit: "oz" }, { unit: "lb" }],
    });
    expect(
      screen.queryByText("Custom ladder replaced."),
    ).not.toBeInTheDocument();
  });

  it("keeps thresholds increasing when units are added around an existing ladder", async () => {
    const user = userEvent.setup();
    renderSettingsView();

    await user.click(
      screen.getByRole("button", { name: /units & measurements/i }),
    );
    await user.click(screen.getByRole("button", { name: "US" }));
    await user.click(screen.getByRole("button", { name: /add g/i }));
    await user.click(screen.getByRole("button", { name: /add kg/i }));

    expect(storedUnitPreference()).toMatchObject({
      preset: "custom",
      weight: [
        { unit: "g", upTo: 1000 },
        { unit: "oz", upTo: 1001 },
        { unit: "lb", upTo: 2000 },
        { unit: "kg", upTo: Infinity },
      ],
    });
  });

  it("keeps the US pint last when editing the US volume ladder", async () => {
    const user = userEvent.setup();
    renderSettingsView();

    await user.click(
      screen.getByRole("button", { name: /units & measurements/i }),
    );
    await user.click(screen.getByRole("button", { name: "US" }));
    await user.click(screen.getByRole("button", { name: /add ml/i }));

    expect(storedUnitPreference()).toMatchObject({
      preset: "custom",
      volume: [
        { unit: "tsp" },
        { unit: "tbsp" },
        { unit: "ml" },
        { unit: "us_cup" },
        { unit: "us_pint", upTo: Infinity },
      ],
    });
  });

  it("uses one keyboard-accessible ruler for each measurement ladder", async () => {
    const user = userEvent.setup();
    const { container } = renderSettingsView();

    await user.click(
      screen.getByRole("button", { name: /units & measurements/i }),
    );
    await user.click(screen.getByRole("button", { name: "US" }));

    expect(container.querySelectorAll("[data-threshold-ruler]")).toHaveLength(
      2,
    );
    expect(container.querySelector('input[type="range"]')).toBeNull();

    const weightDivider = screen.getByRole("slider", {
      name: /oz hands off to lbs/i,
    });
    fireEvent.keyDown(weightDivider, { key: "ArrowRight" });

    expect(storedUnitPreference()).toMatchObject({
      preset: "custom",
      weight: [{ unit: "oz", upTo: 458.592 }, { unit: "lb" }],
    });
  });

  it("offers household creation when the user has no household", async () => {
    const user = userEvent.setup();
    renderSettingsView();

    await user.click(screen.getByRole("button", { name: "Household" }));

    expect(await screen.findByText("Start a household.")).toBeInTheDocument();
    expect(screen.getByLabelText("Household name")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create household/i }),
    ).toBeInTheDocument();
  });

  it("reuses household data when returning to the settings tab", async () => {
    const user = userEvent.setup();
    renderSettingsView();

    await user.click(screen.getByRole("button", { name: "Household" }));
    expect(await screen.findByText("Start a household.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Account" }));
    await user.click(screen.getByRole("button", { name: "Household" }));

    expect(screen.getByText("Start a household.")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Loading household"),
    ).not.toBeInTheDocument();
    expect(mocks.getHouseholds).toHaveBeenCalledOnce();
  });

  it("requires a successful household lookup before offering creation", async () => {
    const user = userEvent.setup();
    mocks.getHouseholds
      .mockRejectedValueOnce(new Error("Household service unavailable"))
      .mockResolvedValueOnce([]);
    renderSettingsView();

    await user.click(screen.getByRole("button", { name: "Household" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Household service unavailable",
    );
    expect(screen.queryByText("Start a household.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Start a household.")).toBeInTheDocument();
  });

  it("still offers creation when only incoming invitations fail to load", async () => {
    const user = userEvent.setup();
    mocks.getIncomingHouseholdInvitations.mockRejectedValueOnce(
      new Error("Invitations unavailable"),
    );
    renderSettingsView();

    await user.click(screen.getByRole("button", { name: "Household" }));

    expect(await screen.findByText("Start a household.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Invitations unavailable",
    );
  });

  it("serializes household creation attempts", async () => {
    const user = userEvent.setup();
    let resolveCreate: (() => void) | undefined;
    mocks.createHousehold.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveCreate = resolve;
      }),
    );
    renderSettingsView();

    await user.click(screen.getByRole("button", { name: "Household" }));
    await user.type(
      await screen.findByLabelText("Household name"),
      "Park Road",
    );
    const createButton = screen.getByRole("button", {
      name: /create household/i,
    });
    const form = createButton.closest("form");
    expect(form).not.toBeNull();

    fireEvent.submit(form as HTMLFormElement);
    fireEvent.submit(form as HTMLFormElement);

    expect(mocks.createHousehold).toHaveBeenCalledTimes(1);
    expect(createButton).toBeDisabled();
    resolveCreate?.();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /create household/i }),
      ).not.toBeDisabled(),
    );
  });

  it("opens on the security panel and surfaces a link error from the URL", async () => {
    window.history.replaceState(
      {},
      "",
      "/recipes/settings?error=account_already_linked_to_different_user&error_description=Visit+https%3A%2F%2Fexample.com+for+help",
    );
    renderSettingsView();

    // Lands on Sign-in & security without a manual tab switch.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Email already linked to an account",
    );
    expect(screen.queryByText(/example.com/i)).not.toBeInTheDocument();
    expect(await screen.findByText("Google")).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  it("falls back to a useful link error when the URL has no description", async () => {
    window.history.replaceState(
      {},
      "",
      "/recipes/settings?error=access_denied",
    );
    renderSettingsView();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't link that account/i,
    );
    expect(window.location.search).toBe("");
  });
});
