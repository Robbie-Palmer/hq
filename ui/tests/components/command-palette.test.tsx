import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CommandPaletteProvider,
  CommandPaletteTrigger,
  type FilterOption,
  HotkeyHint,
  useCommandPalette,
  useRegisterFilters,
} from "@/components/command-palette-shell";

const pushMock = vi.fn();
const replaceMock = vi.fn();
const { captureMock, navigation } = vi.hoisted(() => ({
  captureMock: vi.fn(),
  navigation: { search: "" },
}));
const originalScrollIntoView = Element.prototype.scrollIntoView;

vi.mock("next/navigation", () => ({
  usePathname: () => "/projects",
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

vi.mock("posthog-js", () => ({
  default: { capture: captureMock },
}));

const projectFilter: FilterOption = {
  value: "active",
  label: "Active projects",
  group: "Status",
  paramName: "status",
};

function RegisteredFilter() {
  useRegisterFilters([projectFilter]);
  return null;
}

function PaletteState() {
  const { open } = useCommandPalette();
  return <output>{open ? "open" : "closed"}</output>;
}

describe("CommandPalette", () => {
  beforeEach(() => {
    pushMock.mockReset();
    replaceMock.mockReset();
    captureMock.mockReset();
    navigation.search = "";
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
    vi.unstubAllGlobals();
  });

  it("opens as a labelled modal dialog, traps focus, and closes on Escape", async () => {
    const user = userEvent.setup();
    render(
      <CommandPaletteProvider>
        <CommandPaletteTrigger />
      </CommandPaletteProvider>,
    );

    const triggers = screen.getAllByRole("button", { name: "Search" });
    const trigger = triggers[0];
    if (!trigger) throw new Error("Expected a command-palette trigger");
    await user.click(trigger);

    const dialog = await screen.findByRole("dialog", {
      name: "Command palette",
    });
    expect(dialog).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("Search or type a command..."),
      ).toHaveFocus(),
    );

    await user.tab();
    expect(dialog).toContainElement(
      document.activeElement as HTMLElement | null,
    );
    await user.tab({ shift: true });
    expect(dialog).toContainElement(
      document.activeElement as HTMLElement | null,
    );

    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("dialog", { name: "Command palette" }),
    ).not.toBeInTheDocument();
  });

  it("focuses the dialog without opening the search input on touch devices", async () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
    } as MediaQueryList);
    const user = userEvent.setup();
    render(
      <CommandPaletteProvider>
        <CommandPaletteTrigger />
      </CommandPaletteProvider>,
    );

    const trigger = screen.getAllByRole("button", { name: "Search" })[0];
    if (!trigger) throw new Error("Expected a command-palette trigger");
    await user.click(trigger);

    expect(
      await screen.findByRole("dialog", { name: "Command palette" }),
    ).toHaveFocus();
    expect(
      screen.getByPlaceholderText("Search or type a command..."),
    ).not.toHaveFocus();
  });

  it("toggles from the keyboard and records only the opening action", async () => {
    const user = userEvent.setup();
    render(
      <CommandPaletteProvider>
        <PaletteState />
      </CommandPaletteProvider>,
    );

    expect(screen.getByText("closed")).toBeInTheDocument();
    await user.keyboard("{Control>}k{/Control}");
    expect(await screen.findByText("open")).toBeInTheDocument();
    expect(captureMock).toHaveBeenCalledWith("command_palette_opened", {
      trigger: "keyboard",
    });

    await user.keyboard("{Control>}k{/Control}");
    expect(await screen.findByText("closed")).toBeInTheDocument();
    expect(captureMock).toHaveBeenCalledTimes(1);
  });

  it("registers page filters and removes them when the page unmounts", async () => {
    const { rerender } = render(
      <CommandPaletteProvider>
        <RegisteredFilter />
        <CommandPaletteTrigger />
      </CommandPaletteProvider>,
    );

    const firstTrigger = screen.getAllByRole("button", { name: "Search" })[0];
    if (!firstTrigger) throw new Error("Expected a command-palette trigger");
    await userEvent.click(firstTrigger);
    expect(await screen.findByText("Active projects")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");

    rerender(
      <CommandPaletteProvider>
        <CommandPaletteTrigger />
      </CommandPaletteProvider>,
    );
    const secondTrigger = screen.getAllByRole("button", { name: "Search" })[0];
    if (!secondTrigger) throw new Error("Expected a command-palette trigger");
    await userEvent.click(secondTrigger);
    expect(screen.queryByText("Active projects")).not.toBeInTheDocument();
  });

  it("marks the initiatives navigation item current on the default projects tab", async () => {
    render(
      <CommandPaletteProvider>
        <CommandPaletteTrigger />
      </CommandPaletteProvider>,
    );

    const trigger = screen.getAllByRole("button", { name: "Search" })[0];
    if (!trigger) throw new Error("Expected a command-palette trigger");
    await userEvent.click(trigger);

    const initiativesItem = screen
      .getByText("Initiatives")
      .closest("[cmdk-item]");
    const projectsItem = screen.getByText("Projects").closest("[cmdk-item]");
    expect(initiativesItem).toHaveTextContent("Current");
    expect(projectsItem).not.toHaveTextContent("Current");
  });

  it("marks projects current on the building philosophy tab", async () => {
    navigation.search = "tab=philosophy";
    render(
      <CommandPaletteProvider>
        <CommandPaletteTrigger />
      </CommandPaletteProvider>,
    );

    const trigger = screen.getAllByRole("button", { name: "Search" })[0];
    if (!trigger) throw new Error("Expected a command-palette trigger");
    await userEvent.click(trigger);

    const initiativesItem = screen
      .getByText("Initiatives")
      .closest("[cmdk-item]");
    const projectsItem = screen.getByText("Projects").closest("[cmdk-item]");
    expect(projectsItem).toHaveTextContent("Current");
    expect(initiativesItem).not.toHaveTextContent("Current");
  });

  it("searches ideas and navigates to the selected idea", async () => {
    const user = userEvent.setup();
    render(
      <CommandPaletteProvider
        ideas={[{ slug: "goodharts-law", title: "Goodhart's Law" }]}
      >
        <CommandPaletteTrigger />
      </CommandPaletteProvider>,
    );

    const trigger = screen.getAllByRole("button", { name: "Search" })[0];
    if (!trigger) throw new Error("Expected a command-palette trigger");
    await user.click(trigger);
    await user.type(
      screen.getByPlaceholderText("Search or type a command..."),
      "goodhart",
    );
    await user.click(screen.getByText("Goodhart's Law"));

    expect(pushMock).toHaveBeenCalledWith("/ideas/goodharts-law");
  });

  it("searches projects by name and navigates to the selected project", async () => {
    const user = userEvent.setup();
    render(
      <CommandPaletteProvider
        projects={[
          { slug: "autonomic-satellite-swarm", title: "Satellite Swarm" },
        ]}
      >
        <CommandPaletteTrigger />
      </CommandPaletteProvider>,
    );

    const trigger = screen.getAllByRole("button", { name: "Search" })[0];
    if (!trigger) throw new Error("Expected a command-palette trigger");
    await user.click(trigger);
    await user.type(
      screen.getByPlaceholderText("Search or type a command..."),
      "satellite",
    );
    await user.click(screen.getByText("Satellite Swarm"));

    expect(pushMock).toHaveBeenCalledWith(
      "/projects/autonomic-satellite-swarm",
    );
  });

  it("searches initiatives by name and navigates to the selected initiative", async () => {
    const user = userEvent.setup();
    render(
      <CommandPaletteProvider
        initiatives={[
          { slug: "personalized-medicine", title: "Personalized Medicine" },
        ]}
      >
        <CommandPaletteTrigger />
      </CommandPaletteProvider>,
    );

    const trigger = screen.getAllByRole("button", { name: "Search" })[0];
    if (!trigger) throw new Error("Expected a command-palette trigger");
    await user.click(trigger);
    await user.type(
      screen.getByPlaceholderText("Search or type a command..."),
      "personalized",
    );
    await user.click(screen.getByText("Personalized Medicine"));

    expect(pushMock).toHaveBeenCalledWith("/initiatives/personalized-medicine");
  });

  it("searches blog posts by name and navigates to the selected post", async () => {
    const user = userEvent.setup();
    render(
      <CommandPaletteProvider
        blogPosts={[
          {
            slug: "the-philosophy-of-data-science",
            title: "The Philosophy of Data Science",
          },
        ]}
      >
        <CommandPaletteTrigger />
      </CommandPaletteProvider>,
    );

    const trigger = screen.getAllByRole("button", { name: "Search" })[0];
    if (!trigger) throw new Error("Expected a command-palette trigger");
    await user.click(trigger);
    await user.type(
      screen.getByPlaceholderText("Search or type a command..."),
      "philosophy",
    );
    await user.click(screen.getByText("The Philosophy of Data Science"));

    expect(pushMock).toHaveBeenCalledWith(
      "/blog/the-philosophy-of-data-science",
    );
  });

  it("rejects hooks outside the provider", () => {
    expect(() => render(<PaletteState />)).toThrow(
      "useCommandPalette must be used within CommandPaletteProvider",
    );
  });

  it("shows the platform-specific hotkey", async () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Macintosh)",
    );
    const { unmount } = render(<HotkeyHint />);
    expect(await screen.findByText("⌘")).toBeInTheDocument();
    unmount();

    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (X11; Linux x86_64)",
    );
    render(<HotkeyHint />);
    expect(await screen.findByText("Ctrl")).toBeInTheDocument();
  });
});
