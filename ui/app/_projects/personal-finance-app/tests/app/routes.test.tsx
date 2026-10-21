import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import AccountsPage from "@/app/assettracker/accounts/page";
import CashFlowPage from "@/app/assettracker/cash-flow/page";
import DecisionsPage from "@/app/assettracker/decisions/page";
import HistoryPage from "@/app/assettracker/history/page";
import ImportsPage from "@/app/assettracker/imports/page";
import MortgagePage from "@/app/assettracker/mortgage/page";
import PlanningPage from "@/app/assettracker/planning/page";
import SettingsPage from "@/app/assettracker/settings/page";

vi.mock(
  "@/app/_projects/personal-finance-app/components/accounts-route",
  () => ({
    AccountsRoute: () => <h1>Accounts</h1>,
  }),
);

vi.mock(
  "@/app/_projects/personal-finance-app/components/history-route",
  () => ({
    HistoryRoute: () => <h1>History</h1>,
  }),
);

vi.mock(
  "@/app/_projects/personal-finance-app/components/cash-flow-route",
  () => ({
    CashFlowRoute: () => <h1>Cash flow</h1>,
  }),
);

vi.mock(
  "@/app/_projects/personal-finance-app/components/planning-route",
  () => ({
    PlanningRoute: () => <h1>Financial independence</h1>,
  }),
);

vi.mock(
  "@/app/_projects/personal-finance-app/components/mortgage-route",
  () => ({
    MortgageRoute: () => <h1>Mortgage planning</h1>,
  }),
);

vi.mock(
  "@/app/_projects/personal-finance-app/components/decisions-route",
  () => ({
    DecisionsRoute: () => <p>Recorded mortgage decisions</p>,
  }),
);

vi.mock(
  "@/app/_projects/personal-finance-app/components/imports-route",
  () => ({
    ImportsRoute: () => <h1>Imports</h1>,
  }),
);

vi.mock(
  "@/app/_projects/personal-finance-app/components/settings-route",
  () => ({
    SettingsRoute: () => <h1>Settings</h1>,
  }),
);

vi.mock(
  "@/app/_projects/personal-finance-app/components/asset-tracker-dashboard",
  () => ({
    AssetTrackerDashboard: () => <p>Overview dashboard</p>,
  }),
);

import { AssetTrackerApp } from "@/app/_projects/personal-finance-app/components/asset-tracker-app";

const routes: Array<{ title: string; page: () => ReactNode }> = [
  { title: "History", page: HistoryPage },
  { title: "Cash flow", page: CashFlowPage },
  { title: "Financial independence", page: PlanningPage },
  { title: "Mortgage planning", page: MortgagePage },
  { title: "Decisions", page: DecisionsPage },
  { title: "Imports", page: ImportsPage },
  { title: "Settings", page: SettingsPage },
];

describe("Asset Tracker routes", () => {
  it("renders the accounts application route", () => {
    render(<AccountsPage />);

    expect(
      screen.getByRole("heading", { name: "Accounts" }),
    ).toBeInTheDocument();
  });

  it.each(routes)("renders the $title destination", ({ title, page: Page }) => {
    render(<Page />);

    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
  });

  it("renders recorded mortgage decisions", () => {
    render(<DecisionsPage />);

    expect(screen.getByText("Recorded mortgage decisions")).toBeVisible();
  });

  it("keeps the existing dashboard on the overview", () => {
    render(<AssetTrackerApp />);

    expect(screen.getByText("Overview dashboard")).toBeInTheDocument();
  });
});
