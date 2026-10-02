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

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAssetTracker.mockReturnValue({
      hasLocalChanges: false,
      inflation: 0.025,
      baseCurrency: "GBP",
      setInflation: vi.fn(),
      setBaseCurrency,
      exportData: vi.fn(),
      exportCsv: vi.fn(),
      importData: vi.fn(),
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

    expect(screen.getByRole("button", { name: "Export" })).toBeVisible();
    expect(screen.getByRole("button", { name: "CSV" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Import" })).toBeVisible();
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
    expect(screen.queryByRole("button", { name: "Export" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Import" })).toBeNull();
  });
});
