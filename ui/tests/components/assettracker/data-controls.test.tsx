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
import { useAssetTracker } from "@/components/assettracker/asset-tracker-provider";
import { DataControls } from "@/components/assettracker/data-controls";

vi.mock("@/components/assettracker/asset-tracker-provider", () => ({
  useAssetTracker: vi.fn(),
}));

const mockUseAssetTracker = vi.mocked(useAssetTracker);

const originalScrollIntoView = Element.prototype.scrollIntoView;

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
  Element.prototype.scrollIntoView = vi.fn();
});

afterAll(() => {
  for (const method of [
    "setPointerCapture",
    "releasePointerCapture",
    "hasPointerCapture",
  ]) {
    Reflect.deleteProperty(HTMLElement.prototype, method);
  }
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

describe("DataControls", () => {
  const clearData = vi.fn().mockResolvedValue(undefined);
  const resetData = vi.fn().mockResolvedValue(undefined);
  const setBaseCurrency = vi.fn().mockResolvedValue(undefined);
  const downloadBackup = vi.fn();
  const restoreBackup = vi.fn().mockResolvedValue(undefined);
  const preview = {
    backup: {
      format: "assettracker-household-backup",
      schemaVersion: 1,
      createdAt: "2026-10-08T16:00:00.000Z",
      summary: {
        householdMembers: 2,
        accounts: 4,
        balanceObservations: 8,
        storedRecords: 20,
        latestAccountBalances: [],
      },
      data: {},
    },
    sourceVersion: 1,
    migrated: false,
    current: {
      householdMembers: 1,
      accounts: 2,
      balanceObservations: 3,
      storedRecords: 10,
      latestAccountBalances: [{ currency: "GBP", amount: 100 }],
    },
    replacement: {
      householdMembers: 2,
      accounts: 4,
      balanceObservations: 8,
      storedRecords: 20,
      latestAccountBalances: [{ currency: "GBP", amount: 200 }],
    },
  };
  const previewBackup = vi.fn().mockResolvedValue(preview);

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAssetTracker.mockReturnValue({
      hasLocalChanges: false,
      inflation: 0.025,
      baseCurrency: "GBP",
      setInflation: vi.fn(),
      setBaseCurrency,
      downloadBackup,
      exportCsv: vi.fn(),
      previewBackup,
      restoreBackup,
      clearData,
      resetData,
    } as unknown as ReturnType<typeof useAssetTracker>);
  });

  it("offers a confirmed path from demo data to a blank tracker", async () => {
    const user = userEvent.setup();
    render(<DataControls />);

    await user.click(screen.getByRole("button", { name: "Clear demo data" }));
    expect(clearData).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Clear demo data?" }));
    expect(clearData).toHaveBeenCalledOnce();
  });

  it("separates clearing personal data from restoring the demo", async () => {
    mockUseAssetTracker.mockReturnValue({
      ...mockUseAssetTracker(),
      hasLocalChanges: true,
    });
    const user = userEvent.setup();
    render(<DataControls />);

    expect(
      screen.getByRole("button", { name: "Clear all data" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Restore demo" }));
    expect(resetData).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Discard my data?" }));
    expect(resetData).toHaveBeenCalledOnce();
  });

  it("changes the household base currency from the supported list", async () => {
    const user = userEvent.setup();
    render(<DataControls />);

    await user.click(
      screen.getByRole("combobox", { name: "Household base currency" }),
    );
    await user.click(screen.getByRole("option", { name: "USD" }));

    expect(setBaseCurrency).toHaveBeenCalledWith("USD");
  });

  it("keeps portable data actions on imports", () => {
    render(<DataControls mode="data" />);

    expect(
      screen.getByRole("button", { name: "Download backup" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "CSV" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Restore backup" }),
    ).toBeVisible();
    expect(
      screen.getByText(/Clearing browser data can remove the working copy/),
    ).toBeVisible();
    expect(
      screen.queryByRole("combobox", { name: "Household base currency" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Clear demo data" }),
    ).toBeNull();
  });

  it("keeps assumptions and destructive actions on settings", () => {
    render(<DataControls mode="settings" />);

    expect(
      screen.getByRole("combobox", { name: "Household base currency" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Clear demo data" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Download backup" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Restore backup" })).toBeNull();
  });

  it("downloads a versioned household backup", async () => {
    const user = userEvent.setup();
    render(<DataControls mode="data" />);

    await user.click(screen.getByRole("button", { name: "Download backup" }));

    expect(downloadBackup).toHaveBeenCalledOnce();
  });

  it("previews a backup and requires confirmation before replacement", async () => {
    const user = userEvent.setup();
    render(<DataControls mode="data" />);
    const file = new File(["backup"], "household.json", {
      type: "application/json",
    });

    await user.upload(
      screen.getByLabelText("Choose Asset Tracker backup file"),
      file,
    );

    expect(previewBackup).toHaveBeenCalledWith(file);
    expect(
      screen.getByRole("heading", { name: "Review restore" }),
    ).toBeVisible();
    expect(screen.getByText("1 to 2")).toBeVisible();
    expect(screen.getByText("2 to 4")).toBeVisible();
    expect(screen.getByText("£100.00 to £200.00")).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Restore this backup" }),
    );
    expect(restoreBackup).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Replace current data?" }),
    );
    expect(restoreBackup).toHaveBeenCalledWith(preview.backup);
    expect(screen.getByText("Restored household.json")).toBeVisible();
  });

  it("shows invalid backup errors without offering replacement", async () => {
    previewBackup.mockRejectedValueOnce(new Error("broken"));
    const user = userEvent.setup();
    render(<DataControls mode="data" />);

    await user.upload(
      screen.getByLabelText("Choose Asset Tracker backup file"),
      new File(["broken"], "broken.json", { type: "application/json" }),
    );

    expect(screen.getByText("Something went wrong")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Restore this backup" }),
    ).toBeNull();
    expect(restoreBackup).not.toHaveBeenCalled();
  });
});
