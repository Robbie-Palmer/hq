import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CommandPaletteProvider,
  CommandPaletteTrigger,
} from "@/components/command-palette-shell";

const mocks = vi.hoisted(() => ({
  recoverFromStaleChunk: vi.fn(),
}));

vi.mock("@/lib/browser/stale-chunk-recovery", () => ({
  recoverFromStaleChunk: mocks.recoverFromStaleChunk,
}));

vi.mock("posthog-js", () => ({
  default: { capture: vi.fn() },
}));

vi.mock("@/components/command-palette", () => {
  const error = new Error("Loading chunk failed");
  error.name = "ChunkLoadError";
  throw error;
});

describe("CommandPaletteProvider stale chunk recovery", () => {
  beforeEach(() => {
    mocks.recoverFromStaleChunk.mockReset();
    mocks.recoverFromStaleChunk.mockReturnValue(true);
  });

  it("keeps the page mounted while it reloads for a stale dialog chunk", async () => {
    const user = userEvent.setup();
    render(
      <CommandPaletteProvider>
        <CommandPaletteTrigger />
        <main>Page content</main>
      </CommandPaletteProvider>,
    );

    const trigger = screen.getAllByRole("button", { name: "Search" })[0];
    if (!trigger) throw new Error("Expected a command-palette trigger");
    await user.click(trigger);

    await waitFor(() =>
      expect(mocks.recoverFromStaleChunk).toHaveBeenCalledOnce(),
    );
    expect(screen.getByText("Page content")).toBeInTheDocument();
  });
});
