import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { useAssetTracker } from "@/components/assettracker/asset-tracker-provider";
import { SpreadsheetImportDrawer } from "@/components/assettracker/spreadsheet-import-drawer";
import type { AccountDetailView } from "@/lib/domain/assettracker";

vi.mock("@/components/assettracker/asset-tracker-provider", () => ({
  useAssetTracker: vi.fn(),
}));

const mockUseAssetTracker = vi.mocked(useAssetTracker);
const account: AccountDetailView = {
  id: "stocks-isa",
  name: "Stocks ISA",
  provider: "Vanguard",
  currency: "GBP",
  assetType: "stocks",
  expectedAnnualReturn: 0.07,
  isOpen: true,
  latestBalance: 12_000,
  latestSnapshotDate: "2024-06-01",
  cagr: null,
  createdAt: "2023-01-01",
  snapshots: [{ date: "2024-06-01", balance: 12_000 }],
  capitalFlows: [],
  netContributed: null,
  gainLoss: null,
};
const household = {
  members: [
    { id: "alex", displayName: "Alex" },
    { id: "sam", displayName: "Sam" },
  ],
  activeScope: { kind: "household" as const },
};
const alexOwnership = { kind: "personal" as const, memberId: "alex" };

function spreadsheetFile(name: string, contents: string): File {
  const file = new File([contents], name, { type: "text/csv" });
  Object.defineProperty(file, "text", {
    configurable: true,
    value: vi.fn().mockResolvedValue(contents),
  });
  return file;
}

beforeAll(() => {
  for (const method of [
    "setPointerCapture",
    "releasePointerCapture",
    "hasPointerCapture",
  ]) {
    Object.defineProperty(HTMLElement.prototype, method, {
      configurable: true,
      value: vi.fn(),
    });
  }
});

afterAll(() => {
  for (const method of [
    "setPointerCapture",
    "releasePointerCapture",
    "hasPointerCapture",
  ]) {
    Reflect.deleteProperty(HTMLElement.prototype, method);
  }
});

describe("SpreadsheetImportDrawer", () => {
  const importAccountHistory = vi.fn().mockResolvedValue(undefined);
  const importIncomeHistory = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAssetTracker.mockReturnValue({
      accountDetails: [account],
      household,
      householdAccounts: [
        {
          id: account.id,
          name: account.name,
          provider: account.provider,
          ownership: alexOwnership,
        },
      ],
      importAccountHistory,
      importIncomeHistory,
    } as unknown as ReturnType<typeof useAssetTracker>);
  });

  it("reviews a local CSV before importing account balances", async () => {
    const user = userEvent.setup();
    render(<SpreadsheetImportDrawer />);

    await user.click(
      screen.getByRole("button", { name: "Import spreadsheet" }),
    );
    expect(screen.getByText(/not uploaded or sent to a server/i)).toBeVisible();
    await user.upload(
      screen.getByLabelText("CSV or TSV file"),
      spreadsheetFile(
        "balances.csv",
        "date,market value\n2024-02-29,13120\n2024-01-31,12500",
      ),
    );

    expect(await screen.findByText("Review 2 rows")).toBeVisible();
    expect(screen.getByText("Reviewing balances.csv")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Import 2 rows" }));

    await waitFor(() =>
      expect(importAccountHistory).toHaveBeenCalledWith({
        accountId: "stocks-isa",
        balances: [
          { date: "2024-01-31", value: 12_500 },
          { date: "2024-02-29", value: 13_120 },
        ],
        capitalFlows: [],
        capitalFlowKind: "personalSaving",
        replaceCapitalFlows: false,
        ownership: alexOwnership,
      }),
    );
  });

  it("converts reviewed cumulative contributions into capital movements", async () => {
    const user = userEvent.setup();
    render(<SpreadsheetImportDrawer />);

    await user.click(
      screen.getByRole("button", { name: "Import spreadsheet" }),
    );
    await user.selectOptions(
      screen.getByLabelText("Import as"),
      "capitalFlows",
    );
    await user.upload(
      screen.getByLabelText("CSV or TSV file"),
      spreadsheetFile(
        "contributions.tsv",
        "date\tvalue\n2024-01-31\t8000\n2024-02-29\t8500\n2024-03-31\t8300",
      ),
    );
    await user.click(screen.getByRole("button", { name: "Import 3 rows" }));

    await waitFor(() =>
      expect(importAccountHistory).toHaveBeenCalledWith({
        accountId: "stocks-isa",
        balances: [],
        capitalFlows: [
          { date: "2024-01-31", value: 8000 },
          { date: "2024-02-29", value: 500 },
          { date: "2024-03-31", value: -200 },
        ],
        capitalFlowKind: "personalSaving",
        replaceCapitalFlows: true,
        ownership: alexOwnership,
      }),
    );
  });

  it("blocks invalid income rows before they can replace saved history", async () => {
    const user = userEvent.setup();
    render(<SpreadsheetImportDrawer />);

    await user.click(
      screen.getByRole("button", { name: "Import spreadsheet" }),
    );
    await user.selectOptions(screen.getByLabelText("Import as"), "income");
    await user.upload(
      screen.getByLabelText("CSV or TSV file"),
      spreadsheetFile("income.csv", "date,income\nnot-a-date,4100"),
    );

    expect(await screen.findByText(/fix 1 invalid row/i)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Import reviewed rows" }),
    ).toBeDisabled();
    expect(importIncomeHistory).not.toHaveBeenCalled();
  });

  it("previews and commits an import for a second household member", async () => {
    const user = userEvent.setup();
    render(<SpreadsheetImportDrawer />);

    await user.click(
      screen.getByRole("button", { name: "Import spreadsheet" }),
    );
    await user.selectOptions(screen.getByLabelText("Owned by"), "member:sam");
    await user.selectOptions(screen.getByLabelText("Import as"), "income");
    await user.upload(
      screen.getByLabelText("CSV or TSV file"),
      spreadsheetFile("sam-income.csv", "date,income\n2025-01-31,4200"),
    );

    expect(screen.getByText(/will use Sam/i)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Import 1 rows" }));

    await waitFor(() =>
      expect(importIncomeHistory).toHaveBeenCalledWith({
        income: [{ date: "2025-01-31", amount: 4200 }],
        ownership: { kind: "personal", memberId: "sam" },
      }),
    );
  });
});
