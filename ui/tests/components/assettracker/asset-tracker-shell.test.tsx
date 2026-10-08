import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ pathname: "/assettracker" }));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}));

import AssetTrackerLayout from "@/app/assettracker/layout";
import { AssetTrackerLayoutClient } from "@/components/assettracker/asset-tracker-layout-client";
import { useAssetTracker } from "@/components/assettracker/asset-tracker-provider";

function ProviderProbe() {
  const { accounts } = useAssetTracker();
  return <p>{accounts.length} accounts available</p>;
}

function MutationProbe() {
  const { clearData } = useAssetTracker();
  return (
    <button
      type="button"
      onClick={() => {
        void clearData().catch(() => {});
      }}
    >
      Save a change
    </button>
  );
}

describe("AssetTrackerLayoutClient", () => {
  beforeEach(() => {
    mocks.pathname = "/assettracker";
    window.localStorage.clear();
  });

  it("loads saved data before showing routed children", async () => {
    render(
      <AssetTrackerLayoutClient>
        <ProviderProbe />
      </AssetTrackerLayoutClient>,
    );

    expect(
      screen.getByRole("status", {
        name: "Loading saved Asset Tracker data",
      }),
    ).toBeVisible();
    expect(screen.queryByText(/accounts available/)).toBeNull();
    expect(await screen.findByText(/accounts available/)).toBeVisible();
  });

  it("mounts the shared client boundary from the route layout", async () => {
    render(
      <AssetTrackerLayout>
        <ProviderProbe />
      </AssetTrackerLayout>,
    );

    expect(await screen.findByText(/accounts available/)).toBeVisible();
  });

  it("links every application section and marks the current route", () => {
    mocks.pathname = "/assettracker/cash-flow";

    render(
      <AssetTrackerLayoutClient>
        <p>Cash flow page</p>
      </AssetTrackerLayoutClient>,
    );

    const currentLinks = screen.getAllByRole("link", {
      name: "Cash flow",
      current: "page",
    });
    expect(currentLinks).toHaveLength(2);
    expect(
      currentLinks.every(
        (link) => link.getAttribute("href") === "/assettracker/cash-flow",
      ),
    ).toBe(true);
    expect(
      screen.getAllByRole("link", { name: "Overview" })[0],
    ).not.toHaveAttribute("aria-current");
  });

  it("reports a browser storage failure and can retry", async () => {
    const user = userEvent.setup();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("Storage disabled");
      });

    render(
      <AssetTrackerLayoutClient>
        <ProviderProbe />
      </AssetTrackerLayoutClient>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Saved data is unavailable",
    );
    expect(screen.getByText(/Nothing has been changed/)).toBeVisible();

    getItem.mockRestore();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/accounts available/)).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
    warning.mockRestore();
  });

  it("replaces routed controls with a recovery state after a save failure", async () => {
    const user = userEvent.setup();
    render(
      <AssetTrackerLayoutClient>
        <MutationProbe />
      </AssetTrackerLayoutClient>,
    );
    const saveButton = await screen.findByRole("button", {
      name: "Save a change",
    });
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("Storage full");
      });

    await user.click(saveButton);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not save the last change",
    );
    expect(screen.queryByRole("button", { name: "Save a change" })).toBeNull();

    setItem.mockRestore();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("button", { name: "Save a change" }),
    ).toBeVisible();
  });
});
