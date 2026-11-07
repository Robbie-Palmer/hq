import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@/tests/test-utils";

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  signInSocial: vi.fn(),
  signOut: vi.fn(),
  listAccounts: vi.fn(),
  getLastUsedLoginMethod: vi.fn(),
  isPreviewDeployment: vi.fn(),
  clearOfflineRecipeData: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: mocks.useSession,
    signIn: { social: mocks.signInSocial },
    signOut: mocks.signOut,
    listAccounts: mocks.listAccounts,
    getLastUsedLoginMethod: mocks.getLastUsedLoginMethod,
  },
}));

vi.mock("@/lib/preview-environment", () => ({
  isPreviewDeployment: mocks.isPreviewDeployment,
}));

vi.mock("@/components/recipes/recipe-pwa", () => ({
  clearOfflineRecipeData: mocks.clearOfflineRecipeData,
}));

import {
  AuthButton,
  redirectAfterSignOut,
} from "@/components/recipes/auth-button";
import { recipeQueryKeys } from "@/lib/query/recipe-query-keys";

describe("AuthButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useSession.mockReturnValue({ data: null, isPending: false });
    mocks.signInSocial.mockResolvedValue({ data: null, error: null });
    mocks.signOut.mockResolvedValue({ data: null, error: null });
    mocks.listAccounts.mockResolvedValue({ data: [], error: null });
    mocks.getLastUsedLoginMethod.mockReturnValue(null);
    mocks.isPreviewDeployment.mockReturnValue(false);
    mocks.clearOfflineRecipeData.mockResolvedValue(undefined);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("lets the user choose Google or GitHub", async () => {
    const user = userEvent.setup();
    render(<AuthButton />);

    await user.click(screen.getByRole("button", { name: /log in/i }));

    expect(
      screen.getByRole("button", { name: "Continue with Google" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Continue with GitHub" }),
    ).toBeInTheDocument();
  });

  it("marks the last used provider", async () => {
    const user = userEvent.setup();
    mocks.getLastUsedLoginMethod.mockReturnValue("google");
    render(<AuthButton />);

    await user.click(screen.getByRole("button", { name: /log in/i }));

    expect(
      screen.getByRole("button", { name: /Continue with Google/ }),
    ).toHaveTextContent("Last used");
    expect(
      screen.getByRole("button", { name: /Continue with GitHub/ }),
    ).not.toHaveTextContent("Last used");
  });

  it("starts the selected provider flow and preserves the current page", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/recipes/pasta?servings=4#method");
    render(<AuthButton />);

    await user.click(screen.getByRole("button", { name: /log in/i }));
    await user.click(
      screen.getByRole("button", { name: "Continue with GitHub" }),
    );

    expect(mocks.signInSocial).toHaveBeenCalledWith({
      provider: "github",
      callbackURL: "http://localhost:3000/recipes/pasta?servings=4#method",
      errorCallbackURL: "http://localhost:3000/recipes/pasta?servings=4#method",
    });
  });

  it("starts sign-up providers with onboarding as the callback", async () => {
    const user = userEvent.setup();
    render(<AuthButton intent="signup" />);

    await user.click(screen.getByRole("button", { name: /sign up/i }));
    await user.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );

    expect(mocks.signInSocial).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: "/recipes/onboarding",
      errorCallbackURL: "/recipes/onboarding",
    });
  });

  it("does not expose anonymous auth actions while the session is loading", () => {
    mocks.useSession.mockReturnValue({ data: null, isPending: true });

    const { container } = render(<AuthButton intent="signup" />);

    expect(
      screen.queryByRole("button", { name: /sign up/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "Loading session" }),
    ).toBeInTheDocument();
    expect(container.querySelector('[data-slot="skeleton"]')).toBeTruthy();
  });

  it("offers Access-protected test scenarios on PR previews", async () => {
    const user = userEvent.setup();
    mocks.isPreviewDeployment.mockReturnValue(true);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              id: "empty-user",
              name: "Empty account",
              description: "A standard user with no saved recipes.",
            },
          ]),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: "Preview sign-in failed" }),
      });
    vi.stubGlobal("fetch", fetchMock);
    render(<AuthButton />);

    await user.click(screen.getByRole("button", { name: /log in/i }));
    const scenarioButton = await screen.findByRole("button", {
      name: /Empty account/,
    });
    expect(
      screen.queryByRole("button", { name: "Continue with Google" }),
    ).not.toBeInTheDocument();

    await user.click(scenarioButton);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/auth/preview/sign-in",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ scenario: "empty-user" }),
        }),
      ),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Preview sign-in failed",
    );
  });

  it("starts each preview sign-up with a fresh QA account", async () => {
    const user = userEvent.setup();
    mocks.isPreviewDeployment.mockReturnValue(true);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Preview sign-up failed" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AuthButton intent="signup" />);

    await user.click(screen.getByRole("button", { name: /sign up/i }));
    expect(
      screen.getByText("Start a fresh preview account"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Choose a preview scenario"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /start fresh/i }));

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/preview/sign-up", {
      credentials: "same-origin",
      method: "POST",
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Preview sign-up failed",
    );
  });

  it("constrains the sign-up control and menu to a mobile viewport", async () => {
    const user = userEvent.setup();
    render(<AuthButton intent="signup" />);

    const trigger = screen.getByRole("button", { name: /sign up/i });
    expect(trigger).toHaveClass("max-w-full");
    await user.click(trigger);

    expect(screen.getByRole("dialog")).toHaveClass(
      "w-[calc(100vw-2rem)]",
      "max-w-56",
    );
  });

  it("can hide header auth text on narrow mobile screens", () => {
    render(<AuthButton intent="signup" compactOnMobile />);

    const trigger = screen.getByRole("button", { name: "Sign up" });
    expect(trigger).toHaveAccessibleName("Sign up");
    expect(screen.getByText("Sign up")).toHaveClass(
      "hidden",
      "min-[480px]:inline",
    );
  });

  it("disables sign-in on a frontend-only preview", async () => {
    const user = userEvent.setup();
    mocks.isPreviewDeployment.mockReturnValue(true);
    vi.stubEnv("NEXT_PUBLIC_PREVIEW_BACKEND", "false");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<AuthButton />);

    await user.click(screen.getByRole("button", { name: /log in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Sign-in is disabled on this frontend-only preview.",
    );
    expect(screen.getByText("Sign-in unavailable")).toBeInTheDocument();
    expect(
      screen.queryByText("Choose a preview scenario"),
    ).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clears private data and redirects even when local cleanup fails", async () => {
    const user = userEvent.setup();
    const replace = vi.fn();
    mocks.useSession.mockReturnValue({
      data: { user: { name: "Robbie", email: "robbie@example.com" } },
      isPending: false,
    });
    const { queryClient } = render(
      <AuthButton
        signOutRedirect={() => redirectAfterSignOut(undefined, replace)}
      />,
    );
    const privateKey = recipeQueryKeys.recipeBoxRecipes("user-1");
    const publicKey = recipeQueryKeys.publicRecipes();
    queryClient.setQueryData(privateKey, { recipes: ["private"] });
    queryClient.setQueryData(publicKey, { recipes: ["public"] });

    await user.click(
      screen.getByRole("button", { name: "Account for Robbie" }),
    );

    expect(screen.getByText("robbie@example.com")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /settings/i })).toHaveAttribute(
      "href",
      "/recipes/settings",
    );

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    const signOutOptions = mocks.signOut.mock.calls[0]?.[0];
    expect(signOutOptions?.fetchOptions?.onSuccess).toEqual(
      expect.any(Function),
    );

    vi.spyOn(queryClient, "cancelQueries").mockRejectedValueOnce(
      new Error("cancellation failed"),
    );
    mocks.clearOfflineRecipeData.mockRejectedValueOnce(
      new Error("IndexedDB unavailable"),
    );
    await signOutOptions?.fetchOptions?.onSuccess();

    expect(queryClient.getQueryData(privateKey)).toBeUndefined();
    expect(queryClient.getQueryData(publicKey)).toEqual({
      recipes: ["public"],
    });
    expect(mocks.clearOfflineRecipeData).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith("/recipes");
  });

  it("shows the term review workflow only to administrators", async () => {
    const user = userEvent.setup();
    mocks.useSession.mockReturnValue({
      data: {
        user: {
          name: "Reviewer",
          email: "reviewer@example.com",
          role: "admin",
        },
      },
      isPending: false,
    });
    render(<AuthButton />);

    await user.click(
      screen.getByRole("button", { name: "Account for Reviewer" }),
    );

    expect(screen.getByRole("link", { name: "Review terms" })).toHaveAttribute(
      "href",
      "/recipes/admin/terms",
    );
  });

  it("redirects successful sign-out to the recipe home", () => {
    const replace = vi.fn();

    redirectAfterSignOut(undefined, replace);

    expect(replace).toHaveBeenCalledWith("/recipes");
  });

  it("shows an error when sign out fails", async () => {
    const user = userEvent.setup();
    mocks.useSession.mockReturnValue({
      data: { user: { name: "Robbie", email: "robbie@example.com" } },
      isPending: false,
    });
    mocks.signOut.mockResolvedValue({
      data: null,
      error: { message: "Session could not be ended" },
    });
    render(<AuthButton />);

    await user.click(
      screen.getByRole("button", { name: "Account for Robbie" }),
    );
    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Session could not be ended",
    );
  });
});
