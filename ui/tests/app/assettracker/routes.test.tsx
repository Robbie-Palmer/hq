import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import AccountsPage from "@/app/assettracker/accounts/page";
import CashFlowPage from "@/app/assettracker/cash-flow/page";
import DecisionsPage from "@/app/assettracker/decisions/page";
import HistoryPage from "@/app/assettracker/history/page";
import ImportsPage from "@/app/assettracker/imports/page";
import PlanningPage from "@/app/assettracker/planning/page";
import SettingsPage from "@/app/assettracker/settings/page";

vi.mock("@/components/assettracker/asset-tracker-dashboard", () => ({
  AssetTrackerDashboard: () => <p>Overview dashboard</p>,
}));

import { AssetTrackerApp } from "@/components/assettracker/asset-tracker-app";

const routes: Array<{ title: string; page: () => ReactNode }> = [
  { title: "Accounts", page: AccountsPage },
  { title: "History", page: HistoryPage },
  { title: "Cash flow", page: CashFlowPage },
  { title: "Planning", page: PlanningPage },
  { title: "Decisions", page: DecisionsPage },
  { title: "Imports", page: ImportsPage },
  { title: "Settings", page: SettingsPage },
];

describe("Asset Tracker routes", () => {
  it.each(routes)("renders the $title destination", ({ title, page: Page }) => {
    render(<Page />);

    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Return to overview" }),
    ).toHaveAttribute("href", "/assettracker");
  });

  it("keeps the existing dashboard on the overview", () => {
    render(<AssetTrackerApp />);

    expect(screen.getByText("Overview dashboard")).toBeInTheDocument();
  });
});
