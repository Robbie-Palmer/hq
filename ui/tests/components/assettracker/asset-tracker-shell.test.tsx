import { render, screen } from "@testing-library/react";
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

describe("AssetTrackerLayoutClient", () => {
  beforeEach(() => {
    mocks.pathname = "/assettracker";
    window.localStorage.clear();
  });

  it("provides Asset Tracker data to every routed child", () => {
    render(
      <AssetTrackerLayoutClient>
        <ProviderProbe />
      </AssetTrackerLayoutClient>,
    );

    expect(screen.getByText(/accounts available/)).toBeInTheDocument();
  });

  it("mounts the shared client boundary from the route layout", () => {
    render(
      <AssetTrackerLayout>
        <ProviderProbe />
      </AssetTrackerLayout>,
    );

    expect(screen.getByText(/accounts available/)).toBeInTheDocument();
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
});
