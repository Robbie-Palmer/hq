import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  session: {
    data: {
      user: { id: "user-1", name: "Cook", email: "cook@example.test" },
      session: { token: "session-1" },
    } as unknown,
    isPending: false,
  },
  signInSocial: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    listAccounts: authMock.listAccounts,
    signIn: { social: authMock.signInSocial },
    useSession: () => authMock.session,
  },
}));

import { AgentApprovalView } from "@/components/recipes/settings/agent-approval-view";

function agentResponse() {
  return Response.json({
    agent_id: "agent-1",
    name: "Meal planner",
    status: "pending",
    mode: "delegated",
    host_id: "host-1",
    created_at: "2026-08-22T09:00:00.000Z",
    activated_at: null,
    last_used_at: null,
    expires_at: "2026-09-21T09:00:00.000Z",
    agent_capability_grants: [
      { capability: "recipes.search", status: "pending" },
    ],
  });
}

function hostResponse() {
  return Response.json({
    id: "host-1",
    name: "Kitchen helper host",
    status: "active",
  });
}

function staleApprovalFetch() {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(agentResponse())
    .mockResolvedValueOnce(hostResponse())
    .mockResolvedValueOnce(
      Response.json({
        error: "fresh_session_required",
        message: "Confirm your identity.",
      }),
    );
}

describe("AgentApprovalView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    authMock.session.data = {
      user: { id: "user-1", name: "Cook", email: "cook@example.test" },
      session: { token: "session-1" },
    };
    authMock.session.isPending = false;
    authMock.listAccounts.mockResolvedValue({
      data: [{ providerId: "github", accountId: "github-1" }],
      error: null,
    });
    authMock.signInSocial.mockResolvedValue({ data: null, error: null });
    window.sessionStorage.clear();
    window.history.replaceState(
      null,
      "",
      "/recipes/settings/agents/approve?agent_id=agent-1&code=ABCD-1234",
    );
  });

  it("shows the requested capabilities and approves with the device code", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          agent_id: "agent-1",
          name: "Meal planner",
          status: "pending",
          mode: "delegated",
          host_id: "host-1",
          created_at: "2026-08-22T09:00:00.000Z",
          activated_at: null,
          last_used_at: null,
          expires_at: "2026-09-21T09:00:00.000Z",
          agent_capability_grants: [
            { capability: "recipes.search", status: "pending" },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "host-1",
          name: "Kitchen helper host",
          status: "active",
        }),
      )
      .mockResolvedValueOnce(Response.json({ status: "approved" }));
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentApprovalView />);

    expect(await screen.findByText("Allow Meal planner?")).toBeInTheDocument();
    expect(screen.getByText("recipes.search")).toBeInTheDocument();
    expect(screen.getByText("Kitchen helper host")).toBeInTheDocument();
    expect(screen.getByText("cook@example.test")).toBeInTheDocument();
    expect(window.location.search).toBe("");

    await userEvent.click(
      screen.getByRole("button", { name: "Approve access" }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/auth/agent/approve-capability",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({
          agent_id: "agent-1",
          user_code: "ABCD-1234",
          action: "approve",
        }),
      }),
    );
    expect(
      await screen.findByText("Agent access approved."),
    ).toBeInTheDocument();
  });

  it("does not render an approval action for an incomplete link", async () => {
    window.history.replaceState(null, "", "/recipes/settings/agents/approve");

    render(<AgentApprovalView />);

    expect(
      await screen.findByText("This approval link is incomplete."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Approve access" }),
    ).not.toBeInTheDocument();
  });

  it("allows approval when optional host metadata cannot be loaded", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          agent_id: "agent-1",
          name: "Meal planner",
          status: "pending",
          mode: "delegated",
          host_id: "host-1",
          created_at: "2026-08-22T09:00:00.000Z",
          activated_at: null,
          last_used_at: null,
          expires_at: "2026-09-21T09:00:00.000Z",
          agent_capability_grants: [
            { capability: "recipes.search", status: "pending" },
          ],
        }),
      )
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ status: "approved" }));
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentApprovalView />);

    expect(await screen.findByText("Allow Meal planner?")).toBeInTheDocument();
    expect(screen.getByText("host-1")).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Approve access" }),
    );

    expect(
      await screen.findByText("Agent access approved."),
    ).toBeInTheDocument();
  });

  it("allows approval while optional host metadata is still loading", async () => {
    let resolveHost: (response: Response) => void = () => {};
    const hostResponse = new Promise<Response>((resolve) => {
      resolveHost = resolve;
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          agent_id: "agent-1",
          name: "Meal planner",
          status: "pending",
          mode: "delegated",
          host_id: "host-1",
          created_at: "2026-08-22T09:00:00.000Z",
          activated_at: null,
          last_used_at: null,
          expires_at: "2026-09-21T09:00:00.000Z",
          agent_capability_grants: [
            { capability: "recipes.search", status: "pending" },
          ],
        }),
      )
      .mockImplementationOnce(() => hostResponse)
      .mockResolvedValueOnce(Response.json({ status: "approved" }));
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentApprovalView />);

    expect(await screen.findByText("Allow Meal planner?")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Approve access" }),
    );
    expect(
      await screen.findByText("Agent access approved."),
    ).toBeInTheDocument();

    resolveHost(
      Response.json({
        id: "host-1",
        name: "Kitchen helper host",
        status: "active",
      }),
    );
  });

  it("shows an error when the agent response is malformed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({})));

    render(<AgentApprovalView />);

    expect(
      await screen.findByText("The agent request response was invalid."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Approve access" }),
    ).toBeDisabled();
  });

  it("prompts for a linked provider when approval needs a fresh session", async () => {
    const fetchMock = staleApprovalFetch();
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentApprovalView />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Approve access" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Confirm it's you" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Confirm with Google" }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Confirm with GitHub" }),
    );

    expect(authMock.signInSocial).toHaveBeenCalledWith({
      provider: "github",
      callbackURL:
        "http://localhost:3000/recipes/settings/agents/approve?agent_reauth=complete",
      errorCallbackURL:
        "http://localhost:3000/recipes/settings/agents/approve?agent_reauth=complete",
      additionalData: { flow: "agent-approval" },
      additionalParams: { prompt: "select_account" },
    });
    expect(
      JSON.parse(
        window.sessionStorage.getItem("recipe-agent-approval-reauth:v1") ??
          "{}",
      ),
    ).toMatchObject({
      action: "approve",
      agentId: "agent-1",
      code: "ABCD-1234",
      provider: "github",
      userId: "user-1",
    });
  });

  it("continues approval after identity confirmation", async () => {
    window.sessionStorage.setItem(
      "recipe-agent-approval-reauth:v1",
      JSON.stringify({
        action: "approve",
        agentId: "agent-1",
        code: "ABCD-1234",
        createdAt: Date.now(),
        provider: "github",
        userId: "user-1",
      }),
    );
    window.history.replaceState(
      null,
      "",
      "/recipes/settings/agents/approve?agent_reauth=complete",
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(agentResponse())
      .mockResolvedValueOnce(hostResponse())
      .mockResolvedValueOnce(Response.json({ status: "approved" }));
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentApprovalView />);

    expect(
      await screen.findByText("Agent access approved."),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(window.sessionStorage).toHaveLength(0);
  });

  it("does not continue if the browser session changed users", async () => {
    authMock.session.data = {
      user: { id: "user-2", name: "Other cook", email: "other@example.test" },
      session: { token: "session-2" },
    };
    window.sessionStorage.setItem(
      "recipe-agent-approval-reauth:v1",
      JSON.stringify({
        action: "approve",
        agentId: "agent-1",
        code: "ABCD-1234",
        createdAt: Date.now(),
        provider: "github",
        userId: "user-1",
      }),
    );
    window.history.replaceState(
      null,
      "",
      "/recipes/settings/agents/approve?agent_reauth=complete",
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(agentResponse())
      .mockResolvedValueOnce(hostResponse());
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentApprovalView />);

    expect(
      await screen.findByText(
        "Use the same account that started this approval request.",
      ),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole("button", { name: "Confirm with GitHub" }),
    ).toBeInTheDocument();
  });

  it("keeps the approval available when identity confirmation is canceled", async () => {
    window.sessionStorage.setItem(
      "recipe-agent-approval-reauth:v1",
      JSON.stringify({
        action: "approve",
        agentId: "agent-1",
        code: "ABCD-1234",
        createdAt: Date.now(),
        provider: "google",
        userId: "user-1",
      }),
    );
    window.history.replaceState(
      null,
      "",
      "/recipes/settings/agents/approve?agent_reauth=complete&error=access_denied",
    );
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(agentResponse())
        .mockResolvedValueOnce(hostResponse()),
    );

    render(<AgentApprovalView />);

    expect(
      await screen.findByText("Identity confirmation was canceled."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirm with Google" }),
    ).toBeInTheDocument();
  });

  it("rejects a different account without losing the approval", async () => {
    window.sessionStorage.setItem(
      "recipe-agent-approval-reauth:v1",
      JSON.stringify({
        action: "approve",
        agentId: "agent-1",
        code: "ABCD-1234",
        createdAt: Date.now(),
        provider: "github",
        userId: "user-1",
      }),
    );
    window.history.replaceState(
      null,
      "",
      "/recipes/settings/agents/approve?agent_reauth=complete&error=agent_reauth_identity_mismatch",
    );
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(agentResponse())
        .mockResolvedValueOnce(hostResponse()),
    );

    render(<AgentApprovalView />);

    expect(
      await screen.findByText(
        "Use the same account that started this approval request.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirm with GitHub" }),
    ).toBeInTheDocument();
  });

  it("explains when linked sign-in methods cannot be loaded", async () => {
    authMock.listAccounts.mockResolvedValue({
      data: null,
      error: { message: "Unavailable" },
    });
    vi.stubGlobal("fetch", staleApprovalFetch());

    render(<AgentApprovalView />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Approve access" }),
    );

    expect(
      await screen.findByText(
        "Your sign-in methods could not be loaded. Try again.",
      ),
    ).toBeInTheDocument();
  });

  it("handles a network failure while loading linked sign-in methods", async () => {
    authMock.listAccounts.mockRejectedValue(new Error("Network failure"));
    vi.stubGlobal("fetch", staleApprovalFetch());

    render(<AgentApprovalView />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Approve access" }),
    );

    expect(
      await screen.findByText(
        "Your sign-in methods could not be loaded. Try again.",
      ),
    ).toBeInTheDocument();
  });

  it("explains when the account has no linked social sign-in", async () => {
    authMock.listAccounts.mockResolvedValue({
      data: [{ providerId: "credential", accountId: "credential-1" }],
      error: null,
    });
    vi.stubGlobal("fetch", staleApprovalFetch());

    render(<AgentApprovalView />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Approve access" }),
    );

    expect(
      await screen.findByText(
        "No linked sign-in method can confirm your identity.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the prompt open when the OAuth flow cannot start", async () => {
    authMock.signInSocial.mockResolvedValue({
      data: null,
      error: { message: "Provider unavailable" },
    });
    vi.stubGlobal("fetch", staleApprovalFetch());

    render(<AgentApprovalView />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Approve access" }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Confirm with GitHub" }),
    );

    expect(await screen.findByText("Provider unavailable")).toBeInTheDocument();
    expect(window.sessionStorage).toHaveLength(0);
    expect(
      screen.getByRole("button", { name: "Confirm with GitHub" }),
    ).toBeEnabled();
  });

  it("keeps the prompt open when starting OAuth throws", async () => {
    authMock.signInSocial.mockRejectedValue(new Error("Network failure"));
    vi.stubGlobal("fetch", staleApprovalFetch());

    render(<AgentApprovalView />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Approve access" }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Confirm with GitHub" }),
    );

    expect(
      await screen.findByText(
        "Identity confirmation could not start. Try again.",
      ),
    ).toBeInTheDocument();
    expect(window.sessionStorage).toHaveLength(0);
  });

  it("rejects an expired reauthentication continuation", async () => {
    window.sessionStorage.setItem(
      "recipe-agent-approval-reauth:v1",
      JSON.stringify({
        action: "approve",
        agentId: "agent-1",
        code: "ABCD-1234",
        createdAt: Date.now() - 16 * 60 * 1000,
        provider: "github",
        userId: "user-1",
      }),
    );
    window.history.replaceState(
      null,
      "",
      "/recipes/settings/agents/approve?agent_reauth=complete",
    );

    render(<AgentApprovalView />);

    expect(
      await screen.findByText("This approval link is incomplete."),
    ).toBeInTheDocument();
    expect(window.sessionStorage).toHaveLength(0);
  });
});
