import { render, screen } from "@testing-library/react";
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
import { useAssetTracker } from "@/features/personal-finance-app/components/asset-tracker-provider";
import { IncomeHistoryImportDrawer } from "@/features/personal-finance-app/components/income-history-import-drawer";

vi.mock(
  "@/features/personal-finance-app/components/asset-tracker-provider",
  () => ({
    useAssetTracker: vi.fn(),
  }),
);

const mockUseAssetTracker = vi.mocked(useAssetTracker);

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

describe("IncomeHistoryImportDrawer", () => {
  const importIncomeHistory = vi.fn().mockResolvedValue(undefined);
  const clearIncomeHistory = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAssetTracker.mockReturnValue({
      incomeHistory: [],
      importIncomeHistory,
      clearIncomeHistory,
    } as unknown as ReturnType<typeof useAssetTracker>);
  });

  it("imports sorted portfolio income rows and accepts an income header", async () => {
    render(<IncomeHistoryImportDrawer />);

    await userEvent.click(
      screen.getByRole("button", { name: "Add income history" }),
    );
    expect(
      screen.queryByText(/replace all existing income history/i),
    ).not.toBeInTheDocument();
    await userEvent.type(
      screen.getByLabelText("Period end and income"),
      "date,income\n2025-02-28,4200\n2025-01-31,4100",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Import 2 periods" }),
    );

    expect(importIncomeHistory).toHaveBeenCalledWith({
      income: [
        { date: "2025-01-31", amount: 4100 },
        { date: "2025-02-28", amount: 4200 },
      ],
    });
  });

  it("warns before replacing and can clear existing income history", async () => {
    mockUseAssetTracker.mockReturnValue({
      incomeHistory: [{ date: "2025-01-31", amount: 4100 }],
      importIncomeHistory,
      clearIncomeHistory,
    } as unknown as ReturnType<typeof useAssetTracker>);
    render(<IncomeHistoryImportDrawer />);

    await userEvent.click(
      screen.getByRole("button", { name: "Replace income history" }),
    );
    expect(
      screen.getByText(/importing will replace all existing income history/i),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Clear income history" }),
    );

    expect(clearIncomeHistory).toHaveBeenCalledOnce();
  });
});
